// 多語言（i18n）：載入 locales/ 下的語系檔、切換語系、記住使用者選擇（localStorage）
// 預設繁體中文（zh-TW），另支援 English（en）

const STORAGE_KEY = 'msm.lang';
let current = 'zh-TW';
let dict = {};

// 目前語系代碼
export function getLanguage() {
  return current;
}

// 取翻譯字串；查不到就直接回傳 key（方便發現漏翻）
export function t(key) {
  return key in dict ? dict[key] : key;
}

// 把畫面上所有 data-i18n 元素替換成目前語系的字串
// data-i18n → 元素文字；data-i18n-title → title 屬性（滑鼠停留的說明 tooltip）
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
}

// 載入指定語系的語系檔
async function loadLocale(lang) {
  const res = await fetch(`locales/${lang}.json`);
  if (!res.ok) throw new Error(`載入語系檔失敗：${lang}`);
  return res.json();
}

// 切換語系並套用到畫面
export async function setLanguage(lang) {
  dict = await loadLocale(lang);
  current = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  document.documentElement.lang = lang;
  applyTranslations();
}

// 初始化：讀 localStorage 記住的語系，沒有就用預設
export async function initI18n() {
  await setLanguage(localStorage.getItem(STORAGE_KEY) || 'zh-TW');
  return current;
}
