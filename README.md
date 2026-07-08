# Minecraft 伺服器管理工具

一個網頁式 GUI 工具，用來取代手動打指令管理 Docker 化的 Minecraft 伺服器。
本機（localhost）與遠端（透過 Tailscale）都能用瀏覽器操作。

> **開發進度**：第零～第四階段（原計畫全部）皆已實作並驗證完成。第零（多伺服器地基）、第一（即時 log）、第二（控制按鈕）、第三（設定檔編輯器：server.properties + 4 個 JSON 清單）、第四（指令輸入 + RCON 自動補全 + 歷史）。

## 這是什麼

管理跑在 Docker 容器內的 Minecraft 伺服器（可同時管理主機上多台），主要功能：

- **多伺服器管理**：在介面上選擇要操作哪一台；新增伺服器時用「資料夾瀏覽器」選到 data 資料夾，自動偵測建立設定
- **即時 log 顯示**：瀏覽器上即時看到伺服器輸出
- **伺服器控制**：用按鈕做 start / stop / restart
- **設定檔編輯**：用表單編輯 `server.properties`、`ops.json`、`whitelist.json`、`banned-players.json`、`banned-ips.json`
- **指令輸入 + 自動補全**：保留手動下指令的能力，並顯示執行結果
- **多語言與主題**：介面支援繁中／English 切換、白天／夜晚模式；每個選項都附說明

## 如何執行

**需求**：已安裝 Docker Desktop 與 Python（3.10 以上，且加入 PATH）。

啟動用專案根目錄的 **`start.bat`**。首次執行會自動建立虛擬環境 `.venv/` 並安裝 `backend/requirements.txt` 的套件，之後一律用虛擬環境的 Python 啟動（確保依賴隔離）。啟動後按 `Ctrl+C` 可停止。

### 三種啟動方式

要用 `remote` 模式必須在**終端機**打指令（直接雙擊只會用預設的本機模式）。
先在專案資料夾開終端機：在檔案總管**網址列**輸入 `cmd` 按 Enter，或 Shift+右鍵 →「在此開啟終端機／PowerShell」。

| 方式 | 在終端機打（cmd） | 綁定位址 | 用途 |
|---|---|---|---|
| **1. 本機（預設）** | `start.bat`（或直接雙擊檔案） | `127.0.0.1:8000` | 只有本機瀏覽器連得到，最安全 |
| **2. Tailscale 遠端（自動）** | `start.bat remote` | 自動偵測的 Tailscale IP `:8000` | 讓同一個 Tailscale 網路的裝置連入 |
| **3. Tailscale 遠端（指定 IP）** | `start.bat remote 100.x.x.x` | 指定的 IP `:8000` | 自動偵測失敗時，手動指定要綁的 IP |

> 若用的是 **PowerShell**，指令要加 `.\` 前綴，例如 `.\start.bat remote`。

**啟動後用瀏覽器連**：
- 本機：<http://127.0.0.1:8000>
- 遠端：`http://<本機的 Tailscale IP>:8000`（遠端裝置需**安裝並登入同一個 Tailscale 帳號**；本機 IP 用 `tailscale ip -4` 查）

> - **安全**：`remote` 只綁 Tailscale IP＝只對你自己的私有網路開放；**絕不綁 `0.0.0.0`**（那會對區網／公網開放）。IP 是執行時才動態偵測，不寫進任何檔案。
> - Windows 防火牆若擋了 8000 埠的連入，第一次啟動時在跳出的視窗選「允許」。
> - 伺服器清單存在專案根目錄的 `config.json`（含機器專屬路徑，不進版控；範本見 `config.example.json`）。

## 建立 Minecraft 伺服器映像（Dockerfile）

管理器操作的容器是從 `my-minecraft-server` 這個映像建立的。映像用下面的 `Dockerfile` 建置——把官方 `server.jar` 放進一個帶 Java 的環境：

```dockerfile
# 使用有 Java 25 的基礎鏡像（26.2 版需要較新的 Java）
FROM eclipse-temurin:25-jre
# 設定容器內的工作目錄
WORKDIR /minecraft
# 把 server.jar 複製進容器
COPY server.jar /minecraft/server.jar
# 開放 Minecraft 連線埠
EXPOSE 25565
# 開放 RCON 連線埠
EXPOSE 25575
# 容器啟動時執行的指令
CMD ["java", "-Xmx8G", "-Xms8G", "-jar", "server.jar", "nogui"]
```

逐行說明：

| 指令 | 意義 |
|---|---|
| `FROM eclipse-temurin:25-jre` | 以「內建 Java 25（JRE）」的官方映像為基礎；Minecraft 26.2 需要較新的 Java |
| `WORKDIR /minecraft` | 把容器內的工作目錄設為 `/minecraft`（後續指令都在此執行，也是掛載 data 的位置） |
| `COPY server.jar /minecraft/server.jar` | 把建置目錄下的官方 `server.jar` 複製進映像 |
| `EXPOSE 25565` / `EXPOSE 25575` | **標註**這個映像會用到 25565（遊戲）、25575（RCON）兩個埠 |
| `CMD ["java","-Xmx8G","-Xms8G","-jar","server.jar","nogui"]` | 容器啟動時執行：用 Java 跑 `server.jar`；`-Xmx8G`／`-Xms8G`＝最大／最小記憶體都給 8GB（設成一樣可避免動態調整），`nogui`＝不開圖形視窗（伺服器模式） |

> ⚠️ **`EXPOSE` 只是「文件標註」，不會真的把埠開到主機。** 要讓主機／外部連得到，仍須在**建立容器時**用 `--publish`（見下方「啟用 RCON」）。這也是為什麼要用 RCON 得重建容器補上 `--publish 25575`。

**建置映像**（在放著 `Dockerfile` 與 `server.jar` 的資料夾內執行）：

```
docker build -t my-minecraft-server .
```

## 啟用 RCON（「指令輸入」功能才需要）

第四階段的「指令主控台」是透過 **RCON** 送指令到伺服器。沒設定好 RCON 的話，主控台送指令會提示連不上。設定分三步：

**① 讓容器發布 RCON 埠（25575）**
RCON 預設用埠 `25575`，容器必須把它 `--publish` 出來。**埠只能在建立容器時指定**，所以現有容器要**砍掉重建**（data 資料夾是掛載出來的，重建不會掉存檔）：

```
docker rm -f MyServer
docker container create -i --publish 25565:25565/tcp --publish 25575:25575/tcp --name "MyServer" -v D:\minecraft\data:/minecraft my-minecraft-server
```

**② 開啟 RCON 並設密碼**
用工具的 **「⚙ 設定檔」** 編輯器（在「RCON / Query」分組），或手動編輯該伺服器的 `server.properties`：

```properties
enable-rcon=true
rcon.password=請設一組複雜密碼
rcon.port=25575
```

**③ 重啟伺服器**讓設定生效（用工具的「重啟」按鈕即可）。

完成後，在「指令主控台」輸入 `list` 送出，看得到線上玩家就代表 RCON 通了。

> 工具連 RCON 時：密碼**即時從該台的 `server.properties` 讀**、連線用的**主機埠由 `docker inspect` 取得**（所以 `config.json` 不存密碼；多台伺服器時每台的 RCON 要發布到不同主機埠）。

## 文件（在 `doc/` 資料夾）

| 文件 | 內容 |
|---|---|
| [doc/minecraft-manager-plan.md](doc/minecraft-manager-plan.md) | **專案規劃**：目標、技術選型、多伺服器架構、五階段開發計畫（第零～第四）、資料夾結構、重要注意事項 |
| [doc/docker-rcon-實作說明.md](doc/docker-rcon-實作說明.md) | **核心功能實作說明**：如何跟 Docker 互動、RCON 如何穿進容器，含程式碼範例 |

## 建議閱讀順序

1. 先讀 [專案規劃](doc/minecraft-manager-plan.md)，了解整體目標、多伺服器架構與五個開發階段（第零～第四）。
2. 再讀 [實作說明](doc/docker-rcon-實作說明.md)，理解「控制容器」與「送指令進伺服器」這兩條核心通道怎麼實作。

## 技術選型（摘要）

- **後端**：Python + FastAPI（Docker 操作、讀寫設定檔、API、WebSocket）
- **前端**：原生 HTML + CSS + JavaScript
- **即時 log**：WebSocket 包裝 `docker logs -f`
- **送指令**：RCON 協定（取代 stdin）

詳見 [專案規劃 — 技術選型](doc/minecraft-manager-plan.md#技術選型)。
