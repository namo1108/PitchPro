import { getJSON, putJSON } from "./kv.js";
import { KV_KEYS, POINTS_PER_CHECKIN, SESSION_TTL_SECONDS, GOAT_USERNAMES } from "./config.js";

// 로그인은 선택 기능(집관인증/레벨/친구/명예의 전당 전용)이라 기존 익명 사용자 흐름(즐겨찾기,
// 골 알림)은 전혀 건드리지 않는다. 비번은 Workers 런타임이 지원하는 WebCrypto PBKDF2로 해싱한다
// (bcrypt 같은 전용 라이브러리 없이도 안전한 표준 방식).
const PBKDF2_ITERATIONS = 100000;

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function pbkdf2(password, salt) {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return toHex(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return `${toHex(salt)}:${hash}`;
}

export async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = (stored || "").split(":");
  if (!saltHex || !hashHex) return false;
  const hash = await pbkdf2(password, fromHex(saltHex));
  return hash === hashHex;
}

export function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

export function normalizeNickname(nickname) {
  return String(nickname || "").trim();
}

export function userKey(username) {
  return `${KV_KEYS.userPrefix}${normalizeUsername(username)}`;
}

export function nicknameIndexKey(nickname) {
  return `${KV_KEYS.nicknameIndexPrefix}${normalizeNickname(nickname).toLowerCase()}`;
}

export function sessionKey(token) {
  return `${KV_KEYS.sessionPrefix}${token}`;
}

export async function findUserByNickname(env, nickname) {
  const username = await env.CACHE.get(nicknameIndexKey(nickname));
  if (!username) return null;
  return getJSON(env, userKey(username));
}

export async function createSession(env, username) {
  const token = crypto.randomUUID();
  await putJSON(env, sessionKey(token), { username }, { expirationTtl: SESSION_TTL_SECONDS });
  return token;
}

export async function destroySession(env, token) {
  await env.CACHE.delete(sessionKey(token));
}

// Authorization: Bearer <token> 헤더로 세션을 찾아 사용자 레코드를 돌려준다. 없으면 null(로그인 안 한 사용자).
export async function getAuthedUser(request, env) {
  const authHeader = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) return null;
  const session = await getJSON(env, sessionKey(match[1]));
  if (!session) return null;
  return getJSON(env, userKey(session.username));
}

// FM 스타일 곡선: 레벨 L에 도달하는 데 필요한 누적 포인트 = 50 * L * (L-1) (레벨 1은 0점부터).
// 1회 집관인증(POINTS_PER_CHECKIN)마다 조금씩 쌓여서, 레벨2는 5회, 레벨3은 15회, 레벨4는 30회 필요한 정도의 곡선이다.
export function pointsForLevel(level) {
  return 50 * level * (level - 1);
}

export function levelForPoints(points) {
  const level = Math.floor((1 + Math.sqrt(1 + (4 * points) / 50)) / 2);
  return Math.max(1, level);
}

// 레벨 1~4는 각자 이름이 있고, 5부터는(포인트가 계속 쌓여도) 전부 "축구에 미친자"로 묶는다.
const LEVEL_TITLES = [
  { level: 1, title: "축구 입문자" },
  { level: 2, title: "이적설 레이더" },
  { level: 3, title: "전술 분석가" },
  { level: 4, title: "방구석 스카우터" },
  { level: 5, title: "축구에 미친자" },
];

export function levelTitle(level) {
  return LEVEL_TITLES.find((t) => t.level === level)?.title || LEVEL_TITLES[LEVEL_TITLES.length - 1].title;
}

// username이 GOAT_USERNAMES(config.js, 운영자 전용 이스터에그)에 있으면 포인트와 무관하게
// 레벨 99 "나 개발자(Goat)"로 고정해서 보여준다.
export function levelProgress(points, username = null) {
  if (username && GOAT_USERNAMES.includes(normalizeUsername(username))) {
    return { level: 99, floor: 0, ceil: 0, percent: 100, title: "나 개발자(Goat)" };
  }

  const level = levelForPoints(points);
  const floor = pointsForLevel(level);
  const ceil = pointsForLevel(level + 1);
  // 반올림 때문에 아직 레벨업 전인데 100%로 보이는 걸 막기 위해 599/1%p 오차는 99로 눌러둔다.
  const percent = ceil > floor ? Math.min(99, Math.round(((points - floor) / (ceil - floor)) * 100)) : 100;
  return { level, floor, ceil, percent, title: levelTitle(level) };
}

// 사용자에게 포인트를 더하고 레벨업 여부까지 계산해 저장한다(집관인증 등에서 공통으로 사용).
export async function awardPoints(env, user, points = POINTS_PER_CHECKIN) {
  const prevLevel = levelForPoints(user.points || 0);
  const nextPoints = (user.points || 0) + points;
  const nextLevel = levelForPoints(nextPoints);
  user.points = nextPoints;
  user.level = nextLevel;
  await putJSON(env, userKey(user.username), user);
  return { points: nextPoints, level: nextLevel, leveledUp: nextLevel > prevLevel };
}

export function publicProfile(user) {
  if (!user) return null;
  return {
    username: user.username,
    nickname: user.nickname,
    favoriteTeamId: user.favoriteTeamId || null,
    points: user.points || 0,
    level: user.level || 1,
    friends: user.friends || [],
  };
}
