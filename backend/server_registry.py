"""伺服器清單管理：讀寫 config.json，並在新增伺服器時自動偵測。

自動偵測 = 讀該 data 資料夾的 server.properties（rcon 密碼、online-mode 等）
＋ docker inspect（對應容器名、RCON 實際發布的主機埠）。
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

# 專案根目錄 = 本檔（backend/server_registry.py）的上上層
PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = PROJECT_ROOT / "config.json"


class DetectError(Exception):
    """自動偵測或設定操作失敗時拋出（例如選到的資料夾不是 MC 伺服器）。"""


# ---------- 路徑小工具 ----------

def _norm(path: str) -> str:
    """把路徑正規化成統一比較格式（正斜線、去尾斜線、小寫）。

    Windows 上 docker 的掛載來源與使用者選的路徑可能斜線/大小寫不一致，
    比較前先正規化，避免對應不到容器。
    """
    if not path:
        return ""
    return os.path.normpath(path).replace("\\", "/").rstrip("/").lower()


# ---------- config.json 讀寫 ----------

def load_config() -> dict:
    """讀取 config.json；若檔案不存在則回傳空清單結構。"""
    if not CONFIG_PATH.exists():
        return {"servers": []}
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)
    # 防呆：確保一定有 servers 陣列
    if not isinstance(data.get("servers"), list):
        data["servers"] = []
    return data


def save_config(data: dict) -> None:
    """原子寫入 config.json（先寫暫存檔再改名覆蓋，避免寫到一半壞掉）。"""
    tmp = CONFIG_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, CONFIG_PATH)  # os.replace 為原子操作


def list_servers() -> list[dict]:
    """回傳所有伺服器設定。"""
    return load_config()["servers"]


def get_server(server_id: str) -> dict | None:
    """依 id 找出單一伺服器，找不到回傳 None。"""
    for server in list_servers():
        if server.get("id") == server_id:
            return server
    return None


# ---------- 讀 server.properties ----------

def read_server_properties(data_path: str) -> dict:
    """讀取 data_path 下的 server.properties，回傳 key -> value 字典。

    僅供偵測讀取用；正式編輯（需保留註解與原始順序）留待第三階段的 config_editor。
    """
    prop_path = Path(data_path) / "server.properties"
    if not prop_path.exists():
        raise DetectError(
            f"找不到 server.properties，這個資料夾可能不是 Minecraft 伺服器：{data_path}"
        )
    props: dict[str, str] = {}
    with prop_path.open("r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            props[key.strip()] = value.strip()
    return props


# ---------- docker 互動（偵測用） ----------

def _run_docker(args: list[str]) -> str:
    """執行 docker CLI 並回傳 stdout；docker 不存在或失敗時拋出 DetectError。"""
    try:
        result = subprocess.run(
            ["docker", *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    except FileNotFoundError:
        raise DetectError("找不到 docker 指令，請確認已安裝 Docker 且已加入 PATH。")
    if result.returncode != 0:
        raise DetectError(f"docker {' '.join(args)} 執行失敗：{result.stderr.strip()}")
    return result.stdout


def _find_container_by_data_path(data_path: str) -> tuple[str | None, dict]:
    """掃描所有容器，找出把 data_path 掛載進去的容器。

    回傳 (容器名稱 or None, 該容器的 inspect 資料 or {})。
    """
    target = _norm(data_path)
    names = [n for n in _run_docker(["ps", "-a", "--format", "{{.Names}}"]).splitlines() if n.strip()]
    if not names:
        return None, {}
    infos = json.loads(_run_docker(["inspect", *names]))
    for info in infos:
        for mount in info.get("Mounts", []):
            if _norm(mount.get("Source", "")) == target:
                return info.get("Name", "").lstrip("/"), info
    return None, {}


def _host_port(info: dict, container_port: str) -> str | None:
    """依『容器內的埠』找出它對外發布的『主機埠』。

    多台伺服器時容器內埠通常相同（25565/25575），但每台的主機埠必須不同，
    真正的對應只能從 docker inspect 讀。管理器/玩家要連的是這個主機埠。
    """
    if not container_port:
        return None
    key = f"{container_port}/tcp"
    # 執行中的容器：對應寫在 NetworkSettings.Ports
    ports = (info.get("NetworkSettings") or {}).get("Ports") or {}
    binding = ports.get(key)
    if binding:
        return binding[0].get("HostPort")
    # 已停止的容器：NetworkSettings 可能是空的，改看 HostConfig.PortBindings（建立時的設定仍在）
    pb = (info.get("HostConfig") or {}).get("PortBindings") or {}
    binding = pb.get(key)
    if binding:
        return binding[0].get("HostPort")
    return None


# ---------- 自動偵測 ----------

def detect_server(data_path: str) -> dict:
    """偵測一個 data 資料夾：確認是 MC 伺服器、讀設定、對應容器、找遊戲/RCON 的主機埠。

    回傳遊戲埠與 RCON 埠的「容器端 / 主機端」對應，供前端顯示 主機:容器 格式。
    docker 不可用（沒開/沒裝）時不會整個失敗，只是主機端埠與容器名回 None。
    不是 MC 伺服器（沒有 server.properties）才會拋 DetectError。
    """
    props = read_server_properties(data_path)  # 不是 MC 伺服器會在這裡拋 DetectError

    game_port_container = props.get("server-port", "25565")
    rcon_port_container = props.get("rcon.port", "25575")

    container_name = None
    game_port_host = None
    rcon_port_host = None
    docker_error = None
    try:
        container_name, info = _find_container_by_data_path(data_path)
        if info:
            game_port_host = _host_port(info, game_port_container)
            rcon_port_host = _host_port(info, rcon_port_container)
    except DetectError as e:
        # docker 沒開/沒裝：仍回傳 server.properties 讀到的容器端資訊，主機端留空
        docker_error = str(e)

    return {
        "data_path": data_path,
        "container_name": container_name,               # 可能為 None（找不到對應容器）
        "container_found": container_name is not None,
        "online_mode": props.get("online-mode"),
        "motd": props.get("motd"),
        "enable_rcon": props.get("enable-rcon"),
        "has_rcon_password": bool(props.get("rcon.password")),
        "game_port_container": game_port_container,      # 容器內遊戲埠（通常 25565）
        "game_port_host": game_port_host,                # 對外主機遊戲埠；None = 未發布
        "rcon_port_container": rcon_port_container,       # 容器內 RCON 埠（通常 25575）
        "rcon_port_host": rcon_port_host,                # 對外主機 RCON 埠；None = 未發布
        "docker_error": docker_error,                    # docker 不可用時的錯誤訊息（可為 None）
    }


def get_server_status(server_id: str) -> dict:
    """取得某台伺服器的即時狀態（目前為埠對應），供卡片顯示。

    找不到伺服器會拋 DetectError；data 資料夾異常則回傳帶 error 的結果（不讓卡片整個壞掉）。
    """
    server = get_server(server_id)
    if server is None:
        raise DetectError(f"找不到伺服器：{server_id}")
    try:
        return detect_server(server["data_path"])
    except DetectError as e:
        return {
            "data_path": server["data_path"],
            "error": str(e),
            "game_port_container": None,
            "game_port_host": None,
            "rcon_port_container": None,
            "rcon_port_host": None,
        }


# ---------- 新增伺服器 ----------

def _make_id(data_path: str, existing_ids: set[str]) -> str:
    """用資料夾名稱產生一個唯一的 id（小寫、只留英數與 -_）。"""
    base = re.sub(r"[^a-z0-9_-]", "", Path(data_path).name.lower()) or "server"
    server_id = base
    i = 2
    while server_id in existing_ids:
        server_id = f"{base}-{i}"
        i += 1
    return server_id


def add_server(data_path: str, display_name: str) -> dict:
    """偵測後把一台伺服器加進 config.json，回傳新增的那筆設定。"""
    detection = detect_server(data_path)
    config = load_config()

    # 避免重複加入同一個 data_path
    for server in config["servers"]:
        if _norm(server.get("data_path", "")) == _norm(data_path):
            raise DetectError(f"這個資料夾已經加入過了（id={server['id']}）。")

    # 存檔時統一用正斜線，讓 config.json 內的路徑格式一致（Windows 上正/反斜線皆可用）
    stored_path = data_path.replace("\\", "/")
    existing_ids = {s["id"] for s in config["servers"]}
    server = {
        "id": _make_id(data_path, existing_ids),
        "display_name": display_name.strip() or Path(data_path).name,
        "container_name": detection["container_name"] or "",
        "data_path": stored_path,
    }
    config["servers"].append(server)
    save_config(config)
    return server


def update_server(server_id: str, display_name: str) -> dict:
    """更新伺服器的顯示暱稱（第零階段的「編輯」＝改名），回傳更新後的設定。"""
    new_name = display_name.strip()
    if not new_name:
        raise DetectError("顯示暱稱不能是空的。")
    config = load_config()
    for server in config["servers"]:
        if server["id"] == server_id:
            server["display_name"] = new_name
            save_config(config)
            return server
    raise DetectError(f"找不到伺服器：{server_id}")


def remove_server(server_id: str) -> None:
    """從 config.json 移除一台伺服器（只移除清單項目，不會動到實際伺服器資料）。"""
    config = load_config()
    remaining = [s for s in config["servers"] if s["id"] != server_id]
    if len(remaining) == len(config["servers"]):
        raise DetectError(f"找不到伺服器：{server_id}")
    config["servers"] = remaining
    save_config(config)
