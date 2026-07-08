// 伺服器控制（第二階段，前端）：對「目前操作中」的伺服器做 start / stop / restart，
// 並定時輪詢每台容器狀態，更新控制列按鈕與各卡片的狀態徽章。
//
// 對外提供：
//   initControl({ getServers, getActiveId })  —— 初始化：綁定按鈕、啟動定時輪詢
//   refreshControls()                         —— 立即刷新一次（切換/新增/刪除伺服器後呼叫）
//   stateMeta(state)                          —— 由狀態物件取得 { key, kind }（卡片徽章共用）

import { t } from './i18n.js';
import { reconnectLog } from './log.js';

const POLL_MS = 5000; // 狀態自動更新間隔（毫秒）

// server-select 注入的存取器
let getServers = () => [];
let getActiveId = () => null;

// DOM 元素（initControl 時填入）
let sectionEl = null;
let nameEl = null;
let stateEl = null;
let startBtn = null;
let stopBtn = null;
let restartBtn = null;

let busy = false; // 有動作進行中（start/stop/restart）→ 鎖住按鈕、暫停狀態覆寫

// ---- 狀態字串 → 顯示文字鍵與色系 ----
// kind：ok(綠)/off(灰)/warn(黃)/bad(紅)，對應 CSS 的 .state-badge[data-kind]
const STATE_MAP = {
  running: ['state.running', 'ok'],
  exited: ['state.exited', 'off'],
  created: ['state.created', 'off'],
  restarting: ['state.restarting', 'warn'],
  paused: ['state.paused', 'warn'],
  dead: ['state.dead', 'bad'],
  not_found: ['state.not_found', 'bad'],
  no_container: ['state.no_container', 'off'],
  docker_off: ['state.docker_off', 'bad'],
  checking: ['state.checking', 'off'],
};

export function stateMeta(state) {
  const status = state?.status || 'checking';
  const [key, kind] = STATE_MAP[status] || STATE_MAP.checking;
  return { key, kind };
}

// ---- 初始化 ----

export function initControl({ getServers: gs, getActiveId: ga }) {
  getServers = gs;
  getActiveId = ga;

  sectionEl = document.getElementById('control-section');
  nameEl = document.getElementById('control-server-name');
  stateEl = document.getElementById('control-state');
  startBtn = document.getElementById('btn-start');
  stopBtn = document.getElementById('btn-stop');
  restartBtn = document.getElementById('btn-restart');

  startBtn.addEventListener('click', () => runAction('start'));
  stopBtn.addEventListener('click', () => runAction('stop'));
  restartBtn.addEventListener('click', () => runAction('restart'));

  // 定時輪詢狀態（Docker 沒開時每次都會失敗顯示提示，但不影響其他功能）
  setInterval(refreshControls, POLL_MS);
}

// ---- 查詢狀態 ----

async function fetchState(id) {
  try {
    const res = await fetch(`/api/servers/${id}/state`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { status: 'docker_off', error: data.detail }; // 多半是 Docker 沒開
    return data; // { exists, running, status }
  } catch {
    return { status: 'docker_off' };
  }
}

// ---- 刷新控制列與各卡片徽章 ----

export async function refreshControls() {
  const servers = getServers();
  const activeId = getActiveId();
  const active = servers.find((s) => s.id === activeId) || null;

  // 控制列：有選中的伺服器才顯示
  if (!active) {
    sectionEl.classList.add('hidden');
  } else {
    sectionEl.classList.remove('hidden');
    nameEl.textContent = active.display_name;
  }

  // 逐台查狀態；更新卡片徽章，若為 active 再更新控制列
  await Promise.allSettled(
    servers.map(async (s) => {
      const state = await fetchState(s.id);
      applyCardBadge(s.id, state);
      if (s.id === activeId) applyControlState(state);
    })
  );
}

// 把狀態寫進某張卡片的徽章
function applyCardBadge(id, state) {
  const badge = document.querySelector(`.server-card[data-id="${CSS.escape(id)}"] .state-badge`);
  if (!badge) return;
  const { key, kind } = stateMeta(state);
  badge.textContent = t(key);
  badge.dataset.kind = kind;
}

// 更新控制列狀態徽章與三顆按鈕的可用性
function applyControlState(state) {
  if (busy) return; // 動作進行中：維持「處理中…」與鎖定，不被輪詢覆寫

  const { key, kind } = stateMeta(state);
  stateEl.textContent = t(key);
  stateEl.dataset.kind = kind;

  const exists = state?.exists === true;
  const running = state?.status === 'running';
  startBtn.disabled = !exists || running; // 已在跑就不能再啟動
  stopBtn.disabled = !exists || !running; // 沒在跑就不能停止
  restartBtn.disabled = !exists; // 只要容器存在都可重啟（停止中的會被帶起來）
}

// ---- 執行控制動作 ----

// 給設定檔存檔後呼叫：重啟目前操作中的伺服器（呼叫端已自行確認，這裡略過確認）
export function restartActiveSkipConfirm() {
  return runAction('restart', { skipConfirm: true });
}

async function runAction(action, opts = {}) {
  const id = getActiveId();
  if (!id || busy) return;

  const server = getServers().find((s) => s.id === id);
  const name = server?.display_name || id;

  // 停止 / 重啟會中斷線上玩家，先確認（skipConfirm 時略過，例如存檔後自動重啟）
  if ((action === 'stop' || action === 'restart') && !opts.skipConfirm) {
    if (!confirm(t(`confirm.${action}`).replace('{name}', name))) return;
  }

  busy = true;
  lockButtons();
  stateEl.textContent = t('control.working');
  stateEl.dataset.kind = 'warn';

  try {
    const res = await fetch(`/api/servers/${id}/${action}`, { method: 'POST', cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `操作失敗（HTTP ${res.status}）`);

    busy = false;
    applyControlState(data); // data 為動作後的最新狀態
    applyCardBadge(id, data);

    // 啟動 / 重啟成功後，讓即時 log 重新接上（先前容器停止時串流已結束）
    if (action === 'start' || action === 'restart') reconnectLog();
  } catch (e) {
    busy = false;
    alert(e.message);
    refreshControls(); // 失敗後重新抓一次真實狀態
  }
}

function lockButtons() {
  startBtn.disabled = true;
  stopBtn.disabled = true;
  restartBtn.disabled = true;
}
