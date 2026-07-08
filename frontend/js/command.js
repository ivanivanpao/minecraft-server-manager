// 指令輸入框 + 階層式自動補全 + 指令歷史（第四階段，前端）
//
// 對外提供：
//   initCommand({ getActiveServer })  —— 初始化：抓 DOM、綁定事件
//   showCommandFor(server)            —— 切換到某台伺服器（更新標題；換台就清空輸出）
//
// 透過 POST /api/servers/{id}/command 走 RCON 送指令並顯示結果。
// 自動補全：用「指令樹」逐段提示——打指令名提示指令、打完一段再提示下一段的
// 子指令（可選）與參數說明（灰字），上下鍵切換指令歷史。

import { t, getLanguage } from './i18n.js';

// 常用指令（root 層）：name + 繁中/英文簡述
const COMMANDS = [
  { name: 'list', zh: '列出線上玩家', en: 'List online players' },
  { name: 'say', zh: '以伺服器身分廣播訊息', en: 'Broadcast a message' },
  { name: 'tell', zh: '私訊某位玩家', en: 'Private message a player' },
  { name: 'me', zh: '以動作敘述廣播', en: 'Broadcast an action message' },
  { name: 'op', zh: '給予玩家 OP 權限', en: 'Grant operator status' },
  { name: 'deop', zh: '移除玩家 OP 權限', en: 'Revoke operator status' },
  { name: 'kick', zh: '把玩家踢出伺服器', en: 'Kick a player' },
  { name: 'ban', zh: '封鎖玩家', en: 'Ban a player' },
  { name: 'ban-ip', zh: '封鎖 IP', en: 'Ban an IP address' },
  { name: 'pardon', zh: '解除封鎖玩家', en: 'Unban a player' },
  { name: 'pardon-ip', zh: '解除封鎖 IP', en: 'Unban an IP' },
  { name: 'whitelist', zh: '白名單管理', en: 'Manage whitelist' },
  { name: 'gamemode', zh: '設定玩家遊戲模式', en: "Set a player's gamemode" },
  { name: 'defaultgamemode', zh: '設定預設遊戲模式', en: 'Set the default gamemode' },
  { name: 'difficulty', zh: '設定難度', en: 'Set difficulty' },
  { name: 'time', zh: '設定/查詢時間', en: 'Set or query time' },
  { name: 'weather', zh: '設定天氣', en: 'Set weather' },
  { name: 'give', zh: '給予玩家物品', en: 'Give items to a player' },
  { name: 'clear', zh: '清除玩家物品', en: "Clear a player's items" },
  { name: 'tp', zh: '傳送（teleport）', en: 'Teleport' },
  { name: 'teleport', zh: '傳送', en: 'Teleport' },
  { name: 'kill', zh: '殺死實體/玩家', en: 'Kill entities/players' },
  { name: 'xp', zh: '給予經驗', en: 'Give experience' },
  { name: 'experience', zh: '經驗管理（add/set/query）', en: 'Manage experience' },
  { name: 'effect', zh: '給予/清除狀態效果', en: 'Add/clear status effects' },
  { name: 'enchant', zh: '為手持物附魔', en: 'Enchant held item' },
  { name: 'gamerule', zh: '設定遊戲規則', en: 'Set a game rule' },
  { name: 'setworldspawn', zh: '設定世界出生點', en: 'Set world spawn' },
  { name: 'spawnpoint', zh: '設定玩家重生點', en: 'Set a spawn point' },
  { name: 'summon', zh: '生成實體', en: 'Summon an entity' },
  { name: 'title', zh: '顯示標題文字', en: 'Show title text' },
  { name: 'scoreboard', zh: '計分板管理', en: 'Manage scoreboards' },
  { name: 'worldborder', zh: '世界邊界設定', en: 'World border settings' },
  { name: 'seed', zh: '顯示世界種子', en: 'Show the world seed' },
  { name: 'save-all', zh: '立即存檔', en: 'Save the world now' },
  { name: 'save-off', zh: '關閉自動存檔', en: 'Disable auto-save' },
  { name: 'save-on', zh: '開啟自動存檔', en: 'Enable auto-save' },
  { name: 'reload', zh: '重新載入資料包', en: 'Reload datapacks' },
  { name: 'datapack', zh: '資料包管理', en: 'Manage datapacks' },
  { name: 'stop', zh: '關閉伺服器', en: 'Stop the server' },
];

const COMMAND_HINTS = Object.fromEntries(COMMANDS.map((c) => [c.name, { zh: c.zh, en: c.en }]));

// ---- 指令樹（逐段補全）----
// 節點：{ children?: {名稱: 節點}, arg?: {label, hint}, argNext?: 節點 }
// children＝可選的子指令（可補全）；arg＝這一段是自由參數（顯示灰字提示）；argNext＝參數後的續接節點
const branch = (children) => ({ children });
const arg = (label, hint = '', next = null) => ({ arg: { label, hint }, argNext: next });
const modeArg = () => arg('[玩家]', '目標玩家，省略＝自己');

function gameruleChildren() {
  const rules = [
    'keepInventory', 'doDaylightCycle', 'doWeatherCycle', 'doMobSpawning', 'mobGriefing',
    'doFireTick', 'doInsomnia', 'doImmediateRespawn', 'showDeathMessages', 'fallDamage',
    'naturalRegeneration', 'randomTickSpeed', 'doMobLoot', 'doTileDrops', 'doEntityDrops',
    'commandBlockOutput', 'sendCommandFeedback', 'announceAdvancements', 'spawnRadius',
    'playersSleepingPercentage',
  ];
  const out = {};
  for (const r of rules) out[r] = arg('[值]', 'true/false 或數值');
  return out;
}

const SUBTREES = {
  gamemode: branch({ survival: modeArg(), creative: modeArg(), adventure: modeArg(), spectator: modeArg() }),
  defaultgamemode: branch({ survival: {}, creative: {}, adventure: {}, spectator: {} }),
  difficulty: branch({ peaceful: {}, easy: {}, normal: {}, hard: {} }),
  weather: branch({ clear: arg('[秒數]', '持續時間'), rain: arg('[秒數]', '持續時間'), thunder: arg('[秒數]', '持續時間') }),
  time: branch({
    set: { children: { day: {}, night: {}, noon: {}, midnight: {} }, arg: { label: '[刻度]', hint: '或直接輸入數字' } },
    add: arg('<刻度>', '要增加的時間'),
    query: branch({ daytime: {}, gametime: {}, day: {} }),
  }),
  whitelist: branch({
    add: arg('<玩家>', '要加入白名單的玩家'),
    remove: arg('<玩家>', '要移除的玩家'),
    list: {}, on: {}, off: {}, reload: {},
  }),
  effect: branch({
    give: arg('<目標>', '玩家/選擇器', arg('<效果>', '效果 ID，如 minecraft:speed')),
    clear: arg('<目標>', '要清除效果的目標'),
  }),
  experience: branch({
    add: arg('<玩家>', '', arg('<數量>', '經驗值或等級')),
    set: arg('<玩家>', '', arg('<數量>', '')),
    query: arg('<玩家>', '', branch({ points: {}, levels: {} })),
  }),
  xp: arg('<數量>', '可加 L 表等級', arg('[玩家]', '')),
  datapack: branch({ list: {}, enable: arg('<名稱>', '資料包名稱'), disable: arg('<名稱>', '資料包名稱') }),
  title: arg('<玩家>', '目標玩家', branch({
    title: arg('<JSON>', '標題內容'),
    subtitle: arg('<JSON>', '副標題'),
    actionbar: arg('<JSON>', '動作列文字'),
    clear: {}, reset: {},
    times: arg('<淡入>', '', arg('<停留>', '', arg('<淡出>', ''))),
  })),
  worldborder: branch({
    set: arg('<距離>', '邊界直徑'), add: arg('<距離>', ''),
    center: arg('<x>', '', arg('<z>', '')), get: {},
    damage: branch({ amount: arg('<值>', ''), buffer: arg('<值>', '') }),
    warning: branch({ distance: arg('<值>', ''), time: arg('<秒>', '') }),
  }),
  scoreboard: branch({
    objectives: branch({ list: {}, add: arg('<名稱>', '', arg('<準則>', '')), remove: arg('<名稱>', ''), setdisplay: arg('<位置>', '') }),
    players: branch({ set: arg('<目標>', '', arg('<項目>', '', arg('<值>', ''))), add: arg('<目標>', ''), remove: arg('<目標>', ''), reset: arg('<目標>', ''), list: {} }),
  }),
  gamerule: { children: gameruleChildren() },
  give: arg('<玩家>', '', arg('<物品>', '物品 ID', arg('[數量]', ''))),
  clear: arg('[玩家]', '省略＝自己', arg('[物品]', '限定物品')),
  enchant: arg('<玩家>', '', arg('<附魔>', '附魔 ID', arg('[等級]', ''))),
  summon: arg('<實體>', '如 minecraft:zombie', arg('[x y z]', '座標')),
  kill: arg('[目標]', '省略＝自己'),
  tp: arg('<目標/目的地>', '玩家或座標', arg('[目的地]', '')),
  teleport: arg('<目標/目的地>', '玩家或座標', arg('[目的地]', '')),
  op: arg('<玩家>', '給 OP 的玩家'),
  deop: arg('<玩家>', '移除 OP 的玩家'),
  kick: arg('<玩家>', '', arg('[原因]', '')),
  ban: arg('<玩家>', '', arg('[原因]', '')),
  'ban-ip': arg('<IP/玩家>', '', arg('[原因]', '')),
  pardon: arg('<玩家>', '要解除封鎖的玩家'),
  'pardon-ip': arg('<IP>', '要解除封鎖的 IP'),
  say: arg('<訊息>', '廣播內容'),
  me: arg('<動作>', '動作敘述'),
  tell: arg('<玩家>', '', arg('<訊息>', '')),
  setworldspawn: arg('[x y z]', '省略＝目前位置'),
  spawnpoint: arg('[玩家]', '', arg('[x y z]', '')),
  // 其餘（list/seed/save-*/reload/stop）為葉節點，無參數
};

// 根節點：children = 所有 root 指令 → 其子樹（沒有子樹的就空節點）
const ROOT = { children: Object.fromEntries(COMMANDS.map((c) => [c.name, SUBTREES[c.name] || {}])) };

const MAX_OUTPUT = 500; // 輸出區最多保留幾則
const MAX_SUGGEST = 8;

let getActiveServer = () => null;

// DOM
let sectionEl = null;
let nameEl = null;
let outEl = null;
let inputEl = null;
let suggestEl = null;

let currentId = null;
let players = []; // 目前伺服器「已知玩家名稱」快取（供玩家類參數補全）
const history = []; // 送出過的指令
let histIndex = -1; // 目前在歷史中的位置；-1 表示不在瀏覽歷史
let draft = ''; // 進入歷史瀏覽前，暫存正在打的內容
let suggestItems = []; // 目前「可選」的補全候選（不含灰字參數提示）
let suggestActive = -1; // 反白中的候選 index
let suggestBase = ''; // 目前輸入中，除了「正在打的那一段」以外的前綴（採用候選時保留）

// ---- 初始化 ----

export function initCommand({ getActiveServer: gas }) {
  getActiveServer = gas;

  sectionEl = document.getElementById('command-section');
  nameEl = document.getElementById('cmd-server-name');
  outEl = document.getElementById('cmd-output');
  inputEl = document.getElementById('cmd-input');
  suggestEl = document.getElementById('cmd-suggest');

  document.getElementById('cmd-send').addEventListener('click', send);
  document.getElementById('cmd-clear').addEventListener('click', () => (outEl.innerHTML = ''));

  inputEl.addEventListener('input', updateSuggest);
  inputEl.addEventListener('keydown', onKeydown);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.cmd-input-wrap')) closeSuggest();
  });
}

// ---- 切換伺服器 ----

export function showCommandFor(server) {
  const id = server?.id ?? null;
  if (!id) {
    sectionEl.classList.add('hidden');
    currentId = null;
    return;
  }
  sectionEl.classList.remove('hidden');
  nameEl.textContent = server.display_name ? `— ${server.display_name}` : '';
  if (id !== currentId) {
    currentId = id;
    outEl.innerHTML = '';
    closeSuggest();
  }
  fetchPlayers(id); // 抓「已知玩家名稱」快取（換台或重開都刷新）
}

// 抓某台伺服器的已知玩家名稱（失敗就給空清單，只是少了玩家補全，不影響其他）
async function fetchPlayers(id) {
  try {
    const res = await fetch(`/api/servers/${id}/players`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    players = res.ok && Array.isArray(data.names) ? data.names : [];
  } catch {
    players = [];
  }
}

// ---- 送出指令 ----

async function send() {
  const server = getActiveServer();
  const command = inputEl.value.trim();
  if (!server || !command) return;

  closeSuggest();
  history.unshift(command);
  histIndex = -1;
  draft = '';
  inputEl.value = '';

  appendEcho(command);
  try {
    const res = await fetch(`/api/servers/${server.id}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `送出失敗（HTTP ${res.status}）`);
    appendResult(cleanText(data.output));
    fetchPlayers(server.id); // 指令可能新增玩家（op/whitelist add…），刷新名稱快取
  } catch (e) {
    appendError(e.message);
  }
}

function cleanText(text) {
  return String(text ?? '').replace(/§./g, ''); // 去除 § 顏色控制碼
}

// ---- 輸出區 ----

function appendEcho(cmd) {
  addLine('cmd-echo', `> ${cmd}`);
}
function appendResult(text) {
  addLine('cmd-result', text || t('cmd.no_output'));
}
function appendError(text) {
  addLine('cmd-err', `⚠ ${text}`);
}
function addLine(cls, text) {
  const line = document.createElement('div');
  line.className = `cmd-line ${cls}`;
  line.textContent = text;
  outEl.appendChild(line);
  while (outEl.childElementCount > MAX_OUTPUT) outEl.removeChild(outEl.firstElementChild);
  outEl.scrollTop = outEl.scrollHeight;
}

// ---- 指令歷史（上下鍵）----

function histPrev() {
  if (history.length === 0) return;
  if (histIndex === -1) draft = inputEl.value;
  histIndex = Math.min(histIndex + 1, history.length - 1);
  inputEl.value = history[histIndex];
  moveCaretEnd();
}
function histNext() {
  if (histIndex === -1) return;
  histIndex -= 1;
  inputEl.value = histIndex === -1 ? draft : history[histIndex];
  moveCaretEnd();
}
function moveCaretEnd() {
  const len = inputEl.value.length;
  requestAnimationFrame(() => inputEl.setSelectionRange(len, len));
}

// ---- 自動補全（走指令樹）----

// 把輸入拆成：completed（已完成的段）、prefix（正在打的段）、base（prefix 以外的原字串）
function tokenize(val) {
  const trailingSpace = /\s$/.test(val);
  const parts = val.split(/\s+/).filter(Boolean);
  if (trailingSpace) return { completed: parts, prefix: '', base: val };
  const prefix = parts.length ? parts[parts.length - 1] : '';
  const completed = parts.slice(0, -1);
  const base = prefix ? val.slice(0, val.length - prefix.length) : val;
  return { completed, prefix, base };
}

// 依已完成的段，走到指令樹對應的節點；走不下去回 null
function walkTree(completed) {
  let node = ROOT;
  for (const tok of completed) {
    const key = tok.toLowerCase();
    if (node.children && node.children[key]) node = node.children[key];
    else if (node.arg) node = node.argNext || {};
    else return null;
  }
  return node;
}

function updateSuggest() {
  if (!inputEl.value.length) return closeSuggest();

  const lang = getLanguage();
  const { completed, prefix, base } = tokenize(inputEl.value);
  const node = walkTree(completed);
  if (!node) return closeSuggest();

  const pfx = prefix.toLowerCase();
  const literals = [];
  if (node.children) {
    for (const [name, child] of Object.entries(node.children)) {
      if (!name.startsWith(pfx) || name === prefix) continue;
      const hint = completed.length === 0
        ? (lang === 'en' ? COMMAND_HINTS[name]?.en : COMMAND_HINTS[name]?.zh) || ''
        : child.hint || '';
      literals.push({ name, hint });
    }
  }
  literals.sort((a, b) => a.name.localeCompare(b.name));

  // 若這一段是「玩家類」參數（label 含 玩家/目標），補上快取的玩家名稱作為可選候選
  const selectable = [...literals];
  if (node.arg && /玩家|目標/.test(node.arg.label)) {
    for (const name of players) {
      if (name.toLowerCase().startsWith(pfx)) selectable.push({ name, hint: t('cmd.player') });
    }
  }

  // 參數提示（灰字、不可選）：這一段是自由參數、且沒有可選候選時才顯示
  const argHint = node.arg && selectable.length === 0 ? node.arg : null;

  if (selectable.length === 0 && !argHint) return closeSuggest();

  suggestBase = base;
  suggestItems = selectable.slice(0, MAX_SUGGEST);
  suggestActive = -1;
  suggestEl.innerHTML = '';

  suggestItems.forEach((c, i) => {
    const li = document.createElement('li');
    li.className = 'cmd-suggest-item';
    li.dataset.i = i;
    const name = document.createElement('span');
    name.className = 'cmd-suggest-name';
    name.textContent = c.name;
    const hint = document.createElement('span');
    hint.className = 'cmd-suggest-hint';
    hint.textContent = c.hint;
    li.append(name, hint);
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      acceptSuggest(i);
    });
    suggestEl.appendChild(li);
  });

  if (argHint) {
    const li = document.createElement('li');
    li.className = 'cmd-suggest-arg';
    li.textContent = `${argHint.label}${argHint.hint ? '　' + argHint.hint : ''}`;
    suggestEl.appendChild(li);
  }

  suggestEl.classList.remove('hidden');
}

function closeSuggest() {
  suggestItems = [];
  suggestActive = -1;
  suggestEl.classList.add('hidden');
  suggestEl.innerHTML = '';
}

// 只有「有可選候選」時才進入補全鍵盤模式（純參數提示時，上下鍵仍走歷史）
function isSuggestOpen() {
  return suggestItems.length > 0 && !suggestEl.classList.contains('hidden');
}

function moveSuggest(delta) {
  suggestActive = (suggestActive + delta + suggestItems.length) % suggestItems.length;
  for (const li of suggestEl.querySelectorAll('.cmd-suggest-item')) {
    li.classList.toggle('active', Number(li.dataset.i) === suggestActive);
  }
}

// 採用候選：把「正在打的那一段」換成候選名稱 + 空格，並立刻算下一段的提示
function acceptSuggest(index) {
  const i = index ?? (suggestActive >= 0 ? suggestActive : 0);
  const cmd = suggestItems[i];
  if (!cmd) return;
  inputEl.value = suggestBase + cmd.name + ' ';
  closeSuggest();
  inputEl.focus();
  moveCaretEnd();
  updateSuggest(); // 連續補全：立刻提示下一段
}

// ---- 鍵盤 ----

function onKeydown(e) {
  if (isSuggestOpen()) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSuggest(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveSuggest(-1); return; }
    if (e.key === 'Tab') { e.preventDefault(); acceptSuggest(); return; }
    if (e.key === 'Escape') { e.preventDefault(); closeSuggest(); return; }
    if (e.key === 'Enter' && suggestActive >= 0) { e.preventDefault(); acceptSuggest(); return; }
  } else {
    if (e.key === 'ArrowUp') { e.preventDefault(); histPrev(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); histNext(); return; }
  }
  if (e.key === 'Enter') { e.preventDefault(); send(); }
}
