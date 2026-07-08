"""伺服器指令（通道②）：封裝 RCON 連線與送指令。

連線資訊依 server 現場取得：
- 是否啟用、密碼、容器內 RCON 埠 → 讀該 server 的 server.properties（密碼不存 config.json）
- 對外主機埠 → docker inspect 該容器的 PortBindings（容器內埠 != 主機埠）
管理器與 Docker 在同一台，故連 127.0.0.1:<主機埠>。
"""

from __future__ import annotations

import socket

from mcrcon import MCRcon, MCRconException

import docker_control
import server_registry


class RconError(Exception):
    """RCON 連線或送指令失敗時拋出（訊息為給使用者看的中文）。"""


def send_command(server: dict, command: str) -> str:
    """對某台伺服器透過 RCON 送一行指令，回傳伺服器的文字回應。

    server 為 config.json 內的一筆（含 data_path、container_name）。
    各種失敗（未啟用 RCON、沒設密碼、埠沒發布、連不上、認證失敗）都轉成中文 RconError。
    """
    data_path = server.get("data_path")
    container = server.get("container_name")

    # 1) 讀 server.properties 取得 RCON 設定
    try:
        props = server_registry.read_server_properties(data_path)
    except server_registry.DetectError as e:
        raise RconError(str(e))

    if str(props.get("enable-rcon", "false")).strip().lower() != "true":
        raise RconError("這台伺服器尚未啟用 RCON（server.properties 的 enable-rcon 需為 true，改完要重啟）。")
    password = (props.get("rcon.password") or "").strip()
    if not password:
        raise RconError("server.properties 沒有設定 rcon.password。")
    container_port = (props.get("rcon.port") or "25575").strip() or "25575"

    # 2) 由 docker inspect 找出 RCON 對外的主機埠
    if not container:
        raise RconError("這台伺服器尚未對應到 Docker 容器，無法連線 RCON。")
    try:
        host_port = docker_control.get_host_port(container, container_port)
    except docker_control.DockerError as e:
        raise RconError(str(e))
    if not host_port:
        raise RconError(
            f"容器沒有把 RCON 埠（{container_port}）發布到主機。"
            f"請重建容器時加上 --publish {container_port}:{container_port}。"
        )

    # 3) 連線並送指令
    mcr = MCRcon("127.0.0.1", password, port=int(host_port), timeout=5)
    try:
        mcr.connect()
    except MCRconException as e:
        raise RconError(f"RCON 認證失敗：{e}（請確認 rcon.password 正確且已重啟套用）。")
    except (ConnectionRefusedError, socket.timeout, OSError) as e:
        raise RconError(
            f"連不上 RCON（127.0.0.1:{host_port}）：{e}。"
            "請確認伺服器執行中、容器已重建並發布該埠。"
        )

    try:
        return mcr.command(command)
    except MCRconException as e:
        raise RconError(f"RCON 執行錯誤：{e}")
    except (socket.timeout, OSError) as e:
        raise RconError(f"RCON 連線中斷：{e}")
    finally:
        try:
            mcr.disconnect()
        except Exception:
            pass
