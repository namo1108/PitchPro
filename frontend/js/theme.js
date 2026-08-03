// 다크(기본, 브랜드 정체성)/라이트 토글. index.html 맨 위 인라인 스크립트가 첫 페인트 전에
// 이미 data-theme을 적용해두므로(깜빡임 방지), 여기서는 그 이후 토글 상호작용만 다룬다.
const THEME_KEY = "pitchpro.theme";

export function getTheme() {
  return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
}

export function setTheme(theme) {
  const next = theme === "light" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  document.documentElement.dataset.theme = next;
  document.getElementById("theme-color-meta")?.setAttribute("content", next === "light" ? "#f4f8f5" : "#0a1410");
  window.dispatchEvent(new CustomEvent("theme-changed", { detail: { theme: next } }));
}

export function toggleTheme() {
  const next = getTheme() === "light" ? "dark" : "light";
  setTheme(next);
  return next;
}
