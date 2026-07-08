// 伺服器清單（卡片顯示）+ 新增 / 編輯（改名）/ 刪除 + 資料夾瀏覽器（前端進入點）
// 本檔為 index.html 載入的唯一模組，負責 import 並啟動 i18n 與 theme。

import { initI18n, t, setLanguage, getLanguage } from './i18n.js';
import { initTheme, toggleTheme, getTheme } from './theme.js';
import { initLog, showLogFor, retranslateLog } from './log.js';
import { initControl, refreshControls } from './control.js';
import { initConfig } from './config.js';
import { initCommand, showCommandFor } from './command.js';

const SELECTED_KEY = 'msm.selectedServer'; // 記住「目前操作中」的伺服器 id（供後續階段使用）
let serversCache = [];
let statusCache = {}; // 每台伺服器的埠狀態快取（避免每次重繪都去查 docker）

// 把「主機端 / 容器端」埠組成 主機:容器 顯示；未發布時只顯示容器端
function portPair(host, container) {
  if (!container) return '—';
  if (host) return `${host}:${container}`;
  return t('port.container_only').replace('{port}', container);
}

// ---- 通用 API 呼叫（cache: no-store 避免拿到舊清單；失敗時丟出後端中文訊息）----
async function api(path, options) {
  const res = await fetch(path, { cache: 'no-store', ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `請求失敗（HTTP ${res.status}）`);
  return data;
}

// ---- 載入並渲染伺服器清單 ----

async function loadServers(selectId) {
  const { servers } = await api('/api/servers');
  serversCache = servers;
  statusCache = {}; // 清掉舊的埠資訊，重新偵測
  if (selectId) localStorage.setItem(SELECTED_KEY, selectId);
  renderServers();
}

// 目前操作中的伺服器 id（沒有記錄或已不存在時，預設第一台）
function currentSelectedId() {
  const saved = localStorage.getItem(SELECTED_KEY);
  if (saved && serversCache.some((s) => s.id === saved)) return saved;
  return serversCache.length ? serversCache[0].id : null;
}

// 目前操作中的伺服器物件（找不到回傳 null）
function currentServer() {
  const id = currentSelectedId();
  return serversCache.find((s) => s.id === id) || null;
}

function renderServers() {
  const grid = document.getElementById('server-grid');
  const empty = document.getElementById('empty-state');
  grid.innerHTML = '';

  if (serversCache.length === 0) {
    empty.classList.remove('hidden');
    showLogFor(null); // 沒有伺服器 → log 區顯示提示、關掉串流
    showCommandFor(null); // 隱藏指令主控台
    refreshControls(); // 隱藏控制列
    return;
  }
  empty.classList.add('hidden');

  const activeId = currentSelectedId();
  for (const server of serversCache) {
    grid.appendChild(buildCard(server, server.id === activeId));
    ensurePorts(server); // 非同步填入埠對應（不阻塞畫面）
  }

  // 讓 log 串流跟著「目前操作中」的伺服器走（showLogFor 對同一台會自動略過，不會重連）
  showLogFor(currentServer());
  // 指令主控台也跟著切換（換台會清空輸出）
  showCommandFor(currentServer());
  // 刷新控制列與各卡片狀態徽章（立即抓一次，不必等下一輪輪詢）
  refreshControls();
}

// 取得並填入某台的埠對應（優先用快取）
async function ensurePorts(server) {
  if (statusCache[server.id]) {
    applyPorts(server.id, statusCache[server.id]);
    return;
  }
  try {
    const st = await api(`/api/servers/${server.id}/status`);
    statusCache[server.id] = st;
    applyPorts(server.id, st);
  } catch {
    applyPorts(server.id, null);
  }
}

// 把埠資訊寫進對應卡片（重繪後仍以最新卡片元素為準）
function applyPorts(id, st) {
  const card = document.querySelector(`.server-card[data-id="${CSS.escape(id)}"]`);
  if (!card) return;
  const g = card.querySelector('.game-port');
  const r = card.querySelector('.rcon-port');
  if (g) g.textContent = st ? portPair(st.game_port_host, st.game_port_container) : '—';
  if (r) r.textContent = st ? portPair(st.rcon_port_host, st.rcon_port_container) : '—';
}

function buildCard(server, isActive) {
  const card = document.createElement('article');
  card.className = 'server-card' + (isActive ? ' active' : '');
  card.dataset.id = server.id;

  card.innerHTML = `
    <div class="card-top">
      <h3 class="server-name"></h3>
      <div class="card-tags">
        <span class="state-badge" data-kind="off">${t('state.checking')}</span>
        ${isActive ? `<span class="active-tag">${t('server.active')}</span>` : ''}
      </div>
    </div>
    <span class="badge">${server.id}</span>
    <dl class="kv">
      <dt>${t('server.container')}</dt><dd>${server.container_name || '—'}</dd>
      <dt>${t('server.game_port')}</dt><dd class="game-port muted">${t('common.detecting')}</dd>
      <dt>${t('server.rcon_port')}</dt><dd class="rcon-port muted">${t('common.detecting')}</dd>
      <dt>${t('server.data_path')}</dt><dd class="path"></dd>
    </dl>
    <div class="card-actions">
      <button class="btn ghost btn-edit">${t('common.edit')}</button>
      <button class="btn danger btn-delete">${t('common.delete')}</button>
    </div>
  `;
  // 名稱與路徑用 textContent 設定，避免使用者輸入被當成 HTML
  card.querySelector('.server-name').textContent = server.display_name;
  card.querySelector('.path').textContent = server.data_path;

  // 點卡片空白處 → 設為「目前操作中」
  card.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('input')) return;
    localStorage.setItem(SELECTED_KEY, server.id);
    renderServers();
  });
  card.querySelector('.btn-edit').addEventListener('click', () => startRename(card, server));
  card.querySelector('.btn-delete').addEventListener('click', () => deleteServer(server));
  return card;
}

// ---- 編輯（改名）：行內把名稱換成輸入框 ----

function startRename(card, server) {
  const nameEl = card.querySelector('.server-name');

  const wrap = document.createElement('div');
  wrap.className = 'rename-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = server.display_name;

  const save = document.createElement('button');
  save.className = 'btn primary sm';
  save.textContent = t('common.save');

  const cancel = document.createElement('button');
  cancel.className = 'btn ghost sm';
  cancel.textContent = t('common.cancel');

  wrap.append(input, save, cancel);
  nameEl.replaceWith(wrap);
  input.focus();
  input.select();

  const doSave = async () => {
    const newName = input.value.trim();
    if (!newName) { input.focus(); return; }
    try {
      await api(`/api/servers/${server.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: newName }),
      });
      await loadServers();
    } catch (e) {
      alert(e.message);
    }
  };
  save.addEventListener('click', doSave);
  cancel.addEventListener('click', renderServers);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSave();
    if (e.key === 'Escape') renderServers();
  });
}

// ---- 刪除 ----

async function deleteServer(server) {
  if (!confirm(t('confirm.delete').replace('{name}', server.display_name))) return;
  try {
    await api(`/api/servers/${server.id}`, { method: 'DELETE' });
    await loadServers();
  } catch (e) {
    alert(e.message);
  }
}

// ---- 新增伺服器 + 資料夾瀏覽器 ----

let fsCurrentPath = '';
let selectedDataPath = null;

function openModal() {
  selectedDataPath = null;
  document.getElementById('detect-result').classList.add('hidden');
  document.getElementById('display-name-row').classList.add('hidden');
  document.getElementById('btn-save-server').classList.add('hidden');
  document.getElementById('modal').classList.remove('hidden');
  browseTo(''); // 從磁碟機清單開始
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
}

async function browseTo(path) {
  let data;
  try {
    data = await api(`/api/fs/list?path=${encodeURIComponent(path || '')}`);
  } catch (e) {
    alert(e.message);
    return;
  }
  fsCurrentPath = data.path || '';
  document.getElementById('fs-current-path').textContent = fsCurrentPath || t('add.pick_drive');

  const list = document.getElementById('fs-list');
  list.innerHTML = '';

  if (data.path) {
    const upTarget = data.parent ?? '';
    list.appendChild(makeItem('⬆ ' + t('add.up'), () => browseTo(upTarget)));
  }
  for (const d of data.drives || []) {
    list.appendChild(makeItem('💽 ' + d.name, () => browseTo(d.path)));
  }
  for (const dir of data.dirs || []) {
    list.appendChild(makeItem('📁 ' + dir.name, () => browseTo(dir.path)));
  }

  const btn = document.getElementById('btn-select-folder');
  btn.disabled = !data.is_minecraft_server;
  btn.textContent = data.is_minecraft_server ? t('add.select_this') : t('add.not_mc');
}

function makeItem(label, onClick) {
  const li = document.createElement('li');
  li.textContent = label;
  li.addEventListener('click', onClick);
  return li;
}

async function detectSelected() {
  if (!fsCurrentPath) return;
  try {
    const result = await api('/api/servers/detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_path: fsCurrentPath }),
    });
    selectedDataPath = fsCurrentPath;
    showDetectResult(result);
  } catch (e) {
    alert(e.message);
  }
}

function showDetectResult(r) {
  const box = document.getElementById('detect-result');
  box.innerHTML = `
    <h3>${t('detect.title')}</h3>
    <ul>
      <li>${t('detect.container')}：${r.container_name || t('detect.container_missing')}</li>
      <li>${t('detect.online_mode')}：${r.online_mode ?? '—'}</li>
      <li>${t('server.game_port')}：${portPair(r.game_port_host, r.game_port_container)}</li>
      <li>${t('server.rcon_port')}：${portPair(r.rcon_port_host, r.rcon_port_container)}</li>
    </ul>`;
  box.classList.remove('hidden');

  const nameInput = document.getElementById('display-name');
  nameInput.value = fsCurrentPath.split(/[\\/]/).filter(Boolean).pop() || '';
  document.getElementById('display-name-row').classList.remove('hidden');
  document.getElementById('btn-save-server').classList.remove('hidden');
}

async function saveServer() {
  if (!selectedDataPath) return;
  try {
    const added = await api('/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data_path: selectedDataPath,
        display_name: document.getElementById('display-name').value,
      }),
    });
    closeModal();
    await loadServers(added.id); // 新增後自動設為目前操作中
  } catch (e) {
    alert(e.message);
  }
}

// ---- 啟動 ----

function updateThemeIcon() {
  document.getElementById('btn-theme').textContent = getTheme() === 'dark' ? '☀️' : '🌙';
}

async function main() {
  initTheme();
  updateThemeIcon();
  await initI18n();
  initLog();
  initControl({ getServers: () => serversCache, getActiveId: currentSelectedId });
  initConfig({ getActiveServer: currentServer });
  initCommand({ getActiveServer: currentServer });

  document.getElementById('btn-add-server').addEventListener('click', openModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-select-folder').addEventListener('click', detectSelected);
  document.getElementById('btn-save-server').addEventListener('click', saveServer);

  // 點對話框背景關閉
  document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal();
  });

  const langSelect = document.getElementById('lang-select');
  langSelect.value = getLanguage();
  langSelect.addEventListener('change', async (e) => {
    await setLanguage(e.target.value);
    renderServers(); // 卡片是動態產生，需重繪套用新語系
    retranslateLog(); // log 的狀態列與提示文字也隨語言更新
    // 控制列狀態文字也隨語言更新（renderServers 內的 refreshControls 會重抓並套新語系）
  });

  document.getElementById('btn-theme').addEventListener('click', () => {
    toggleTheme();
    updateThemeIcon();
  });

  await loadServers();
}

main().catch((e) => {
  console.error(e);
  alert('初始化失敗：' + e.message);
});
