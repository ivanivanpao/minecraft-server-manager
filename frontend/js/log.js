// 即時 log 顯示 + WebSocket 自動重連（第一階段，前端）
//
// 對外提供：
//   initLog()            —— 初始化：抓 DOM、綁定「清空 / 自動捲動」等控制項
//   showLogFor(server)   —— 切換到某台伺服器的 log 串流（server 可為 null 表示無伺服器）
//   retranslateLog()     —— 語言切換後，重新套用目前狀態文字（連線狀態是動態產生的）
//
// 設計：所有操作以「目前操作中」的伺服器為對象，串流走 WebSocket；
// Tailscale 遠端網路波動斷線時，前端會以遞增退避自動重連。

import { t } from './i18n.js';

const MAX_LINES = 2000; // log 區最多保留幾行（避免長時間累積吃記憶體）
const RECONNECT_MIN = 1000; // 自動重連起始延遲（毫秒）
const RECONNECT_MAX = 15000; // 自動重連最長延遲（毫秒）
const DEFAULT_TAIL = 200; // 首次連上先補幾行歷史 log

// DOM 元素（initLog 時填入）
let outEl = null;
let statusEl = null;
let nameEl = null;
let autoscrollEl = null;

// 目前串流狀態
let currentServerId = null;
let currentName = '';
let ws = null;
let reconnectTimer = null;
let reconnectDelay = RECONNECT_MIN;
let manualClose = false; // 主動關閉（切換伺服器時）不觸發自動重連
let cleanEnd = false; // 串流已正常結束（容器停止／錯誤）：不自動重連，避免一直重倒歷史 log
let hasConnected = false; // 這台伺服器是否已成功連上過（重連時只接新行，不再倒歷史）
let statusKey = 'log.status.idle'; // 記住目前狀態鍵，供語言切換後重新套字

// ---- 初始化 ----

export function initLog() {
  outEl = document.getElementById('log-output');
  statusEl = document.getElementById('log-status');
  nameEl = document.getElementById('log-server-name');
  autoscrollEl = document.getElementById('log-autoscroll');

  document.getElementById('log-clear').addEventListener('click', clearOutput);
  // 勾選「自動捲動」時立刻捲到底
  autoscrollEl.addEventListener('change', () => {
    if (autoscrollEl.checked) scrollToBottom();
  });

  setStatus('log.status.idle');
}

// ---- 切換伺服器 ----

// 切到指定伺服器的 log；同一台且連線仍活著時不重連（避免改名／切語言等重繪造成中斷）
export function showLogFor(server) {
  const id = server?.id ?? null;
  if (id === currentServerId && isActive()) {
    currentName = server?.display_name ?? currentName;
    updateHeader();
    return;
  }

  teardown(); // 關掉舊連線、取消待重連
  currentServerId = id;
  currentName = server?.display_name ?? '';
  hasConnected = false; // 換了一台，下次連上要重新補歷史
  clearOutput();
  updateHeader();

  if (!id) {
    setStatus('log.status.idle');
    showPlaceholder();
    return;
  }
  connect();
}

// 強制重新連線目前伺服器的 log（第二階段：啟動/重啟容器後呼叫，讓串流接回來）
export function reconnectLog() {
  if (!currentServerId) return;
  teardown(); // 關掉舊連線、取消待重連
  hasConnected = false; // 重新補一段歷史
  connect();
}

// 連線是否仍存活（連線中 / 已連上 / 排程重連中都算，避免不必要的重接）
function isActive() {
  if (reconnectTimer !== null) return true;
  return ws !== null && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN);
}

// ---- WebSocket 連線 ----

function connect() {
  if (!currentServerId) return;
  manualClose = false;
  cleanEnd = false;
  setStatus('log.status.connecting');

  // 首次連上補一段歷史；之後的自動重連只接「新行」（tail=0），避免把歷史再倒一次造成重複
  const tail = hasConnected ? 0 : DEFAULT_TAIL;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/ws/servers/${encodeURIComponent(currentServerId)}/logs?tail=${tail}`;
  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    hasConnected = true;
    reconnectDelay = RECONNECT_MIN; // 連上就把退避歸零
    setStatus('log.status.connected');
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    handleMessage(msg);
  });

  ws.addEventListener('close', () => {
    ws = null;
    if (manualClose) return; // 主動切換伺服器造成的關閉，不重連
    if (cleanEnd) return; // 串流已正常結束（容器停止／錯誤），不自動重連，避免一直重倒歷史
    // 沒收到結束訊息就斷了 = 非預期斷線（例如 Tailscale 網路波動）→ 自動重連
    setStatus('log.status.disconnected');
    scheduleReconnect();
  });

  // error 之後瀏覽器會接著觸發 close，重連交給 close 處理即可
  ws.addEventListener('error', () => {});
}

function scheduleReconnect() {
  if (reconnectTimer !== null) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  // 遞增退避，最多到 RECONNECT_MAX
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX);
}

// 關閉目前連線並取消待重連（切換伺服器或清場時用）
function teardown() {
  manualClose = true;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectDelay = RECONNECT_MIN;
  if (ws) {
    ws.close();
    ws = null;
  }
}

// ---- 處理後端訊息 ----

function handleMessage(msg) {
  switch (msg.type) {
    case 'log':
      appendLine(msg.line);
      break;
    case 'ended':
      // 容器停止／不存在造成串流自然結束：標記正常結束，onclose 就不會自動重連
      cleanEnd = true;
      setStatus('log.status.ended');
      break;
    case 'error':
      // 無法串流（沒對應容器、docker 沒開等）：也視為正常結束，不要一直重連洗版
      cleanEnd = true;
      appendSystem(msg.message);
      setStatus('log.status.error');
      break;
    case 'info':
    default:
      // info 目前不特別顯示，狀態列已足夠
      break;
  }
}

// ---- log 區內容操作 ----

function appendLine(text) {
  removePlaceholder();
  const stick = shouldStick();
  const line = document.createElement('div');
  line.className = 'log-line';
  line.textContent = text;
  outEl.appendChild(line);
  trimLines();
  if (stick) scrollToBottom();
}

// 系統訊息（例如錯誤），以不同樣式標示
function appendSystem(text) {
  removePlaceholder();
  const content = `⚠ ${text}`;
  // 去重：自動重連時同一則錯誤可能反覆出現，連續重複就不再堆一行
  const last = outEl.lastElementChild;
  if (last && last.classList.contains('log-line-system') && last.textContent === content) return;
  const stick = shouldStick();
  const line = document.createElement('div');
  line.className = 'log-line log-line-system';
  line.textContent = content;
  outEl.appendChild(line);
  trimLines();
  if (stick) scrollToBottom();
}

// 是否該在加入新行後自動捲到底：勾了「自動捲動」且目前已接近底部
function shouldStick() {
  if (!autoscrollEl.checked) return false;
  const gap = outEl.scrollHeight - outEl.scrollTop - outEl.clientHeight;
  return gap < 60; // 使用者若手動往上捲離底部，就不硬拉回來
}

function trimLines() {
  while (outEl.childElementCount > MAX_LINES) {
    outEl.removeChild(outEl.firstElementChild);
  }
}

function scrollToBottom() {
  outEl.scrollTop = outEl.scrollHeight;
}

function clearOutput() {
  outEl.innerHTML = '';
}

function showPlaceholder() {
  outEl.innerHTML = '';
  const ph = document.createElement('div');
  ph.className = 'log-placeholder';
  ph.textContent = t('log.placeholder');
  outEl.appendChild(ph);
}

function removePlaceholder() {
  const ph = outEl.querySelector('.log-placeholder');
  if (ph) ph.remove();
}

// ---- 標頭與狀態 ----

function updateHeader() {
  nameEl.textContent = currentName ? `— ${currentName}` : '';
}

function setStatus(key) {
  statusKey = key;
  if (!statusEl) return;
  statusEl.textContent = t(key);
  // 用 data 屬性讓 CSS 依狀態上色（連線 = 綠、斷線 = 灰、錯誤 = 紅）
  statusEl.dataset.state = key.split('.').pop();
}

// 語言切換後重新套用目前狀態與 placeholder 文字（這些是動態產生、不吃 data-i18n）
export function retranslateLog() {
  setStatus(statusKey);
  const ph = outEl?.querySelector('.log-placeholder');
  if (ph) ph.textContent = t('log.placeholder');
}
