import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import {
  hashPassword,
  verifyPassword,
  normalizeUsername,
  normalizeNickname,
  nicknameIndexKey,
  userKey,
  createSession,
  destroySession,
  getAuthedUser,
  publicProfile,
  levelProgress,
} from "../lib/auth.js";

function isValidUsername(username) {
  return /^[a-z0-9_]{3,20}$/.test(username);
}

function isValidNickname(nickname) {
  return nickname.length >= 2 && nickname.length <= 12;
}

export async function handleSignup(request, env) {
  const body = await request.json().catch(() => null);
  const username = normalizeUsername(body?.username);
  const nickname = normalizeNickname(body?.nickname);
  const password = String(body?.password || "");
  const favoriteTeamId = body?.favoriteTeamId ? String(body.favoriteTeamId) : null;
  const favoriteTeamName = body?.favoriteTeamName ? String(body.favoriteTeamName) : null;
  const favoriteTeamCrest = body?.favoriteTeamCrest ? String(body.favoriteTeamCrest) : null;

  if (!isValidUsername(username)) return json({ detail: "아이디는 영문 소문자/숫자/_ 3~20자여야 합니다." }, 400);
  if (!isValidNickname(nickname)) return json({ detail: "닉네임은 2~12자여야 합니다." }, 400);
  if (password.length < 6) return json({ detail: "비밀번호는 6자 이상이어야 합니다." }, 400);

  if (await getJSON(env, userKey(username))) return json({ detail: "이미 사용 중인 아이디입니다." }, 409);
  if (await env.CACHE.get(nicknameIndexKey(nickname))) return json({ detail: "이미 사용 중인 닉네임입니다." }, 409);

  const user = {
    username,
    nickname,
    passwordHash: await hashPassword(password),
    favoriteTeamId,
    favoriteTeamName,
    favoriteTeamCrest,
    points: 0,
    level: 1,
    friends: [],
    createdAt: new Date().toISOString(),
  };

  await putJSON(env, userKey(username), user);
  await env.CACHE.put(nicknameIndexKey(nickname), username);

  const token = await createSession(env, username);
  return json({ token, user: { ...publicProfile(user), progress: levelProgress(user.points, user.username) } });
}

export async function handleLogin(request, env) {
  const body = await request.json().catch(() => null);
  const username = normalizeUsername(body?.username);
  const password = String(body?.password || "");

  const user = await getJSON(env, userKey(username));
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return json({ detail: "아이디 또는 비밀번호가 올바르지 않습니다." }, 401);
  }

  const token = await createSession(env, username);
  return json({ token, user: { ...publicProfile(user), progress: levelProgress(user.points, user.username) } });
}

export async function handleLogout(request, env) {
  const authHeader = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (match) await destroySession(env, match[1]);
  return json({ status: "ok" });
}

export async function handleMe(request, env) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);
  return json({ user: { ...publicProfile(user), progress: levelProgress(user.points, user.username) } });
}
