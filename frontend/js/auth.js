import { fetchJSON } from "./api.js";
import { toggleFavorite, isFavorite } from "./favorites.js";
import { trackEvent } from "./analytics.js";

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

export async function signup({ username, password, nickname, favoriteTeamId, favoriteTeamName, favoriteTeamCrest, securityAnswer }) {
  const data = await fetchJSON("/auth/signup", {
    method: "POST",
    body: { username, password, nickname, favoriteTeamId, favoriteTeamName, favoriteTeamCrest, securityAnswer },
  });

  // 회원가입 시 고른 최애팀은 편의상 기존 즐겨찾기(나의 팀)에도 자동으로 넣어준다.
  // writeSession이 'auth-changed'를 쏘면 나의 팀 화면이 그 자리에서 바로 다시 그려지므로,
  // 즐겨찾기 반영을 먼저 끝내야 새로고림 시점에 최애팀이 누락되지 않는다.
  // 서버가 돌려주는 프로필(publicProfile)에는 팀 이름/엠블럼이 없어 여기 원본 인자를 그대로 쓴다.
  if (favoriteTeamId && !isFavorite(favoriteTeamId)) {
    toggleFavorite({ id: favoriteTeamId, name: favoriteTeamName || favoriteTeamId, crest: favoriteTeamCrest || null });
  }

  writeSession(data.token, data.user);
  trackEvent("signup");
  return data.user;
}

export async function login({ username, password }) {
  const data = await fetchJSON("/auth/login", { method: "POST", body: { username, password } });
  writeSession(data.token, data.user);
  trackEvent("login");
  return data.user;
}

export async function logout() {
  const token = getToken();
  if (token) {
    await fetchJSON("/auth/logout", { method: "POST", body: {}, token }).catch(() => {});
  }
  clearSession();
}

// 회원 탈퇴 - 서버가 계정/세션/푸시 구독을 지운 뒤에만 로컬 세션도 지운다(비밀번호가 틀리면
// fetchJSON이 에러를 던져서 여기까지 오지 않고, 로컬 세션은 그대로 로그인된 채 남는다).
export async function deleteAccount({ password }) {
  const token = getToken();
  await fetchJSON("/auth/me", { method: "DELETE", body: { password }, token });
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
