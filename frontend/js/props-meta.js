// server.properties 欄位說明表（第三階段）——依 Java 版官方 Wiki 整理。
// 編輯器會依「實際檔案裡的 key」渲染；本表提供每個 key 的：
//   type    控制項型別：'bool' | 'enum' | 'int' | 'string'
//   group   分組（見 GROUP_ORDER）
//   options enum 的選項清單
//   min/max int 的建議範圍（僅提示，不強制）
//   secret  是否為密碼類（輸入框遮蔽 + 顯示切換）
//   zh/en   繁體中文 / English 說明
// 檔案裡有、但本表沒有的 key（例如模組自訂）仍可編輯，只是標「無內建說明」。

export const GROUP_ORDER = [
  'world',
  'gameplay',
  'players',
  'network',
  'resource',
  'rcon',
  'advanced',
];

export const PROPS_META = {
  // ---- 世界與生成 ----
  'level-name': { type: 'string', group: 'world', zh: '世界資料夾名稱，同時也是世界的顯示名稱。', en: 'World folder name and display name.' },
  'level-seed': { type: 'string', group: 'world', zh: '世界生成種子；留空則隨機產生。', en: 'World generation seed; random if blank.' },
  'level-type': { type: 'enum', group: 'world', options: ['minecraft:normal', 'minecraft:flat', 'minecraft:large_biomes', 'minecraft:amplified', 'minecraft:single_biome_surface'], zh: '世界類型：一般 / 超平坦 / 巨大生態域 / 放大化 / 單一生態域。', en: 'World preset: normal, flat, large biomes, amplified, single biome.' },
  'generator-settings': { type: 'string', group: 'world', zh: '世界生成的自訂參數（JSON），配合 level-type 使用。', en: 'Custom world generation parameters (JSON).' },
  'generate-structures': { type: 'bool', group: 'world', zh: '是否生成村莊、地牢、要塞等結構。', en: 'Generate structures like villages and dungeons.' },
  'max-world-size': { type: 'int', group: 'world', min: 1, max: 29999984, zh: '世界邊界距中心的最大半徑（方塊）。', en: 'World border radius from center (blocks).' },
  'spawn-protection': { type: 'int', group: 'world', min: 0, zh: '出生點周圍的保護半徑（方塊），非 OP 無法在此破壞/放置；0 關閉。', en: 'Protected radius around spawn; non-ops cannot build; 0 disables.' },

  // ---- 玩法與生物 ----
  'gamemode': { type: 'enum', group: 'gameplay', options: ['survival', 'creative', 'adventure', 'spectator'], zh: '預設遊戲模式：生存 / 創造 / 冒險 / 旁觀。', en: 'Default gamemode: survival, creative, adventure, spectator.' },
  'force-gamemode': { type: 'bool', group: 'gameplay', zh: '玩家每次加入都強制回到預設遊戲模式。', en: 'Force players to default gamemode on join.' },
  'difficulty': { type: 'enum', group: 'gameplay', options: ['peaceful', 'easy', 'normal', 'hard'], zh: '世界難度：和平 / 簡單 / 普通 / 困難。', en: 'World difficulty: peaceful, easy, normal, hard.' },
  'hardcore': { type: 'bool', group: 'gameplay', zh: '極限模式：難度鎖困難、死亡後變旁觀者。', en: 'Hardcore mode: difficulty locked to hard, death = spectator.' },
  'pvp': { type: 'bool', group: 'gameplay', zh: '是否允許玩家互相攻擊（PvP）。', en: 'Allow players to damage each other (PvP).' },
  'allow-nether': { type: 'bool', group: 'gameplay', zh: '是否允許玩家前往地獄（Nether）。', en: 'Allow players to travel to the Nether.' },
  'allow-flight': { type: 'bool', group: 'gameplay', zh: '生存模式是否允許用飛行類模組飛行（false 時久飛會被踢）。', en: 'Allow flight mods in survival (else long flight kicks).' },
  'enable-command-block': { type: 'bool', group: 'gameplay', zh: '是否啟用指令方塊。', en: 'Enable command blocks.' },
  'spawn-monsters': { type: 'bool', group: 'gameplay', zh: '是否生成敵對生物（怪物）。', en: 'Spawn hostile monsters.' },
  'spawn-animals': { type: 'bool', group: 'gameplay', zh: '是否生成動物。', en: 'Spawn animals.' },
  'spawn-npcs': { type: 'bool', group: 'gameplay', zh: '是否生成村民等 NPC。', en: 'Spawn NPCs such as villagers.' },
  'player-idle-timeout': { type: 'int', group: 'gameplay', min: 0, zh: '玩家閒置幾分鐘後踢出；0 表示不踢。', en: 'Minutes before idle players are kicked; 0 disables.' },

  // ---- 玩家與權限 ----
  'max-players': { type: 'int', group: 'players', min: 0, zh: '同時在線玩家上限。', en: 'Maximum simultaneous players.' },
  'white-list': { type: 'bool', group: 'players', zh: '是否啟用白名單（只有名單內玩家能進）。', en: 'Enable whitelist (only listed players can join).' },
  'enforce-whitelist': { type: 'bool', group: 'players', zh: '重新載入白名單時，把不在名單上的線上玩家踢除。', en: 'Kick non-whitelisted players when the list reloads.' },
  'online-mode': { type: 'bool', group: 'players', zh: '是否向 Mojang 驗證正版帳號（false 為離線模式，UUID 改用離線演算法）。', en: 'Verify accounts with Mojang (false = offline mode).' },
  'op-permission-level': { type: 'int', group: 'players', min: 0, max: 4, zh: '設為 OP 時給予的預設權限等級（0~4）。', en: 'Default permission level granted to operators (0-4).' },
  'function-permission-level': { type: 'int', group: 'players', min: 1, max: 4, zh: '資料包函式（function）的預設權限等級。', en: 'Default permission level for datapack functions (1-4).' },
  'hide-online-players': { type: 'bool', group: 'players', zh: '在伺服器狀態中隱藏線上玩家清單。', en: 'Hide the player list in status responses.' },
  'enforce-secure-profile': { type: 'bool', group: 'players', zh: '要求玩家具備 Mojang 簽章金鑰才能連線（聊天訊息簽章）。', en: 'Require Mojang-signed chat profiles to connect.' },
  'prevent-proxy-connections': { type: 'bool', group: 'players', zh: '阻擋透過 Proxy/VPN 的連線（依驗證伺服器回報的地區）。', en: 'Block connections via proxy/VPN.' },

  // ---- 網路與 MOTD ----
  'server-ip': { type: 'string', group: 'network', zh: '伺服器監聽的 IP；留空表示監聽所有網路介面。', en: 'IP to bind; blank listens on all interfaces.' },
  'server-port': { type: 'int', group: 'network', min: 1, max: 65535, zh: '玩家連線用的 TCP 埠（此為容器內埠；對外主機埠由 Docker 的 --publish 決定）。', en: 'TCP port for player connections (container-side).' },
  'motd': { type: 'string', group: 'network', zh: '顯示在伺服器列表的訊息（可用 § 顏色碼）。', en: 'Message shown in the server list.' },
  'network-compression-threshold': { type: 'int', group: 'network', zh: '封包超過幾 byte 才壓縮；-1 關閉、0 全部壓縮。', en: 'Min packet size to compress; -1 off, 0 all.' },
  'max-tick-time': { type: 'int', group: 'network', zh: '單一 tick 最長毫秒數，超過看門狗判定當機（-1 關閉）。', en: 'Max ms per tick before the watchdog acts (-1 off).' },
  'view-distance': { type: 'int', group: 'network', min: 3, max: 32, zh: '伺服器送給客戶端的可視區塊半徑。', en: 'Chunk radius sent to clients.' },
  'simulation-distance': { type: 'int', group: 'network', min: 3, max: 32, zh: '玩家周圍實際運算實體/方塊的區塊半徑。', en: 'Chunk radius simulated around players.' },
  'entity-broadcast-range-percentage': { type: 'int', group: 'network', min: 10, max: 1000, zh: '實體對玩家可見距離的百分比。', en: 'Entity visibility range as a percentage.' },
  'rate-limit': { type: 'int', group: 'network', min: 0, zh: '每位玩家每秒最大封包數；0 表示不限。', en: 'Max packets per player per second; 0 disables.' },
  'use-native-transport': { type: 'bool', group: 'network', zh: 'Linux 上啟用原生封包最佳化（epoll）。', en: 'Use Linux native transport optimization.' },
  'enable-status': { type: 'bool', group: 'network', zh: '是否在伺服器列表顯示狀態（可被 ping）。', en: 'Show server on the list (respond to ping).' },
  'log-ips': { type: 'bool', group: 'network', zh: '是否在主控台/log 記錄玩家 IP。', en: 'Log player IP addresses.' },
  'accepts-transfers': { type: 'bool', group: 'network', zh: '是否接受來自其他伺服器的轉送（transfer）封包。', en: 'Accept incoming transfer packets.' },
  'pause-when-empty-seconds': { type: 'int', group: 'network', min: 0, zh: '所有玩家離線幾秒後暫停世界運算（省資源）；0 關閉。', en: 'Seconds after everyone leaves before pausing; 0 off.' },
  'sync-chunk-writes': { type: 'bool', group: 'network', zh: '同步寫入區塊（較不易因當機損毀，但較慢）。', en: 'Synchronous chunk writes (safer, slower).' },
  'max-chained-neighbor-updates': { type: 'int', group: 'network', zh: '連鎖方塊更新的上限，超過就略過（防紅石卡死）。', en: 'Cap on chained neighbor block updates.' },
  'region-file-compression': { type: 'enum', group: 'network', options: ['deflate', 'lz4', 'none'], zh: '區塊檔的壓縮演算法。', en: 'Chunk region file compression.' },
  'enable-jmx-monitoring': { type: 'bool', group: 'network', zh: '透過 JMX 公開伺服器 tick 時間指標（供監控用）。', en: 'Expose tick metrics via JMX.' },

  // ---- 資源包 ----
  'resource-pack': { type: 'string', group: 'resource', zh: '資源包下載網址；玩家進入時提示下載。', en: 'Resource pack download URL.' },
  'resource-pack-sha1': { type: 'string', group: 'resource', zh: '資源包檔案的 SHA-1 雜湊，用來驗證完整性。', en: 'SHA-1 hash of the resource pack.' },
  'resource-pack-id': { type: 'string', group: 'resource', zh: '資源包的唯一識別碼（UUID）。', en: 'Resource pack UUID.' },
  'resource-pack-prompt': { type: 'string', group: 'resource', zh: '提示玩家套用資源包時顯示的自訂訊息。', en: 'Custom resource pack prompt message.' },
  'require-resource-pack': { type: 'bool', group: 'resource', zh: '玩家拒絕資源包時直接踢出。', en: 'Kick players who decline the resource pack.' },

  // ---- RCON / Query ----
  'enable-rcon': { type: 'bool', group: 'rcon', zh: '啟用 RCON 遠端主控台（第四階段送指令會用到）。', en: 'Enable RCON remote console.' },
  'rcon.password': { type: 'string', group: 'rcon', secret: true, zh: 'RCON 連線密碼；請設複雜密碼、勿外流。', en: 'RCON password; keep it strong and secret.' },
  'rcon.port': { type: 'int', group: 'rcon', min: 1, max: 65535, zh: 'RCON 的 TCP 埠（容器內埠；對外主機埠由 Docker --publish 決定）。', en: 'RCON TCP port (container-side).' },
  'broadcast-rcon-to-ops': { type: 'bool', group: 'rcon', zh: '把 RCON 指令輸出也廣播給線上 OP。', en: 'Broadcast RCON output to online ops.' },
  'broadcast-console-to-ops': { type: 'bool', group: 'rcon', zh: '把主控台指令輸出廣播給線上 OP。', en: 'Broadcast console output to online ops.' },
  'enable-query': { type: 'bool', group: 'rcon', zh: '啟用 GameSpy4（Query）協定，供外部查詢伺服器資訊。', en: 'Enable GameSpy4 Query protocol.' },
  'query.port': { type: 'int', group: 'rcon', min: 1, max: 65535, zh: 'Query 協定使用的 UDP 埠。', en: 'UDP port for the Query protocol.' },

  // ---- 進階與管理 ----
  'initial-enabled-packs': { type: 'string', group: 'advanced', zh: '建立世界時預設啟用的資料包（逗號分隔）。', en: 'Datapacks enabled on world creation (comma-separated).' },
  'initial-disabled-packs': { type: 'string', group: 'advanced', zh: '建立世界時排除自動啟用的資料包（逗號分隔）。', en: 'Datapacks excluded from auto-enable.' },
  'chat-spam-threshold-seconds': { type: 'int', group: 'advanced', zh: '聊天洗版的自動踢除門檻（秒）。', en: 'Chat spam auto-kick threshold (seconds).' },
  'command-spam-threshold-seconds': { type: 'int', group: 'advanced', zh: '指令洗版的自動踢除門檻（秒）。', en: 'Command spam auto-kick threshold (seconds).' },
  'text-filtering-config': { type: 'string', group: 'advanced', zh: '聊天文字過濾設定的參照。', en: 'Reference for chat text filtering config.' },
  'text-filtering-version': { type: 'int', group: 'advanced', zh: '文字過濾設定的版本格式。', en: 'Text filtering config version.' },
  'bug-report-link': { type: 'string', group: 'advanced', zh: '伺服器的問題回報連結。', en: "Server's bug report link." },
  'enable-code-of-conduct': { type: 'bool', group: 'advanced', zh: '啟用行為準則（code of conduct）檔案查找。', en: 'Enable code of conduct file lookup.' },
  'status-heartbeat-interval': { type: 'int', group: 'advanced', zh: '管理伺服器心跳通知的間隔。', en: 'Management server heartbeat interval.' },
  'management-server-enabled': { type: 'bool', group: 'advanced', zh: '啟用 Minecraft 伺服器管理協定（MSMP）。', en: 'Enable the Minecraft Server Management Protocol.' },
  'management-server-host': { type: 'string', group: 'advanced', zh: '管理伺服器綁定的主機位址。', en: 'Management server bind host.' },
  'management-server-port': { type: 'int', group: 'advanced', zh: '管理伺服器使用的埠。', en: 'Management server port.' },
  'management-server-secret': { type: 'string', group: 'advanced', secret: true, zh: '管理伺服器用戶端的授權祕密。', en: 'Management server authorization secret.' },
  'management-server-tls-enabled': { type: 'bool', group: 'advanced', zh: '管理伺服器是否啟用 TLS 加密。', en: 'Enable TLS for the management server.' },
  'management-server-tls-keystore': { type: 'string', group: 'advanced', zh: 'TLS 金鑰庫（keystore）檔案路徑。', en: 'TLS keystore file path.' },
  'management-server-tls-keystore-password': { type: 'string', group: 'advanced', secret: true, zh: 'TLS 金鑰庫密碼。', en: 'TLS keystore password.' },
  'management-server-allowed-origins': { type: 'string', group: 'advanced', zh: '管理伺服器允許的來源（origin）。', en: 'Allowed origins for the management server.' },
};
