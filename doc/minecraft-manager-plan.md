# Minecraft 伺服器管理工具 — 專案規劃

## 專案目標
我發現現在這樣手動管理跟設定伺服器很麻煩
我想設計一種可以幫助我管理伺服器的應用，因為我發現打指令很麻煩，當然這個應用還是能保留使用者自行輸入指令的功能，只是希望介面清楚容易使用，而且可以有自動補全跟提示功能
我想使用GUI呈現
目前簡單目標是管理
banned-ips.json
banned-players.json
ops.json
server.properties
whitelist.json

做一個網頁式的 GUI 工具,取代手動打指令管理 Docker 化的 Minecraft 伺服器。
本機（localhost）和遠端（透過 Tailscale）都能用瀏覽器開啟操作。

**多伺服器目標**:工具不寫死單一台,要能同時管理主機上「任意多台」Minecraft 伺服器——
在介面上選擇某一台,即可對它開機/關機/看 log/編輯設定/送指令。新增伺服器時透過
「資料夾瀏覽器」選到該伺服器的 data 資料夾,工具自動偵測並建立設定。

## 現有環境（開發參考）

> 以下為開發參考用的**範例**環境。機器專屬資訊(實際 data 路徑、Tailscale IP 等)不寫死於此——
> 實際值以各機器的 `config.json`(不進版控)與現場查詢(如 `tailscale ip -4`)為準。

- **作業系統**:Windows 11
- **伺服器架設方式**:Docker(以容器名 `MyServer`、鏡像 `my-minecraft-server` 為例)
- **Minecraft 版本**:Java 版 26.2(官方 server.jar,新版號規則)
- **資料掛載位置**:範例 `D:\minecraft\data`(容器內對應 `/minecraft`);實際路徑存在各機器的 `config.json`
- **遠端連線**:可選用 Tailscale;本機的 Tailscale IP 以 `tailscale ip -4` 查詢(私有位址,不進版控)
- **容器建立指令參考**(遊戲埠 25565 與 RCON 埠 25575 都要發布):
  ```
  docker container create -i --publish 25565:25565/tcp --publish 25575:25575/tcp --name "MyServer" -v D:\minecraft\data:/minecraft my-minecraft-server
  ```
  > `--publish 25565`＝遊戲埠、`--publish 25575`＝RCON 埠(第四階段送指令用),兩者都要在**建立容器時**一併發布(埠只能建立時指定,漏了得砍掉重建)。
  > RCON 另需在 server.properties 設 `enable-rcon=true` 與 `rcon.password`(見下方「重要技術注意事項」)。

## 技術選型

| 層面 | 技術 | 說明 |
|---|---|---|
| 後端 | Python + FastAPI | 呼叫 Docker 指令、讀寫設定檔、提供 API 與 WebSocket |
| 前端 | HTML + CSS + JavaScript | 使用者介面,先用原生技術,不用複雜框架(前端 JS 依功能拆成多個 ES Module) |
| 即時 log | WebSocket | 伺服器 log 即時推送到瀏覽器 |
| Docker 互動 | subprocess 呼叫 docker CLI,或用 docker-py 套件 | 執行 start/stop/restart/logs 等容器層級操作 |
| 送指令 / 遙控 | RCON 協定(Python 套件如 mcrcon / aiomcrcon) | 送指令進 Minecraft 主控台並取得回傳結果(取代 stdin) |
| 多伺服器設定 | config.json + 後端讀取 | 儲存伺服器清單,配合自動偵測產生 |

> **Docker 互動的兩種做法**:
> - **做法 A(第一版採用)**:用 `subprocess` 呼叫 `docker` CLI 指令(如 `docker start MyServer`),簡單直覺、好除錯。
> - **做法 B(先不做,列為未來升級選項)**:用 `docker-py` 套件直接呼叫 Docker Engine API,寫法較物件化乾淨(`container.start()`、`container.logs(stream=True)`),但多一層學習與相依成本。**目前先不實作**,等第一版穩定後再評估是否升級。
>
> 詳細比較與程式碼範例見 [docker-rcon-實作說明.md](docker-rcon-實作說明.md)。

## 連線設定與多伺服器架構

工具要能管理「任意多台」伺服器,核心是一份**伺服器清單設定檔** `config.json`,搭配**自動偵測**與**資料夾瀏覽器**來建立每一筆。

### config.json 結構(伺服器清單)

```json
{
  "servers": [
    {
      "id": "myserver",
      "display_name": "我的主要伺服器",
      "container_name": "MyServer",
      "data_path": "D:/minecraft/data"
    }
  ]
}
```

- 每台伺服器一筆,關鍵欄位只有:`id`(內部代號)、`display_name`(顯示暱稱)、`container_name`(Docker 容器名)、`data_path`(data 資料夾路徑)。
- `config.json` 放在**專案根目錄**,由 `backend/server_registry.py` 讀取。
- **前端每個操作都帶 `server_id`**,後端用它去 config 找對應的容器名 / data 路徑來執行。
- **版本控制**:`config.json` 內含機器專屬的絕對路徑,列入 `.gitignore`(不進版控);另附一份 **`config.example.json` 範本**(進版控),供新環境複製參考。

### 密碼放哪?→ 幾乎不用另外存(重要簡化)

RCON 的**埠與密碼本來就寫在每台的 `data_path/server.properties` 裡**(`rcon.port`、`rcon.password`)。
既然工具會即時讀取該檔,就**直接從 server.properties 現場讀密碼**即可,`config.json` **完全不需要放密碼**。

- ✅ 好處:`config.json` 不含任何祕密,不怕外洩;而 `server.properties` 位在各伺服器的 data 資料夾(不在本專案 repo 內),天生就在版控之外。
- (可選)若某台想覆寫或自訂密碼,再用 `.env`(gitignore)放 `<ID>_RCON_PASSWORD`,屬進階選項,預設不需要。
- 仍要做:把 `config.json`(及若有的 `.env`)寫進 `.gitignore`,避免路徑等資訊誤上傳。

### 自動偵測伺服器(新增一台時)

使用者在介面按「新增伺服器」→ 用資料夾瀏覽器選到某個 data 資料夾 → 後端自動完成:

1. **確認是 Minecraft 伺服器**:檢查資料夾內有沒有 `server.properties`。
2. **讀 `server.properties`**:自動取得 `rcon.password`、`enable-rcon`、`online-mode`、`server-port`、`motd` 等。⚠️ 注意 `rcon.port` 是**容器內部**的埠,不一定等於管理器從主機連得到的埠(見下一步)。
3. **對應 Docker 容器**:掃描所有容器(`docker ps -a`),對每個 `docker inspect` 找出掛載了這個 data 資料夾的容器 → 自動填 `container_name`;**同時從 `docker inspect` 的 PortBindings 取得 RCON 實際發布的「主機埠」**——管理器要連的是這個,它可能與容器內 `rcon.port` 不同(例如第二台用 `--publish 25576:25575`,主機埠 25576 ≠ 容器埠 25575)。
4. **產生一筆 server 設定** → 使用者只需補一個「顯示暱稱」→ 存進 `config.json` 的 `servers`。

> 未來可再進一步做「容器優先」全自動掃描(列出所有容器→反查各自的 data 資料夾→自動生成整份清單),此為進階選項,先做上面的「選資料夾→偵測」即可。

### 資料夾瀏覽器(做法 A)

因為瀏覽器基於安全**不能讀取本機任意資料夾的真實路徑**,而真正要讀檔的後端就跑在主機上、有完整檔案系統權限,所以:

- **後端**提供「列出資料夾」的 API(例如 `GET /api/fs/list?path=D:/`),回傳該路徑下的子資料夾清單。
- **前端**做一個像檔案總管的**資料夾瀏覽器**:點進去、往上一層、選定資料夾,把選中的路徑交給後端去偵測。
- ⚠️ 安全:此 API 只回傳資料夾清單、且要**防路徑穿越(path traversal)**;可限制在合理的根目錄範圍內,不可讓它讀取整台機器的敏感路徑(見「重要技術注意事項」)。

## 需要管理的檔案(每台伺服器各自的 data 資料夾內)

| 檔案 | 格式 | 內容 |
|---|---|---|
| `ops.json` | JSON 陣列 | 管理員清單(name, uuid, level, bypassesPlayerLimit) |
| `whitelist.json` | JSON 陣列 | 白名單玩家(name, uuid) |
| `banned-players.json` | JSON 陣列 | 封鎖玩家 |
| `banned-ips.json` | JSON 陣列 | 封鎖 IP |
| `server.properties` | key=value 純文字 | 伺服器主設定(難度、遊戲模式、玩家上限等);也含 RCON 埠/密碼 |

> **重要原則**:上面 4 個 JSON 檔在「伺服器執行中」是由 Minecraft 自己掌管的。
> 伺服器執行時要改這些清單,應透過 RCON 下指令(op / whitelist add / ban 等),
> 讓伺服器自己去寫檔;只有在伺服器「停止」時才由本工具直接編輯 JSON,
> 以免記憶體裡的舊資料把外部的變更蓋掉。

## 介面需求(UI/UX)

以下為全域的介面需求,套用到各階段的畫面:

- **多語言介面(i18n)**:暫定支援「繁體中文 / English」兩種語系,可切換。文字不寫死在畫面裡,改用語系檔(如 `zh-TW`、`en`)集中管理;預設繁體中文。
- **介面模式(主題)**:提供「白天 / 夜晚(light / dark)」切換,並記住使用者的選擇(存 localStorage),下次開啟沿用。
- **每個管理選項都要有解釋**:每個設定項、按鈕、欄位都要附上說明(tooltip 或旁邊的說明文字),讓使用者知道「這是什麼、改了會怎樣」。尤其 `server.properties` 的各欄位要有中文說明(例如 difficulty、gamemode、pvp 等各代表什麼)。

## 開發階段規劃

> 從第零階段起,所有操作都以「**目前選中的伺服器(server_id)**」為對象,而非寫死 MyServer。

### 第零階段:多伺服器基礎架構(地基)　✅ 已實作並驗證(2026-07-08)
目標:能在介面上管理一份伺服器清單,並選定要操作哪一台。

> 實作對應:後端 `server_registry.py`(config.json 讀寫 + 自動偵測 + 埠對應)、`fs_browser.py`(資料夾瀏覽 + 防穿越)、`main.py`(API + 靜態前端);前端 `server-select.js`(進入點)、`i18n.js`、`theme.js`。以 `start.bat` 啟動。
- 後端 API:`GET /api/servers`(清單)、`GET /api/servers/{id}`、`GET /api/servers/{id}/status`(埠對應狀態)、`POST /api/servers/detect`(偵測預覽)、`POST /api/servers`(新增)、`PATCH /api/servers/{id}`(改名)、`DELETE /api/servers/{id}`(移除)、`GET /api/fs/list`(資料夾瀏覽)。
- 新增流程:開資料夾瀏覽器→選 data 資料夾→自動偵測(讀 server.properties + docker inspect)→確認→存檔(data_path 統一存正斜線)。
- 前端採**卡片清單**(非下拉),每張卡片顯示容器名、資料路徑,以及**遊戲埠與 RCON 埠的「主機:容器」對應**(主機埠由 docker inspect 取得,執行中/已停止皆可讀);並提供**編輯(改名)**與**刪除**;點卡片可設為「目前操作中」(存 localStorage,供後續階段使用)。
- 驗證結果:清單顯示 MyServer / TestServer,埠對應正確(MyServer 25565:25565、TestServer 25566:25565 等),新增/改名/刪除、多語言/主題切換皆正常。

### 第一階段:即時 log 顯示(MVP)　✅ 已實作並驗證(2026-07-09)
目標:打開網頁、選好伺服器,能即時看到該容器的 log。

> 實作對應:後端 `docker_control.py`(`follow_logs` 以背景執行緒讀 `docker logs -f`,經 asyncio.Queue 回傳,避開 Windows 上 asyncio 子行程的事件迴圈相容問題)、`main.py` 新增 WebSocket 路由 `/ws/servers/{id}/logs`(轉發 log＋偵測前端斷線,斷線即終止 docker 子行程);前端 `log.js`(顯示、自動捲動、自動重連),接進 `server-select.js`(跟隨「目前操作中」伺服器)。
- 後端:用 WebSocket 包裝 `docker logs -f <選中容器>`,即時推送每一行輸出;訊息以 JSON 分類(`log`/`info`/`ended`/`error`),`--tail 200` 先補最近歷史;找不到伺服器或未對應容器時回 `error` 並關閉。
- 前端:一個滾動的 log 顯示區(等寬控台外觀),預設自動捲到最新;手動往上捲時暫停跟隨,提供「自動捲動」開關與「清空」;DOM 最多保留 2000 行避免吃記憶體。
- WebSocket 自動重連只在「非預期斷線」(沒收到結束訊息就斷,例如 Tailscale 網路波動)時觸發,遞增退避 1→15 秒;且重連只接新行(`tail=0`),避免把歷史再倒一次而重複。**串流正常結束**(容器停止送 `ended`、或無法串流送 `error`)則不自動重連,只把歷史顯示一次就停,狀態顯示「串流結束(容器已停止)」——否則停止中的容器會被 `docker logs -f` 反覆倒同一段歷史而無限變長(已修正)。切換伺服器時關舊連線、開新連線並重新補歷史,同一台重繪不重連。
- 連線狀態列(連線中/已連線/已斷線重連中/串流結束將重試/無法讀取),並隨語言即時翻譯。
- 驗證方式:玩家加入/離開伺服器時,log 即時出現在畫面

### 第二階段:伺服器控制按鈕　✅ 已實作並驗證(2026-07-09)
目標:用按鈕取代 start/stop/restart 指令。

> 實作對應:後端 `docker_control.py` 新增 `get_state`(docker inspect 查狀態,區分 not_found 與 Docker 沒開)、`start/stop/restart_container`(帶逾時);`main.py` 新增 `GET /api/servers/{id}/state`、`POST .../start|stop|restart`。前端新增 `control.js`(控制列三顆按鈕＋狀態徽章＋每 5 秒輪詢所有卡片狀態),接進 `server-select.js`;卡片頂端加狀態徽章。
- 後端:提供 API 端點對「選中容器」呼叫 docker start/stop/restart(動作後回傳最新狀態);`state` 端點供輪詢,容器不存在回 `not_found`(非錯誤)、Docker 沒開回 503。
- 前端:控制列三顆按鈕(啟動/停止/重啟)＋顯示目前容器狀態;依狀態自動啟用/停用按鈕(執行中不能再啟動、停止中不能停止),動作進行中鎖住並顯示「處理中…」。停止/重啟會先跳確認(會中斷玩家)。啟動/重啟成功後自動讓 log 重新接上。
- 狀態自動更新:每 5 秒輪詢一次;清單上每台卡片都顯示狀態徽章(執行中綠/已停止灰/異常紅)。
- 錯誤處理:Docker Desktop 沒開→徽章顯示「Docker 未連線」且按鈕全停用;容器不存在→「找不到容器」;皆為清楚中文,不空轉。

### 第三階段:設定檔編輯器　✅ 已實作並驗證(2026-07-09)
目標:用表單/表格編輯選中伺服器的 5 個設定檔(路徑取自該 server 的 data_path),不用手動開記事本。前端整合為一個「⚙ 設定檔」modal,以分頁切換 server.properties 與 4 個 JSON 清單。

> 實作對應(Step A—server.properties):後端 `config_editor.read_properties`/`save_properties`(逐行比對只改 value、保留註解與順序、備份 .bak + 原子寫入 + UTF-8);`main.py` `GET/PUT /api/servers/{id}/properties`。前端 `props-meta.js`(所有欄位的型別/分組/繁中英說明,依 Java 版官方 Wiki 整理)、`config.js`(依實際檔案 key 分組渲染、依型別給控制項、每欄附說明、可搜尋、存檔後可一鍵重啟)。
> 實作對應(Step B—JSON 清單):後端 `config_editor` 的 `read_json_list`/`save_json_list`(限定 4 個檔名、備份 + 原子寫入)、`resolve_uuid`(online→先 usercache 再 Mojang API;offline→MD5 v3 離線演算法);`main.py` `GET/PUT /api/servers/{id}/lists/{kind}`(PUT 在容器執行中會回 409 擋下)、`POST /api/servers/{id}/resolve-uuid`。前端 `config.js` 以卡片列出每筆、可編輯各欄位/新增/刪除,新增玩家自動補 UUID 並顯示來源;執行中鎖住直接編輯並提示。
- `server.properties`:key-value 表格編輯,常見選項(難度、遊戲模式)做成下拉選單 ✅
  - **編輯檔案裡的所有 key**(不寫死常用清單);檔案有、metadata 沒有的 key 仍可用文字框編輯(標「無內建說明」)。
  - 解析時**保留 `#` 註解列與 key 的原始順序**,只改動 value ✅;檔案編碼固定 **UTF-8** ✅
- `ops.json` / `whitelist.json` 等:玩家清單的新增/刪除介面(輸入 ID 即可)✅
  - 伺服器**執行中**時:直接編輯已**鎖住**並提示「請先停止或等第四階段用指令」(RCON 指令 whitelist add / op / ban 由第四階段補上,由伺服器自己算 UUID、自己寫檔)。
  - 伺服器**停止**時:直接編輯 JSON ✅;新增玩家自動補 UUID:
    - `online-mode=true` → 先查 `usercache.json`,查不到再打 Mojang API ✅
    - `online-mode=false` → 用離線 UUID 演算法(MD5 v3,等同 Java `nameUUIDFromBytes`)✅
    - (online-mode 由該伺服器的 server.properties 現場讀取決定)✅
- **寫檔安全**:覆寫前先備份(`.bak`)+ 原子寫入(暫存檔→改名),避免寫壞 ✅
- server.properties 存檔後提示是否重啟容器讓設定生效 ✅;JSON 清單於停止時編輯,下次啟動生效(不需重啟提示)。
- **未儲存提示** ✅:編輯欄位/增刪清單會標記「● 未儲存」;關閉 modal 或切換分頁時若有未儲存變更會跳確認,避免沒按「儲存」就離開而遺失。

### 第四階段:指令輸入框 + 自動補全　✅ 已實作並驗證(2026-07-09)
目標:保留手動下指令的能力,但更好用。

> 實作對應:後端 `rcon_control.send_command`(讀 server.properties 取 enable-rcon/密碼/容器內埠 → `docker_control.get_host_port` 由 docker inspect 取主機埠 → mcrcon 連 127.0.0.1:主機埠 送指令;各種失敗轉中文);`main.py` `POST /api/servers/{id}/command`。前端 `command.js`(輸出區 + 輸入框 + 送出;內建常用指令自動補全、上下鍵歷史),接進 `server-select.js`(跟隨目前操作中伺服器、換台清空)。
- 後端:透過 **RCON** 送指令進「選中伺服器」並顯示回傳結果;RCON 密碼由 server.properties 現場讀取,連線**主機埠**由 docker inspect 取得(非容器內 rcon.port)。✅
- 前端:指令輸入框 + 輸出區顯示結果(去除 § 顏色碼);錯誤以紅字提示。✅
- 自動補全:**階層式指令樹**逐段提示——打指令名提示指令,打完一段再提示下一段的子指令(如 gamemode→survival/creative…、whitelist→add/remove/list…、time set→day/night…)與參數說明(灰字,如 give→<物品>→[數量]);Tab/Enter 採用、↑↓ 選候選。✅
  - **玩家名稱補全**:玩家類參數(如 op/gamemode/whitelist add/tp…)會列出「已知玩家名稱」供選(來源 `GET /api/servers/{id}/players`＝usercache.json＋whitelist/ops/banned 名單,去重排序);換台/送指令後刷新。✅
- 指令歷史(上下鍵切換,含草稿暫存)。✅
- 前置作業(已完成):MyServer 容器已重建並發布 25575、`enable-rcon=true`;偵測確認主機埠=25575。

## 重要技術注意事項

1. **改用 RCON 送指令(取代 stdin)**:在 `server.properties` 設定
   ```properties
   enable-rcon=true       # 啟用 RCON 遠端遙控(預設 false)
   rcon.password=請設一組複雜密碼   # 連入遙控時的驗證密碼,不要外流
   rcon.port=25575        # RCON 埠,跟遊戲的 25565 是不同的門
   ```
   改完需**重啟伺服器**才生效;Docker 容器也要把 25575 埠 `--publish` 出來讓工具連得到。
   RCON 只負責「送指令/收結果」,**不負責 log 串流**;log 仍走第一階段的 `docker logs -f`,兩者分工互補。
2. **多伺服器定址**:所有操作以 `server_id` 為準,後端從 `config.json` 取容器名 / data 路徑;RCON 密碼即時從該 server 的 `server.properties` 讀,`config.json` 不存密碼。RCON **主機埠**由 `docker inspect` 的 PortBindings 取得(不可直接用 server.properties 的容器內 `rcon.port`);且**每台伺服器的 RCON 必須發布到不同的主機埠**,否則會衝突連錯。
3. **資料夾瀏覽 API 安全**:列出資料夾的 API 必須**防路徑穿越(path traversal)**(例如過濾 `..`、限制在允許的根目錄內),只回傳資料夾清單,不可變成讀取整台機器敏感檔案的後門。
4. **自動偵測邏輯**:判斷是否為 MC 伺服器 = 資料夾內有 `server.properties`;容器對應 = `docker inspect` 各容器的 Mounts,找出掛載該 data 資料夾者;RCON 主機埠 = `docker inspect` 的 PortBindings(非 server.properties 的容器內 `rcon.port`)。
5. **JSON 清單的併發問題**:ops/whitelist/banned 這些檔在伺服器執行中由 Minecraft 掌管,執行中改清單一律走 RCON,停止時才直接編輯 JSON(見上方「重要原則」)。
6. **寫檔安全**:覆寫設定檔前先備份 + 原子寫入(寫暫存檔再改名),避免寫壞導致伺服器起不來。
7. **設定檔編碼**:server.properties 若含中文要注意 UTF-8 編碼;`server.properties` 要保留註解與原始順序。
8. **安全性**:透過 Tailscale 遠端存取(已是私人網路),工具本身可先不做複雜登入,但建議至少加一道簡單的 token 驗證;服務要綁 `127.0.0.1` 或 Tailscale 介面 IP,**絕不綁 `0.0.0.0`** 對公開網路開放。`config.json` /(若有).env 要寫進 `.gitignore`。
9. **設定檔即時生效問題**:多數 server.properties 設定改完需重啟容器;ops/whitelist 用 RCON 指令即時生效(或遊戲內 /reload、重啟)。
10. **錯誤處理**:Docker 沒開、容器不存在、RCON 連不上、選到的資料夾不是 MC 伺服器等情況,都要在 UI 給清楚的中文提示。

## 開發起步建議

開發時可以這樣起步:
1. 先建立專案資料夾結構(backend / frontend)
2. **先做第零階段(多伺服器地基)**:config.json 讀寫 + 伺服器清單 API + 資料夾瀏覽器 + 自動偵測,並讓清單至少有現有的 MyServer
3. 再做第一階段(即時 log),針對選中的伺服器,確認能跑起來再往下
4. 每個階段都先在本機 localhost 測試通過,再測 Tailscale 遠端
5. 建議用 Python 虛擬環境(venv)管理套件

## 建議的專案資料夾結構

```
minecraft-server-manager/
├── backend/
│   ├── main.py              # FastAPI 主程式
│   ├── server_registry.py   # 讀寫 config.json 的伺服器清單、自動偵測(讀 server.properties + docker inspect)
│   ├── fs_browser.py        # 資料夾瀏覽 API(列出目錄,含 path traversal 防護)
│   ├── docker_control.py    # 封裝 docker 操作(start/stop/restart/logs,對象為指定容器)
│   ├── rcon_control.py      # 封裝 RCON 連線與送指令(連線資訊依 server_id 取得)
│   ├── config_editor.py     # 讀寫設定檔(依 server 的 data_path;含備份、原子寫入、保留註解)
│   └── requirements.txt     # Python 套件清單
├── frontend/
│   ├── index.html
│   ├── style.css
│   ├── locales/             # 多語言語系檔(i18n)
│   │   ├── zh-TW.json        # 繁體中文(預設)
│   │   └── en.json           # English
│   └── js/
│       ├── i18n.js          # 語系載入 / 切換 / 記憶(localStorage)
│       ├── theme.js         # 白天 / 夜晚主題切換 + 記憶(localStorage)
│       ├── server-select.js # 伺服器選擇器 + 新增伺服器 + 資料夾瀏覽器
│       ├── log.js           # 即時 log 顯示 + WebSocket 重連
│       ├── control.js       # 伺服器控制按鈕
│       ├── config.js        # 設定檔編輯器
│       └── command.js       # 指令輸入框 + 自動補全
├── config.json              # 伺服器清單(不含密碼);含機器專屬路徑,需列入 .gitignore
├── config.example.json      # config.json 的範本(進版控,供新環境複製參考)
├── start.bat                # 啟動腳本:自動建立 .venv、裝套件,並用虛擬環境啟動服務
├── .venv/                   # Python 虛擬環境(由 start.bat 自動建立,列入 .gitignore)
├── .gitattributes           # 強制 *.bat 用 CRLF 換行(cmd.exe 才能正確解析)
├── .gitignore
└── README.md
```

## 未來構想(僅記錄,暫不規劃/實作)

> 以下為已提出但尚未展開的想法,先留記錄,現階段不規劃細節、也不實作。

- **建立伺服器功能**:直接從工具「建立一台全新的 Minecraft 伺服器」(例如產生 data 資料夾、初始化 server.properties、建立並啟動對應的 Docker 容器等)。目前僅記錄此需求,細節與做法待日後再議。
