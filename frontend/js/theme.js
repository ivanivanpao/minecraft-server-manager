// 介面主題：白天 / 夜晚（light / dark）切換，並記住使用者選擇（localStorage）
// 主題以 <html data-theme="..."> 呈現，CSS 依這個屬性套不同配色

const STORAGE_KEY = 'msm.theme';

// 目前主題（沒設定過預設 light）
export function getTheme() {
  return localStorage.getItem(STORAGE_KEY) || 'light';
}

// 套用主題並記住
export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_KEY, theme);
}

// 在 light / dark 之間切換，回傳切換後的主題
export function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

// 初始化：套用記住的主題
export function initTheme() {
  applyTheme(getTheme());
}
