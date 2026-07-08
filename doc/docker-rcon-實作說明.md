# Docker 互動 與 RCON — 兩大核心功能實作說明

這份文件記錄本工具最關鍵的兩條「與伺服器溝通的通道」，以及各自的實作方式，供開發時參考。

---

## 前提：誰在哪裡跑？

```
┌─────────────────────────────────────────────┐
│  Windows 主機（你的電腦）                      │
│                                               │
│   後端 Python (FastAPI) ← 這個跑在「主機上」    │
│         │                                     │
│         │  ┌──────────────────────────────┐   │
│         │  │  Docker 容器 MyServer         │   │
│         │  │                              │   │
│         │  │   Minecraft 伺服器 ← 跑在「容器內」│
│         │  └──────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

**管理工具（Python 後端）跑在 Windows 主機上，不是跑在容器裡。** 容器裡只有 Minecraft 伺服器。
因此所有互動的本質，都是「從主機想辦法碰到容器裡的東西」，而碰法有兩條不同通道：

| | 通道① Docker 互動 | 通道② RCON |
|---|---|---|
| 目的 | 控制**容器**（開/關/重啟/看 log） | 控制**Minecraft 伺服器**（下遊戲指令） |
| 走什麼 | Docker 引擎（CLI 或 docker-py） | 網路 TCP 連線 |
| 怎麼穿進容器 | 引擎本來就管得到容器 | 靠 `--publish` 把埠打通 |
| 前置條件 | Docker Desktop 有開 | 容器發布 25575 埠 + server.properties 開 rcon |

---

## 通道①：怎麼跟 Docker 互動？（控制容器本身）

路徑是「**主機 → Docker 引擎 → 容器**」，做**容器層級**的操作：開機、關機、重啟、抓 log。

### 做法 A：subprocess 呼叫 `docker` CLI（第一版採用）

Python 用內建的 `subprocess` 模組「代替你在終端機打 docker 指令」。

```python
import subprocess

# 開機 / 關機 / 重啟：只是換中間的動作字（start / stop / restart）
# subprocess.run 會執行外部程式並等它結束
subprocess.run(["docker", "start", "MyServer"])     # 相當於終端機打 docker start MyServer
subprocess.run(["docker", "stop", "MyServer"])
subprocess.run(["docker", "restart", "MyServer"])
```

**抓即時 log**：跑 `docker logs -f MyServer`，一行一行讀取後透過 WebSocket 推到前端。

```python
# -f = follow，持續跟著新輸出（類似 tail -f）
# stdout=PIPE 表示把它印出來的東西接到 Python 手上；text=True 讓輸出以文字（非 bytes）處理
process = subprocess.Popen(
    ["docker", "logs", "-f", "MyServer"],
    stdout=subprocess.PIPE,
    text=True,
)
for line in process.stdout:      # 每來一行新的 log
    推送到前端(line)             # 透過 WebSocket 送出去（此為示意）
```

**查容器狀態**（第二階段的 Running / Stopped）：

```python
# --format 讓 docker 只回傳我們要的欄位（容器是否在執行中，回傳 true / false）
result = subprocess.run(
    ["docker", "inspect", "-f", "{{.State.Running}}", "MyServer"],
    capture_output=True, text=True,
)
is_running = result.stdout.strip() == "true"
```

優點：簡單直覺、好除錯、相依少。缺點：要自己解析文字輸出。

### 做法 B：用 docker-py 套件（先不做，未來升級選項）

> ⚠️ **目前先不實作。** 列為第一版穩定後的升級選項。

不透過命令列，而是用 `docker` 這個 Python 套件直接跟 Docker Engine API 對話
（Windows 上走一條叫 named pipe 的內部通道 `\\.\pipe\docker_engine`）。功能與做法 A 相同，但寫法物件化、較乾淨。

```python
# 這是「未來」可能的寫法，目前不採用
import docker

client = docker.from_env()                 # 連到本機 Docker 引擎
container = client.containers.get("MyServer")

container.start()                          # 開機
container.stop()                           # 關機
container.restart()                        # 重啟
status = container.status                  # "running" / "exited" 等

for line in container.logs(stream=True, follow=True):   # 即時 log（回傳 bytes，需 decode）
    推送到前端(line.decode("utf-8"))
```

優點：程式碼乾淨、不必自己解析文字。缺點：多一層套件相依與學習成本，錯誤處理與環境設定要另外了解。

> **結論**:第一版用做法 A（subprocess）。做法 B 等第一版穩定、確定需要更細緻的控制時再評估。

---

## 通道②：伺服器在容器內，RCON 要怎麼做？

核心觀念四個字：**發布連接埠（port publishing）**。

### 為什麼需要「發布埠」

RCON 的本質是一條**網路連線（TCP）**：Python 端只是「連到某 IP 的某個埠、報密碼、送指令」，
它其實不知道對方在不在容器裡，只在乎「這個埠連得到嗎」。

問題是：Minecraft 開的 RCON 埠（25575）開在**容器內部的網路**裡。容器像一間有自己門牌的房間，
主機上的 Python 預設連不進去，除非在牆上打一個對外的洞 —— 這個洞就是 `--publish`。

看現有啟動指令：
```
docker container create -i --publish 25565:25565/tcp --name "MyServer" ...
```
`--publish 25565:25565` = 「把**主機的 25565** 接到**容器內的 25565**」（格式為 `主機埠:容器內埠`）。
所以玩家連主機的 25565 就會被轉進容器裡的 Minecraft。
**目前只打通了遊戲埠 25565，RCON 的 25575 尚未打通。**

### 讓 RCON 可用的兩個步驟

**① 在容器內開啟 RCON** —— 改 `data/server.properties`
（data 有掛載進容器，改主機這份等於改容器裡那份）：
```properties
enable-rcon=true
rcon.password=一組複雜密碼
rcon.port=25575
```

**② 把 25575 埠也發布出來** —— 重建容器時多加一條 `--publish`：
```
docker container create -i ^
  --publish 25565:25565/tcp ^
  --publish 25575:25575/tcp ^   # 新增這條，把 RCON 埠打通
  --name "MyServer" -v D:\minecraft\data:/minecraft my-minecraft-server
```

> ⚠️ `--publish` 只能在**建立容器時**指定，現有 `MyServer` 要加 25575 得**砍掉重建**。
> 資料在 `D:\minecraft\data` 是掛載出來的，不會跟著容器消失，所以重建安全。

### Python 端連線範例

```python
from mcrcon import MCRcon

# 連「主機自己」的 25575，Docker 會自動把它轉進容器內的 25575
# with 區塊結束會自動關閉連線
with MCRcon("127.0.0.1", "你的rcon密碼", port=25575) as mcr:
    resp = mcr.command("list")   # 送指令（查看線上玩家）
    print(resp)                  # 收到伺服器「回傳」的結果 ← RCON 比 stdin 強的關鍵
```

`127.0.0.1` 代表「主機自己」，因為 Docker 已把容器的 25575 映射到主機的 25575，
對 Python 來說就像 RCON 服務開在自己電腦上一樣。

### 為什麼用 RCON 取代 stdin

| 比較項目 | stdin（`-i`） | RCON |
|---|---|---|
| 要不要改動容器 | 沒 `-i` 要**重建容器** | 只改 server.properties + 重啟，不用重建 |
| 能不能收到指令結果 | ❌ 收不到（只能去 log 撈） | ✅ 有回傳 |
| 安全性 | 無驗證 | 有密碼驗證 |
| 是否官方標準做法 | 算克難 | ✅ 官方內建、業界通用 |

一句話：stdin 是**門縫投信口**（只能塞進去），RCON 是**有密碼的對講機**（能對話）。

---

## 兩條通道分工總結

```
                         ┌──────────────── Docker 引擎 ────────────────┐
  Python 後端 ──通道①──→ │ docker start/stop/logs → 控制「容器盒子」      │
  (跑在主機)             └───────────────────────────────────────────┘
       │
       └───通道②──→ 連 127.0.0.1:25575 (RCON/TCP)
                    透過 --publish 打通的洞 → 進到容器內的 Minecraft
                    → 送 /op /whitelist 等指令，並收回傳結果
```

- **即時 log 顯示** → 走通道①（`docker logs -f`）
- **送指令 / 管理玩家** → 走通道②（RCON）

兩者分工、互不衝突：Docker 引擎管「容器這個盒子」，RCON 管「盒子裡的 Minecraft 伺服器」。
