import { fetchJSON } from "./api.js";
import { toggleFavorite, isFavorite } from "./favorites.js";

const TOKEN_KEY = "pitchpro.authToken";
const USER_KEY = "pitchpro.authUser";

function readUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event("auth-changed"));
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  window.dispatchEvent(new Event("auth-changed"));
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getCurrentUser() {
  return getToken() ? readUser() : null;
}

export function isLoggedIn() {
  return !!getToken();
}

// 로그인은 선택 기능이라, 회원가입 시 고른 최애팀은 편의상 기존 즐겨찾기(나의 팀)에도 자동으로 넣어준다.
function syncFavoriteTeam(user) {
  if (!user.favoriteTeamId) return;
  const team = { id: user.favoriteTeamId, name: user.favoriteTeamName || user.favoriteTeamId, crest: user.favoriteTeamCrest || null };
  if (!isFavorite(team.id)) toggleFavorite(team);
}

export async function signup({ username, password, nickname, favoriteTeamId, favoriteTeamName, favoriteTeamCrest }) {
  const data = await fetchJSON("/auth/signup", {
    method: "POST",
    body: { username, password, nickname, favoriteTeamId, favoriteTeamName, favoriteTeamCrest },
  });
  writeSession(data.token, data.user);
  syncFavoriteTeam(data.user);
  return data.user;
}

export async function login({ username, password }) {
  const data = await fetchJSON("/auth/login", { method: "POST", body: { username, password } });
  writeSession(data.token, data.user);
  return data.user;
}

export async function logout() {
  const token = getToken();
  if (token) {
    await fetchJSON("/auth/logout", { method: "POST", body: {}, token }).catch(() => {});
  }
  clearSession();
}

// 서버 기준 최신 프로필(포인트/레벨 등)로 로컬 캐시를 새로고침한다. 세션이 끊겼으면 로그아웃 처리.
export async function refreshMe() {
  const token = getToken();
  if (!token) return null;
  try {
    const data = await fetchJSON("/auth/me", { token });
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    window.dispatchEvent(new Event("auth-changed"));
    return data.user;
  } catch {
    clearSession();
    return null;
  }
}

export function onAuthChange(handler) {
  window.addEventListener("auth-changed", handler);
}

// 인증이 필요한 API 호출 공용 헬퍼 - 토큰이 없으면 바로 에러(로그인 유도).
export async function authFetch(path, opts = {}) {
  const token = getToken();
  if (!token) throw new Error("로그인이 필요합니다.");
  return fetchJSON(path, { ...opts, token });
}
