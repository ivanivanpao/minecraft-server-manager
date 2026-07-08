"""容器控制（通道①）：封裝 docker 操作，對象為指定容器。

第一版採用做法 A：用 subprocess 呼叫 docker CLI。
第一階段先實作 log 串流（`docker logs -f`），供 WebSocket 即時推送到前端。
（start / stop / restart 等容器控制留待第二階段。）
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import threading
from typing import AsyncIterator

# 一開始先補多少行歷史 log（讓剛連上就看得到最近的輸出，而非空白等新訊息）
DEFAULT_TAIL = 200


class DockerError(Exception):
    """docker 指令無法執行時拋出（例如沒安裝 docker / Docker 沒開）。"""


# ---------- 容器狀態 / 控制（第二階段） ----------

def _friendly_docker_error(stderr: str) -> str:
    """把 docker CLI 的常見英文錯誤翻成好懂的中文提示。"""
    low = stderr.lower()
    if (
        "cannot connect to the docker daemon" in low
        or "error during connect" in low
        or "the docker daemon" in low
    ):
        return "無法連線到 Docker，請確認 Docker Desktop 已啟動。"
    return stderr or "docker 指令執行失敗。"


def _run_docker(args: list[str], timeout: float | None = None) -> str:
    """執行一次性的 docker CLI 指令並回傳 stdout；失敗時拋出帶中文訊息的 DockerError。"""
    try:
        result = subprocess.run(
            ["docker", *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except FileNotFoundError:
        raise DockerError("找不到 docker 指令，請確認已安裝 Docker Desktop 且已加入 PATH。")
    except subprocess.TimeoutExpired:
        raise DockerError(f"docker {args[0]} 逾時，Docker 可能沒有回應。")
    if result.returncode != 0:
        raise DockerError(_friendly_docker_error(result.stderr.strip()))
    return result.stdout.strip()


def get_state(container_name: str) -> dict:
    """查詢容器目前狀態。

    回傳 {"exists": bool, "running": bool, "status": str}。
    - 容器不存在（config 記的容器已被刪）→ exists=False, status="not_found"，不視為錯誤。
    - Docker 沒開 / 沒裝 → 拋 DockerError（由上層轉成給使用者看的提示）。
    status 為 docker 原生字串：created / running / paused / restarting / exited / dead。
    """
    try:
        result = subprocess.run(
            ["docker", "inspect", "-f", "{{.State.Status}}", container_name],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
    except FileNotFoundError:
        raise DockerError("找不到 docker 指令，請確認已安裝 Docker Desktop 且已加入 PATH。")
    except subprocess.TimeoutExpired:
        raise DockerError("docker inspect 逾時，Docker 可能沒有回應。")

    if result.returncode != 0:
        err = result.stderr.strip()
        if "no such" in err.lower():  # 容器不存在（非 Docker 故障）
            return {"exists": False, "running": False, "status": "not_found"}
        raise DockerError(_friendly_docker_error(err))

    status = result.stdout.strip()
    return {"exists": True, "running": status == "running", "status": status}


def start_container(container_name: str) -> str:
    """啟動容器（docker start）。"""
    return _run_docker(["start", container_name], timeout=30)


def stop_container(container_name: str) -> str:
    """停止容器（docker stop，預設寬限 10 秒讓伺服器好好存檔關機）。"""
    return _run_docker(["stop", container_name], timeout=40)


def restart_container(container_name: str) -> str:
    """重啟容器（docker restart＝先 stop 再 start）。"""
    return _run_docker(["restart", container_name], timeout=60)


def get_host_port(container_name: str, container_port: str) -> str | None:
    """回傳容器某個內部埠對外發布的『主機埠』；找不到回 None。

    容器內埠（如 RCON 的 25575）不一定等於主機埠，真正的對應要從 docker inspect 讀。
    """
    info_list = json.loads(_run_docker(["inspect", container_name]))
    if not info_list:
        return None
    info = info_list[0]
    key = f"{container_port}/tcp"
    # 執行中：對應在 NetworkSettings.Ports
    ports = (info.get("NetworkSettings") or {}).get("Ports") or {}
    binding = ports.get(key)
    if binding:
        return binding[0].get("HostPort")
    # 已停止：改看 HostConfig.PortBindings（建立時的設定仍在）
    pb = (info.get("HostConfig") or {}).get("PortBindings") or {}
    binding = pb.get(key)
    if binding:
        return binding[0].get("HostPort")
    return None


async def follow_logs(container_name: str, tail: int = DEFAULT_TAIL) -> AsyncIterator[str]:
    """非同步逐行產生 `docker logs -f <container>` 的輸出。

    容器停止或不存在時，`docker logs` 會印完既有內容後自然結束，本產生器隨之結束；
    消費端（WebSocket）若提前離開（前端斷線／切換伺服器），會透過 GeneratorExit
    走到 finally，把背景的 docker 子行程一併終止，避免殘留。

    以「背景執行緒讀取 subprocess ＋ asyncio.Queue 回傳」實作，
    刻意不用 asyncio.create_subprocess_exec：Windows 上後者需要 Proactor 事件迴圈，
    而 uvicorn 的事件迴圈設定不一定相容；用執行緒讀取則兩平台都穩定。
    """
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[str | object] = asyncio.Queue()
    sentinel = object()  # 標記「子行程輸出已結束」

    try:
        proc = subprocess.Popen(
            ["docker", "logs", "-f", "--tail", str(tail), container_name],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # 把 docker/容器的 stderr 併入，錯誤訊息也看得到
            text=True,
            encoding="utf-8",
            errors="replace",  # 避免罕見亂碼字元讓整條串流爆掉
            bufsize=1,  # 行緩衝，log 一行一行即時吐出
        )
    except FileNotFoundError:
        raise DockerError("找不到 docker 指令，請確認已安裝 Docker Desktop 且已加入 PATH。")

    def _reader() -> None:
        """在背景執行緒把子行程每一行丟回事件迴圈的 queue。"""
        try:
            assert proc.stdout is not None
            for line in proc.stdout:
                loop.call_soon_threadsafe(queue.put_nowait, line.rstrip("\r\n"))
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, sentinel)

    thread = threading.Thread(target=_reader, name=f"docker-logs-{container_name}", daemon=True)
    thread.start()

    try:
        while True:
            item = await queue.get()
            if item is sentinel:
                break
            yield item  # type: ignore[misc]
    finally:
        # 消費端結束或發生例外 → 終止 docker logs 子行程（否則 -f 會一直掛著）
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
