"""設定檔編輯：讀寫選中伺服器 data_path 下的設定檔。

管理 server.properties 與 ops/whitelist/banned-players/banned-ips JSON。
寫檔要求：先備份（.bak）＋原子寫入（寫暫存檔再改名）；
server.properties 需保留 # 註解列與 key 原始順序、固定 UTF-8 編碼。

第三階段 Step A 先實作 server.properties；JSON 清單於 Step B 補上。
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import uuid as uuidlib
from pathlib import Path

import httpx


class ConfigError(Exception):
    """設定檔讀寫失敗時拋出（例如檔案不存在、路徑異常）。"""


# ---------- server.properties ----------

def _props_path(data_path: str) -> Path:
    return Path(data_path) / "server.properties"


def read_properties(data_path: str) -> dict:
    """讀取 server.properties，回傳依「檔案順序」排列的 key/value 清單。

    只回傳實際的設定項（略過 # 註解與空行）；註解與順序在寫檔時由 save_properties
    以逐行比對的方式保留，因此前端只需處理 key→value 即可。
    """
    path = _props_path(data_path)
    if not path.exists():
        raise ConfigError(f"找不到 server.properties：{path}")

    entries: list[dict[str, str]] = []
    with path.open("r", encoding="utf-8") as f:
        for raw in f:
            line = raw.rstrip("\n").rstrip("\r")
            stripped = line.strip()
            # 略過空行與註解（# 或 ! 開頭皆為 properties 註解）
            if not stripped or stripped.startswith("#") or stripped.startswith("!"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            entries.append({"key": key.strip(), "value": value.strip()})
    return {"entries": entries}


def save_properties(data_path: str, values: dict[str, str]) -> None:
    """把 values（key→新值）寫回 server.properties。

    做法：逐行讀原檔，遇到「非註解且 key 在 values 內」的行就只換 value，其餘
    （註解、空行、順序）原封不動；values 內原檔沒有的 key 追加到最後。
    寫檔前備份成 server.properties.bak，並用「暫存檔→改名」原子覆蓋，UTF-8 編碼。
    """
    path = _props_path(data_path)
    if not path.exists():
        raise ConfigError(f"找不到 server.properties：{path}")

    with path.open("r", encoding="utf-8") as f:
        original_lines = f.readlines()

    def _clean(v: str) -> str:
        # value 一律單行，去掉換行避免破壞檔案結構
        return str(v).replace("\r", " ").replace("\n", " ")

    out: list[str] = []
    seen: set[str] = set()
    for raw in original_lines:
        line = raw.rstrip("\n").rstrip("\r")
        stripped = line.strip()
        is_entry = bool(stripped) and not stripped.startswith("#") and not stripped.startswith("!") and "=" in line
        if is_entry:
            key = line.partition("=")[0].strip()
            if key in values:
                out.append(f"{key}={_clean(values[key])}")
                seen.add(key)
                continue
        out.append(line)

    # values 內、原檔沒有的 key → 追加到最後
    for key, value in values.items():
        if key not in seen:
            out.append(f"{key}={_clean(value)}")

    # 備份（覆蓋前一份 .bak）
    shutil.copy2(path, path.with_name("server.properties.bak"))

    # 原子寫入：先寫暫存檔再改名覆蓋，避免寫到一半失敗把設定檔弄壞
    tmp = path.with_name("server.properties.tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(out) + "\n")
    os.replace(tmp, path)


# ---------- JSON 清單（ops / whitelist / banned-players / banned-ips） ----------

# 只允許這幾個檔名，避免任意檔名被寫入（安全）
JSON_FILES = {
    "ops": "ops.json",
    "whitelist": "whitelist.json",
    "banned-players": "banned-players.json",
    "banned-ips": "banned-ips.json",
}


def _json_path(data_path: str, kind: str) -> Path:
    filename = JSON_FILES.get(kind)
    if not filename:
        raise ConfigError(f"未知的清單類型：{kind}")
    return Path(data_path) / filename


def read_json_list(data_path: str, kind: str) -> list:
    """讀取某個 JSON 清單檔；檔案不存在視為空清單。"""
    path = _json_path(data_path, kind)
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        raise ConfigError(f"{path.name} 不是有效的 JSON：{e}")
    if not isinstance(data, list):
        raise ConfigError(f"{path.name} 格式不符（應為陣列）。")
    return data


def save_json_list(data_path: str, kind: str, entries: list) -> None:
    """寫回某個 JSON 清單檔（備份 .bak + 原子寫入 + UTF-8、縮排 2）。

    呼叫端（main.py）須先確認伺服器已停止，避免蓋掉伺服器記憶體內的清單。
    """
    if not isinstance(entries, list):
        raise ConfigError("清單資料格式不符（應為陣列）。")
    path = _json_path(data_path, kind)

    if path.exists():
        shutil.copy2(path, path.with_name(path.name + ".bak"))

    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


# ---------- 玩家 UUID 解析（新增到清單時自動補齊） ----------

def _online_mode(data_path: str) -> bool:
    """從 server.properties 讀 online-mode（預設 true）。"""
    path = Path(data_path) / "server.properties"
    if not path.exists():
        return True
    with path.open("r", encoding="utf-8") as f:
        for raw in f:
            s = raw.strip()
            if s.startswith("online-mode"):
                return s.partition("=")[2].strip().lower() != "false"
    return True


def _dash_uuid(hex32: str) -> str:
    """把無連字號的 32 位十六進位 UUID 轉成標準有連字號格式。"""
    h = hex32.replace("-", "")
    return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


def _offline_uuid(name: str) -> str:
    """離線模式的 UUID：等同 Java 的 UUID.nameUUIDFromBytes("OfflinePlayer:"+name)。

    即以 MD5 產生 version 3 的 UUID；online-mode=false 時伺服器就是這樣算玩家 UUID。
    """
    data = ("OfflinePlayer:" + name).encode("utf-8")
    b = bytearray(hashlib.md5(data).digest())
    b[6] = (b[6] & 0x0F) | 0x30  # version 3
    b[8] = (b[8] & 0x3F) | 0x80  # variant
    return str(uuidlib.UUID(bytes=bytes(b)))


def _read_usercache(data_path: str) -> list:
    path = Path(data_path) / "usercache.json"
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def list_known_players(data_path: str) -> list[str]:
    """列出「已知」玩家名稱，供指令自動補全用。

    來源：usercache.json（曾連線過的玩家）＋ whitelist / ops / banned-players 的名字，
    去重後依名稱排序。皆為本機檔案讀取，不需伺服器執行中、也不打 API。
    """
    names: dict[str, str] = {}  # lower -> 原始大小寫

    for entry in _read_usercache(data_path):
        if isinstance(entry, dict) and entry.get("name"):
            names.setdefault(entry["name"].lower(), entry["name"])

    for kind in ("whitelist", "ops", "banned-players"):
        try:
            for entry in read_json_list(data_path, kind):
                if isinstance(entry, dict) and entry.get("name"):
                    names.setdefault(entry["name"].lower(), entry["name"])
        except ConfigError:
            pass  # 某個清單檔壞掉不影響其他來源

    return sorted(names.values(), key=str.lower)


def resolve_uuid(data_path: str, name: str) -> dict:
    """依名稱解析玩家 UUID，回傳 {name, uuid, source}。

    - online-mode=false → 用離線演算法算 UUID（source=offline）。
    - online-mode=true  → 先查 usercache.json（source=usercache），查不到再打 Mojang API
      （source=mojang），Mojang 也查無此人則拋 ConfigError。
    """
    name = name.strip()
    if not name:
        raise ConfigError("請輸入玩家名稱。")

    if not _online_mode(data_path):
        return {"name": name, "uuid": _offline_uuid(name), "source": "offline"}

    # online：先查本機 usercache（曾連過的玩家不用打 API）
    for entry in _read_usercache(data_path):
        if isinstance(entry, dict) and str(entry.get("name", "")).lower() == name.lower():
            return {"name": entry.get("name", name), "uuid": entry.get("uuid"), "source": "usercache"}

    # 查不到 → 打 Mojang API 換真 UUID
    try:
        resp = httpx.get(
            f"https://api.mojang.com/users/profiles/minecraft/{name}",
            timeout=10.0,
        )
    except httpx.HTTPError as e:
        raise ConfigError(f"連線 Mojang API 失敗：{e}")

    if resp.status_code == 200 and resp.content:
        data = resp.json()
        return {"name": data.get("name", name), "uuid": _dash_uuid(data["id"]), "source": "mojang"}
    if resp.status_code in (204, 404):
        raise ConfigError(f"Mojang 查無此玩家：{name}（正版帳號才查得到）。")
    raise ConfigError(f"Mojang API 回應異常（HTTP {resp.status_code}）。")
