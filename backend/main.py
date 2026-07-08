"""FastAPI 主程式：掛載各路由、啟動 API 與 WebSocket。

所有操作以「目前選中的伺服器（server_id）」為對象，而非寫死單一容器。
第零階段先提供：伺服器清單 API、資料夾瀏覽 API、新增伺服器（偵測 + 存檔），
並把 frontend/ 當靜態網站提供。

啟動方式（在 backend/ 資料夾內）：
    uvicorn main:app --host 127.0.0.1 --port 8000 --reload
"""

from __future__ import annotations

from pathlib import Path

import asyncio

from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import config_editor
import docker_control
import fs_browser
import rcon_control
import server_registry

app = FastAPI(title="Minecraft 伺服器管理工具", version="0.0.1")

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


# ---------- 請求資料模型 ----------

class DetectRequest(BaseModel):
    data_path: str


class AddServerRequest(BaseModel):
    data_path: str
    display_name: str = ""


class UpdateServerRequest(BaseModel):
    display_name: str


class SavePropertiesRequest(BaseModel):
    values: dict[str, str]


class SaveListRequest(BaseModel):
    entries: list[dict]


class ResolveUuidRequest(BaseModel):
    name: str


class RconCommandRequest(BaseModel):
    command: str


# ---------- 伺服器清單 API ----------

@app.get("/api/servers")
def api_list_servers():
    """列出 config.json 內的所有伺服器。"""
    return {"servers": server_registry.list_servers()}


@app.get("/api/servers/{server_id}")
def api_get_server(server_id: str):
    """取得單一伺服器設定。"""
    server = server_registry.get_server(server_id)
    if server is None:
        raise HTTPException(status_code=404, detail=f"找不到伺服器：{server_id}")
    return server


@app.post("/api/servers/detect")
def api_detect_server(req: DetectRequest):
    """偵測某個 data 資料夾（供新增前預覽），不寫入 config。"""
    try:
        return server_registry.detect_server(req.data_path)
    except server_registry.DetectError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/servers/{server_id}/status")
def api_server_status(server_id: str):
    """取得某台伺服器的即時狀態（遊戲埠 / RCON 埠的主機:容器對應），供卡片顯示。"""
    try:
        return server_registry.get_server_status(server_id)
    except server_registry.DetectError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ---------- 設定檔編輯（第三階段） ----------

@app.get("/api/servers/{server_id}/properties")
def api_get_properties(server_id: str):
    """讀取某台伺服器的 server.properties（依檔案順序的 key/value 清單）。"""
    server = server_registry.get_server(server_id)
    if server is None:
        raise HTTPException(status_code=404, detail=f"找不到伺服器：{server_id}")
    try:
        return config_editor.read_properties(server["data_path"])
    except config_editor.ConfigError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/servers/{server_id}/properties")
def api_save_properties(server_id: str, req: SavePropertiesRequest):
    """儲存 server.properties（保留註解與順序，只改動 value；備份 + 原子寫入）。"""
    server = server_registry.get_server(server_id)
    if server is None:
        raise HTTPException(status_code=404, detail=f"找不到伺服器：{server_id}")
    try:
        config_editor.save_properties(server["data_path"], req.values)
        return {"ok": True}
    except config_editor.ConfigError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------- JSON 清單編輯（第三階段 Step B） ----------

@app.get("/api/servers/{server_id}/lists/{kind}")
def api_get_list(server_id: str, kind: str):
    """讀取某台伺服器的某個 JSON 清單（ops/whitelist/banned-players/banned-ips）。"""
    server = server_registry.get_server(server_id)
    if server is None:
        raise HTTPException(status_code=404, detail=f"找不到伺服器：{server_id}")
    try:
        return {"entries": config_editor.read_json_list(server["data_path"], kind)}
    except config_editor.ConfigError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/servers/{server_id}/lists/{kind}")
def api_save_list(server_id: str, kind: str, req: SaveListRequest):
    """儲存某個 JSON 清單；伺服器執行中時拒絕（清單由伺服器掌管，避免被記憶體蓋回）。"""
    server = server_registry.get_server(server_id)
    if server is None:
        raise HTTPException(status_code=404, detail=f"找不到伺服器：{server_id}")

    # 執行中禁止直接改檔（Docker 沒開則容器必不在跑，允許）
    container = server.get("container_name")
    if container:
        try:
            if docker_control.get_state(container).get("running"):
                raise HTTPException(
                    status_code=409,
                    detail="伺服器執行中，清單由伺服器掌管；請先停止再編輯，或用第四階段的指令修改。",
                )
        except docker_control.DockerError:
            pass  # 無法確認狀態（多半 Docker 沒開）→ 容器不在跑，放行

    try:
        config_editor.save_json_list(server["data_path"], kind, req.entries)
        return {"ok": True}
    except config_editor.ConfigError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/servers/{server_id}/players")
def api_list_players(server_id: str):
    """列出已知玩家名稱（usercache + 各清單），供指令自動補全用。"""
    server = server_registry.get_server(server_id)
    if server is None:
        raise HTTPException(status_code=404, detail=f"找不到伺服器：{server_id}")
    try:
        return {"names": config_editor.list_known_players(server["data_path"])}
    except config_editor.ConfigError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/servers/{server_id}/resolve-uuid")
def api_resolve_uuid(server_id: str, req: ResolveUuidRequest):
    """依玩家名稱解析 UUID（usercache → Mojang API，或離線模式演算法）。"""
    server = server_registry.get_server(server_id)
    if server is None:
        raise HTTPException(status_code=404, detail=f"找不到伺服器：{server_id}")
    try:
        return config_editor.resolve_uuid(server["data_path"], req.name)
    except config_editor.ConfigError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------- 送指令（第四階段，RCON） ----------

@app.post("/api/servers/{server_id}/command")
def api_send_command(server_id: str, req: RconCommandRequest):
    """透過 RCON 對選中伺服器送一行指令，回傳伺服器的文字結果。"""
    server = server_registry.get_server(server_id)
    if server is None:
        raise HTTPException(status_code=404, detail=f"找不到伺服器：{server_id}")
    command = req.command.strip()
    if not command:
        raise HTTPException(status_code=400, detail="指令不能是空的。")
    try:
        return {"output": rcon_control.send_command(server, command)}
    except rcon_control.RconError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------- 容器控制（第二階段） ----------

def _require_container(server_id: str) -> str:
    """取得某台伺服器對應的容器名；找不到伺服器或未對應容器時拋 HTTPException。"""
    server = server_registry.get_server(server_id)
    if server is None:
        raise HTTPException(status_code=404, detail=f"找不到伺服器：{server_id}")
    container = server.get("container_name")
    if not container:
        raise HTTPException(status_code=400, detail="這台伺服器尚未對應到 Docker 容器，無法控制。")
    return container


@app.get("/api/servers/{server_id}/state")
def api_server_state(server_id: str):
    """查詢容器執行狀態（供按鈕啟用與卡片徽章、定時輪詢用）。"""
    server = server_registry.get_server(server_id)
    if server is None:
        raise HTTPException(status_code=404, detail=f"找不到伺服器：{server_id}")
    container = server.get("container_name")
    if not container:
        # 尚未對應容器：不是錯誤，回一個明確狀態讓前端顯示提示即可
        return {"exists": False, "running": False, "status": "no_container"}
    try:
        return docker_control.get_state(container)
    except docker_control.DockerError as e:
        # Docker 沒開／沒回應：503，前端據此顯示「Docker 未連線」
        raise HTTPException(status_code=503, detail=str(e))


@app.post("/api/servers/{server_id}/start")
def api_start_server(server_id: str):
    """啟動選中伺服器的容器，回傳啟動後的最新狀態。"""
    container = _require_container(server_id)
    try:
        docker_control.start_container(container)
        return docker_control.get_state(container)
    except docker_control.DockerError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/servers/{server_id}/stop")
def api_stop_server(server_id: str):
    """停止選中伺服器的容器，回傳停止後的最新狀態。"""
    container = _require_container(server_id)
    try:
        docker_control.stop_container(container)
        return docker_control.get_state(container)
    except docker_control.DockerError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/servers/{server_id}/restart")
def api_restart_server(server_id: str):
    """重啟選中伺服器的容器，回傳重啟後的最新狀態。"""
    container = _require_container(server_id)
    try:
        docker_control.restart_container(container)
        return docker_control.get_state(container)
    except docker_control.DockerError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/servers")
def api_add_server(req: AddServerRequest):
    """偵測後把伺服器加入 config.json，回傳新增的那筆。"""
    try:
        return server_registry.add_server(req.data_path, req.display_name)
    except server_registry.DetectError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.patch("/api/servers/{server_id}")
def api_update_server(server_id: str, req: UpdateServerRequest):
    """編輯伺服器（目前為改顯示暱稱）。"""
    try:
        return server_registry.update_server(server_id, req.display_name)
    except server_registry.DetectError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/api/servers/{server_id}")
def api_delete_server(server_id: str):
    """從清單移除一台伺服器（不刪實際資料）。"""
    try:
        server_registry.remove_server(server_id)
        return {"ok": True}
    except server_registry.DetectError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------- 資料夾瀏覽 API ----------

@app.get("/api/fs/list")
def api_fs_list(path: str | None = None):
    """列出某路徑下的子資料夾；path 省略時回傳磁碟機清單。"""
    try:
        return fs_browser.list_dir(path)
    except fs_browser.FsError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------- 即時 log（WebSocket，第一階段） ----------

@app.websocket("/ws/servers/{server_id}/logs")
async def ws_server_logs(websocket: WebSocket, server_id: str):
    """即時推送某台伺服器對應容器的 log（`docker logs -f`）。

    訊息格式（皆為 JSON）：
      {"type": "info",  "message": ...}  一般狀態（例如已開始串流）
      {"type": "log",   "line": ...}     一行 log
      {"type": "ended", "message": ...}  串流自然結束（容器停止／不存在）
      {"type": "error", "message": ...}  無法串流（docker 沒開、找不到容器對應等）

    前端負責顯示與自動重連；後端只要在前端斷線時把 docker 子行程收乾淨即可。
    """
    await websocket.accept()

    server = server_registry.get_server(server_id)
    if server is None:
        await websocket.send_json({"type": "error", "message": f"找不到伺服器：{server_id}"})
        await websocket.close()
        return

    container = server.get("container_name")
    if not container:
        await websocket.send_json(
            {"type": "error", "message": "這台伺服器尚未對應到 Docker 容器，無法讀取 log。"}
        )
        await websocket.close()
        return

    await websocket.send_json({"type": "info", "message": f"開始串流容器 {container} 的 log…"})

    # tail：先補幾行歷史；重連時前端會帶 0 只接新行，避免重覆倒歷史（預設 200）
    try:
        tail = max(0, int(websocket.query_params.get("tail", docker_control.DEFAULT_TAIL)))
    except (TypeError, ValueError):
        tail = docker_control.DEFAULT_TAIL

    # stop 事件用來讓「轉發 log」與「偵測前端斷線」兩個任務任一結束時，另一個也收場
    stop = asyncio.Event()

    async def forward_logs() -> None:
        """把 docker logs 每一行轉發到前端；串流結束或出錯時送出對應訊息。"""
        try:
            async for line in docker_control.follow_logs(container, tail=tail):
                await websocket.send_json({"type": "log", "line": line})
            await websocket.send_json(
                {"type": "ended", "message": "log 串流結束（容器可能已停止）。"}
            )
        except docker_control.DockerError as e:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            # 前端已斷線導致 send 失敗等：不特別處理，交給 finally 收場
            pass
        finally:
            stop.set()

    async def watch_disconnect() -> None:
        """持續接收前端訊息，唯一目的是及時察覺前端斷線（前端平常不會傳東西）。"""
        try:
            while True:
                await websocket.receive_text()
        except Exception:
            stop.set()

    forward_task = asyncio.create_task(forward_logs())
    watch_task = asyncio.create_task(watch_disconnect())
    await stop.wait()

    # 收尾：取消尚未結束的任務（取消轉發任務會連帶關閉產生器 → 終止 docker 子行程）
    for task in (forward_task, watch_task):
        task.cancel()
    await asyncio.gather(forward_task, watch_task, return_exceptions=True)

    try:
        await websocket.close()
    except Exception:
        pass


# ---------- 前端靜態檔 ----------
# 放最後掛載於 "/"，避免蓋掉上面的 /api 路由與 /ws WebSocket；html=True 讓根路徑回傳 index.html。
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
