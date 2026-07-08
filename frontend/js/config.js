// 設定檔編輯器（第三階段）（前端）
//
// 分頁：server.properties + 4 個 JSON 清單（ops / whitelist / banned-players / banned-ips）。
//   - server.properties：依 props-meta 分組、依型別給控制項、每欄附說明、可搜尋，存檔後可一鍵重啟。
//   - JSON 清單：以卡片列出每筆、可編輯各欄位、可新增/刪除；新增玩家自動補 UUID。
//     伺服器「執行中」時鎖住直接編輯（清單由伺服器掌管；那條路留給第四階段 RCON）。
//
// 對外提供：
//   initConfig({ getActiveServer })
//   openConfig(server)

import { t, getLanguage } from './i18n.js';
import { GROUP_ORDER, PROPS_META } from './props-meta.js';
import { restartActiveSkipConfirm } from './control.js';

// 分頁定義；JSON 清單附各自的欄位結構與「新增時的預設值」
const LIST_SCHEMAS = {
  ops: {
    player: true,
    fields: [
      { k: 'name', type: 'string' },
      { k: 'uuid', type: 'string' },
      { k: 'level', type: 'int', min: 0, max: 4 },
      { k: 'bypassesPlayerLimit', type: 'bool' },
    ],
    make: (r) => ({ uuid: r.uuid, name: r.name, level: 4, bypassesPlayerLimit: false }),
  },
  whitelist: {
    player: true,
    fields: [
      { k: 'name', type: 'string' },
      { k: 'uuid', type: 'string' },
    ],
    make: (r) => ({ uuid: r.uuid, name: r.name }),
  },
  'banned-players': {
    player: true,
    fields: [
      { k: 'name', type: 'string' },
      { k: 'uuid', type: 'string' },
      { k: 'reason', type: 'string' },
      { k: 'source', type: 'string' },
      { k: 'created', type: 'string' },
      { k: 'expires', type: 'string' },
    ],
    make: (r) => ({ uuid: r.uuid, name: r.name, created: nowStamp(), source: '管理工具', expires: 'forever', reason: 'Banned by an operator.' }),
  },
  'banned-ips': {
    player: false,
    fields: [
      { k: 'ip', type: 'string' },
      { k: 'reason', type: 'string' },
      { k: 'source', type: 'string' },
      { k: 'created', type: 'string' },
      { k: 'expires', type: 'string' },
    ],
    make: (ip) => ({ ip, created: nowStamp(), source: '管理工具', expires: 'forever', reason: 'Banned by an operator.' }),
  },
};

let getActiveServer = () => null;

// DOM
let modalEl = null;
let bodyEl = null;
let nameEl = null;
let filterEl = null;
let toolbarEl = null;
let tabBarEl = null;
let noteEl = null;
let saveBtn = null;
let dirtyEl = null;

let currentServer = null;
let activeTab = 'properties';
let currentState = null; // 容器狀態（判斷 JSON 清單能否直接編輯）
let currentEntries = []; // JSON 清單的目前資料（編輯中）
let pendingAddInfo = ''; // 新增玩家後要顯示的來源訊息（usercache/mojang/offline）
let dirty = false; // 是否有未儲存的變更（用來提示、並在關閉/切分頁時攔截）

// ---- 初始化 ----

export function initConfig({ getActiveServer: gas }) {
  getActiveServer = gas;

  modalEl = document.getElementById('config-modal');
  bodyEl = document.getElementById('config-body');
  nameEl = document.getElementById('config-server-name');
  filterEl = document.getElementById('config-filter');
  toolbarEl = document.getElementById('config-toolbar');
  tabBarEl = document.getElementById('config-tabs');
  noteEl = document.getElementById('config-note');
  saveBtn = document.getElementById('config-save');
  dirtyEl = document.getElementById('config-dirty');

  document.getElementById('btn-edit-config').addEventListener('click', () => {
    const server = getActiveServer();
    if (server) openConfig(server);
  });
  document.getElementById('config-close-x').addEventListener('click', closeConfig);
  document.getElementById('config-cancel').addEventListener('click', closeConfig);
  saveBtn.addEventListener('click', save);
  filterEl.addEventListener('input', applyFilter);

  // 使用者編輯任一欄位（表單控制項）即標記為未儲存；add 輸入框不算（還沒真的加入清單）
  const onEdit = (e) => {
    if (e.target.closest('.list-add')) return;
    setDirty(true);
  };
  bodyEl.addEventListener('input', onEdit);
  bodyEl.addEventListener('change', onEdit);

  tabBarEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (btn) switchTab(btn.dataset.tab);
  });

  modalEl.addEventListener('click', (e) => {
    if (e.target.id === 'config-modal') closeConfig();
  });
}

// ---- 開啟 / 關閉 ----

export async function openConfig(server) {
  currentServer = server;
  nameEl.textContent = server.display_name || server.id;
  setDirty(false);
  modalEl.classList.remove('hidden');

  // 先抓一次容器狀態（決定 JSON 清單能否編輯）；抓不到當作沒在跑
  currentState = await fetchState(server.id);
  switchTab('properties', true);
}

function closeConfig() {
  // 有未儲存變更時先確認，避免誤丟（切分頁/關閉都會走這個提示）
  if (dirty && !confirm(t('cfg.unsaved'))) return;
  modalEl.classList.add('hidden');
  currentServer = null;
  currentEntries = [];
  setDirty(false);
}

// 設定「未儲存」狀態並更新底部提示
function setDirty(flag) {
  dirty = flag;
  if (dirtyEl) dirtyEl.classList.toggle('hidden', !flag);
}

async function fetchState(id) {
  try {
    const res = await fetch(`/api/servers/${id}/state`, { cache: 'no-store' });
    if (!res.ok) return { running: false };
    return await res.json();
  } catch {
    return { running: false };
  }
}

// ---- 分頁切換 ----

function switchTab(tab, force = false) {
  // 有未儲存變更時，切換分頁會丟掉目前分頁的編輯 → 先確認（force 用於開啟時的初次載入）
  if (!force && dirty && !confirm(t('cfg.unsaved'))) return;
  setDirty(false);

  activeTab = tab;
  for (const btn of tabBarEl.querySelectorAll('[data-tab]')) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  }

  // 只有 server.properties 分頁用得到搜尋框
  toolbarEl.classList.toggle('hidden', tab !== 'properties');

  if (tab === 'properties') {
    loadProperties();
  } else {
    loadJsonList(tab);
  }
}

// ---- server.properties 分頁 ----

async function loadProperties() {
  bodyEl.innerHTML = `<div class="cfg-loading">${t('common.detecting')}</div>`;
  noteEl.textContent = t('cfg.restart_note');
  saveBtn.disabled = false;
  try {
    const res = await fetch(`/api/servers/${currentServer.id}/properties`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `讀取失敗（HTTP ${res.status}）`);
    renderForm(data.entries || []);
    if (filterEl.value) applyFilter();
  } catch (e) {
    showError(e.message);
  }
}

function renderForm(entries) {
  bodyEl.innerHTML = '';
  const lang = getLanguage();

  const buckets = {};
  for (const { key, value } of entries) {
    const meta = PROPS_META[key];
    const group = meta?.group || 'other';
    (buckets[group] ||= []).push({ key, value, meta });
  }

  for (const group of [...GROUP_ORDER, 'other']) {
    const items = buckets[group];
    if (!items || items.length === 0) continue;
    const section = document.createElement('section');
    section.className = 'cfg-group';
    const h = document.createElement('h3');
    h.textContent = t(`cfg.group.${group}`);
    section.appendChild(h);
    for (const item of items) section.appendChild(buildPropRow(item, lang));
    bodyEl.appendChild(section);
  }
  if (!bodyEl.childElementCount) showError(t('cfg.empty'));
}

function buildPropRow({ key, value, meta }, lang) {
  const row = document.createElement('div');
  row.className = 'cfg-row';
  row.dataset.key = key.toLowerCase();
  const desc = meta ? (lang === 'en' ? meta.en : meta.zh) : t('cfg.no_desc');
  row.dataset.desc = desc.toLowerCase();

  const labelWrap = document.createElement('div');
  labelWrap.className = 'cfg-label';
  const keyEl = document.createElement('label');
  keyEl.className = 'cfg-key';
  keyEl.textContent = key;
  const descEl = document.createElement('p');
  descEl.className = 'cfg-desc' + (meta ? '' : ' cfg-desc-none');
  descEl.textContent = desc;
  labelWrap.append(keyEl, descEl);

  const controlWrap = document.createElement('div');
  controlWrap.className = 'cfg-control';
  controlWrap.appendChild(buildPropControl(key, value, meta));

  row.append(labelWrap, controlWrap);
  return row;
}

function buildPropControl(key, value, meta) {
  const type = meta?.type || 'string';

  if (type === 'bool') {
    const label = document.createElement('label');
    label.className = 'cfg-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = String(value).trim() === 'true';
    input.dataset.cfgKey = key;
    input.dataset.cfgType = 'bool';
    const track = document.createElement('span');
    track.className = 'cfg-switch-track';
    label.append(input, track);
    return label;
  }

  if (type === 'enum') {
    const select = document.createElement('select');
    select.className = 'control';
    select.dataset.cfgKey = key;
    select.dataset.cfgType = 'enum';
    const options = [...(meta.options || [])];
    if (value && !options.includes(value)) options.unshift(value);
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (opt === value) o.selected = true;
      select.appendChild(o);
    }
    return select;
  }

  if (type === 'int') {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'control';
    input.value = value;
    input.dataset.cfgKey = key;
    input.dataset.cfgType = 'int';
    if (meta.min !== undefined) input.min = meta.min;
    if (meta.max !== undefined) input.max = meta.max;
    return input;
  }

  if (meta?.secret) {
    const wrap = document.createElement('div');
    wrap.className = 'cfg-secret';
    const input = document.createElement('input');
    input.type = 'password';
    input.className = 'control';
    input.value = value;
    input.dataset.cfgKey = key;
    input.dataset.cfgType = 'string';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn ghost sm';
    toggle.textContent = t('cfg.reveal');
    toggle.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = t(show ? 'cfg.hide' : 'cfg.reveal');
    });
    wrap.append(input, toggle);
    return wrap;
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'control';
  input.value = value;
  input.dataset.cfgKey = key;
  input.dataset.cfgType = 'string';
  return input;
}

function applyFilter() {
  const q = filterEl.value.trim().toLowerCase();
  for (const row of bodyEl.querySelectorAll('.cfg-row')) {
    const hit = !q || row.dataset.key.includes(q) || row.dataset.desc.includes(q);
    row.classList.toggle('hidden', !hit);
  }
  for (const group of bodyEl.querySelectorAll('.cfg-group')) {
    group.classList.toggle('hidden', !group.querySelector('.cfg-row:not(.hidden)'));
  }
}

// ---- JSON 清單分頁 ----

async function loadJsonList(kind) {
  bodyEl.innerHTML = `<div class="cfg-loading">${t('common.detecting')}</div>`;
  try {
    const res = await fetch(`/api/servers/${currentServer.id}/lists/${kind}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `讀取失敗（HTTP ${res.status}）`);
    currentEntries = Array.isArray(data.entries) ? data.entries : [];
    renderJsonList(kind);
  } catch (e) {
    showError(e.message);
  }
}

function renderJsonList(kind) {
  const schema = LIST_SCHEMAS[kind];
  const running = !!currentState?.running;
  bodyEl.innerHTML = '';

  if (running) {
    // 執行中：鎖住直接編輯，只讀顯示 + 提示
    const banner = document.createElement('div');
    banner.className = 'list-locked';
    banner.textContent = t('list.locked');
    bodyEl.appendChild(banner);
  } else {
    bodyEl.appendChild(buildAddForm(kind, schema));
  }

  const wrap = document.createElement('div');
  wrap.className = 'list-cards';
  if (currentEntries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'cfg-desc';
    empty.textContent = t('list.empty');
    wrap.appendChild(empty);
  }
  currentEntries.forEach((entry, i) => wrap.appendChild(buildEntryCard(kind, schema, entry, i, running)));
  bodyEl.appendChild(wrap);

  noteEl.textContent = running ? t('list.locked_note') : t('list.note');
  saveBtn.disabled = running;
}

function buildAddForm(kind, schema) {
  const form = document.createElement('div');
  form.className = 'list-add';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'control';
  input.placeholder = schema.player ? t('list.add_name') : t('list.add_ip');

  const btn = document.createElement('button');
  btn.className = 'btn primary';
  btn.textContent = t('list.add');

  const status = document.createElement('span');
  status.className = 'list-add-status';
  status.textContent = pendingAddInfo;
  pendingAddInfo = '';

  const doAdd = () => addEntry(kind, schema, input.value);
  btn.addEventListener('click', doAdd);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doAdd();
  });

  form.append(input, btn, status);
  return form;
}

async function addEntry(kind, schema, raw) {
  const value = raw.trim();
  if (!value) return;

  if (!schema.player) {
    // banned-ips：直接用輸入的 IP 建一筆
    if (currentEntries.some((e) => String(e.ip || '') === value)) {
      alert(t('list.dup'));
      return;
    }
    currentEntries.push(schema.make(value));
    setDirty(true);
    renderJsonList(kind);
    return;
  }

  // 玩家清單：先解析 UUID
  try {
    const res = await fetch(`/api/servers/${currentServer.id}/resolve-uuid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || '查詢 UUID 失敗');

    const dup = currentEntries.some(
      (e) => (e.uuid && e.uuid === data.uuid) || String(e.name || '').toLowerCase() === String(data.name).toLowerCase()
    );
    if (dup) {
      alert(t('list.dup'));
      return;
    }
    currentEntries.push(schema.make(data));
    setDirty(true);
    pendingAddInfo = t(`list.src.${data.source}`); // 顯示 UUID 來源（快取/Mojang/離線）
    renderJsonList(kind);
  } catch (e) {
    alert(e.message);
  }
}

function buildEntryCard(kind, schema, entry, index, disabled) {
  const card = document.createElement('div');
  card.className = 'list-card';

  const grid = document.createElement('div');
  grid.className = 'list-fields';
  for (const field of schema.fields) {
    grid.appendChild(buildEntryField(entry, index, field, disabled));
  }
  card.appendChild(grid);

  if (!disabled) {
    const del = document.createElement('button');
    del.className = 'btn danger sm list-del';
    del.textContent = t('common.delete');
    del.addEventListener('click', () => {
      currentEntries.splice(index, 1);
      setDirty(true);
      renderJsonList(kind);
    });
    card.appendChild(del);
  }
  return card;
}

function buildEntryField(entry, index, field, disabled) {
  const wrap = document.createElement('label');
  wrap.className = 'list-field';

  const label = document.createElement('span');
  label.className = 'list-field-label';
  label.textContent = t(`list.field.${field.k}`);
  wrap.appendChild(label);

  const value = entry[field.k];

  if (field.type === 'bool') {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = value === true || String(value) === 'true';
    box.disabled = disabled;
    box.addEventListener('change', () => { currentEntries[index][field.k] = box.checked; });
    wrap.appendChild(box);
    return wrap;
  }

  const input = document.createElement('input');
  input.type = field.type === 'int' ? 'number' : 'text';
  input.className = 'control';
  input.value = value ?? '';
  input.disabled = disabled;
  if (field.min !== undefined) input.min = field.min;
  if (field.max !== undefined) input.max = field.max;
  input.addEventListener('input', () => {
    currentEntries[index][field.k] = field.type === 'int' ? Number(input.value) : input.value;
  });
  wrap.appendChild(input);
  return wrap;
}

// ---- 共用 ----

function showError(msg) {
  bodyEl.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'cfg-error';
  el.textContent = msg;
  bodyEl.appendChild(el);
}

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = p(Math.floor(Math.abs(off) / 60));
  const om = p(Math.abs(off) % 60);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${sign}${oh}${om}`;
}

// ---- 儲存（依目前分頁分派）----

async function save() {
  if (!currentServer) return;
  saveBtn.disabled = true;
  try {
    if (activeTab === 'properties') {
      await saveProperties();
    } else {
      await saveJsonList(activeTab);
    }
  } catch (e) {
    alert(e.message);
  } finally {
    // JSON 清單在執行中本來就 disabled；其餘情況存完解鎖
    if (!(activeTab !== 'properties' && currentState?.running)) saveBtn.disabled = false;
  }
}

async function saveProperties() {
  const values = {};
  for (const el of bodyEl.querySelectorAll('[data-cfg-key]')) {
    values[el.dataset.cfgKey] = el.dataset.cfgType === 'bool' ? (el.checked ? 'true' : 'false') : el.value;
  }
  const res = await fetch(`/api/servers/${currentServer.id}/properties`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `儲存失敗（HTTP ${res.status}）`);

  setDirty(false); // 已存檔，關閉時不再攔截
  closeConfig();
  if (confirm(t('cfg.saved_restart'))) await restartActiveSkipConfirm();
}

async function saveJsonList(kind) {
  const res = await fetch(`/api/servers/${currentServer.id}/lists/${kind}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries: currentEntries }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `儲存失敗（HTTP ${res.status}）`);
  setDirty(false);
  alert(t('list.saved'));
}
