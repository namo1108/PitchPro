import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import { clientIp, isRateLimited, isBlockedByFailures, recordFailure, clearFailures } from "../lib/rateLimit.js";
import {
  hashPassword,
  verifyPassword,
  normalizeUsername,
  normalizeNickname,
  normalizeSecurityAnswer,
  nicknameIndexKey,
  userKey,
  createSession,
  destroySession,
  getAuthedUser,
  findUserByNickname,
  publicProfile,
  levelProgress,
} from "../lib/auth.js";

// 비밀번호를 잃어버렸을 때 이메일/휴대폰 없이도 본인 확인할 수 있게, 가입 시 선택적으로 이 질문의
// 답을 등록해둔다(회원가입 폼에 고정으로 노출되는 단일 질문 - 질문 종류를 여러 개 두면 그만큼
// user 스키마와 폼이 복잡해져서, 이메일/SMS 인증 없는 소규모 앱에는 이 정도면 충분하다고 판단).
export const SECURITY_QUESTION = "가장 좋아하는(응원하는) 축구선수는 누구인가요?";

function isValidUsername(username) {
  return /^[a-z0-9_]{3,20}$/.test(username);
}

function isValidNickname(nickname) {
  return nickname.length >= 2 && nickname.length <= 12;
}

// 가입은 성공/실패 구분 없이 "시도 자체"가 스팸 계정 생성 수단이 될 수 있어, IP 기준으로 시간당
// 개수를 제한한다(정상 사용자가 한 IP에서 시간당 몇 개씩 새로 가입할 일은 없음).
const SIGNUP_MAX_PER_HOUR = 5;

export async function handleSignup(request, env) {
  if (await isRateLimited(env, `signup:ip:${clientIp(request)}`, SIGNUP_MAX_PER_HOUR, 60 * 60)) {
    return json({ detail: "잠시 후 다시 시도해주세요." }, 429);
  }

  const body = await request.json().catch(() => null);
  const username = normalizeUsername(body?.username);
  const nickname = normalizeNickname(body?.nickname);
  const password = String(body?.password || "");
  const favoriteTeamId = body?.favoriteTeamId ? String(body.favoriteTeamId) : null;
  const favoriteTeamName = body?.favoriteTeamName ? String(body.favoriteTeamName) : null;
  const favoriteTeamCrest = body?.favoriteTeamCrest ? String(body.favoriteTeamCrest) : null;
  // 선택 입력 - 안 넣으면 나중에 비번을 잃어버렸을 때 자가 복구가 안 되고 관리자에게 초기화를
  // 요청해야 한다(설정 화면에 이 트레이드오프를 안내함).
  const securityAnswer = normalizeSecurityAnswer(body?.securityAnswer);

  if (!isValidUsername(username)) return json({ detail: "아이디는 영문 소문자/숫자/_ 3~20자여야 합니다." }, 400);
  if (!isValidNickname(nickname)) return json({ detail: "닉네임은 2~12자여야 합니다." }, 400);
  if (password.length < 6) return json({ detail: "비밀번호는 6자 이상이어야 합니다." }, 400);

  if (await getJSON(env, userKey(username))) return json({ detail: "이미 사용 중인 아이디입니다." }, 409);
  if (await env.CACHE.get(nicknameIndexKey(nickname))) return json({ detail: "이미 사용 중인 닉네임입니다." }, 409);

  const user = {
    username,
    nickname,
    passwordHash: await hashPassword(password),
    securityAnswerHash: securityAnswer ? await hashPassword(securityAnswer) : null,
    favoriteTeamId,
    favoriteTeamName,
    favoriteTeamCrest,
    points: 0,
    level: 1,
    friends: [],
    friendRequestsIncoming: [],
    friendRequestsOutgoing: [],
    createdAt: new Date().toISOString(),
  };

  await putJSON(env, userKey(username), user);
  await env.CACHE.put(nicknameIndexKey(nickname), username);

  const token = await createSession(env, username);
  return json({ token, user: { ...publicProfile(user), progress: levelProgress(user.points, user.username) } });
}

// 브루트포스 방지 - 틀린 시도만 센다(정상적으로 여러 기기에서 로그인하는 사용자가 걸리지 않도록).
// 아이디 기준(특정 계정을 노리는 공격)과 IP 기준(한 곳에서 여러 계정을 시도하는 공격) 둘 다 본다.
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_MAX_PER_USERNAME = 8;
const LOGIN_MAX_PER_IP = 20;

export async function handleLogin(request, env) {
  const ip = clientIp(request);
  const body = await request.json().catch(() => null);
  const username = normalizeUsername(body?.username);
  const password = String(body?.password || "");

  const ipKey = `login:ip:${ip}`;
  const userKeyRl = `login:user:${username}`;
  if ((await isBlockedByFailures(env, ipKey, LOGIN_MAX_PER_IP)) || (username && (await isBlockedByFailures(env, userKeyRl, LOGIN_MAX_PER_USERNAME)))) {
    return json({ detail: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요." }, 429);
  }

  const user = await getJSON(env, userKey(username));
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    await recordFailure(env, ipKey, LOGIN_WINDOW_SECONDS);
    if (username) await recordFailure(env, userKeyRl, LOGIN_WINDOW_SECONDS);
    return json({ detail: "아이디 또는 비밀번호가 올바르지 않습니다." }, 401);
  }
  if (username) await clearFailures(env, userKeyRl);

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

// 회원 탈퇴(셀프서비스) - 비밀번호 재확인 후 계정과 로그인 세션, 이 계정으로 등록된 푸시 구독을 지운다.
// 커뮤니티 게시글/댓글, 친구 목록의 상호 참조, 집관인증/포인트 내역은 관리자 전용 delete-user와
// 마찬가지로 남겨둔다(다른 이용자의 게시물·친구 목록에서 소급 편집하는 부작용이 더 크다고 판단).
export async function handleDeleteAccount(request, env) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const body = await request.json().catch(() => null);
  const password = String(body?.password || "");
  if (!(await verifyPassword(password, user.passwordHash))) {
    return json({ detail: "비밀번호가 올바르지 않습니다." }, 401);
  }

  const subKey = await env.CACHE.get(`${KV_KEYS.pushUsernameIndexPrefix}${user.username}`);
  if (subKey) {
    await env.CACHE.delete(subKey);
    await env.CACHE.delete(`${KV_KEYS.pushUsernameIndexPrefix}${user.username}`);
  }

  await env.CACHE.delete(userKey(user.username));
  if (user.nickname) await env.CACHE.delete(nicknameIndexKey(user.nickname));

  const authHeader = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (match) await destroySession(env, match[1]);

  return json({ status: "ok" });
}

// 아이디 찾기: 닉네임은 이미 커뮤니티/명예의 전당 등에서 공개적으로 보이는 정보라(비밀번호와 달리),
// 그대로 알려줘도 새로운 정보 노출이 아니다 - 실명/이메일 같은 진짜 개인정보가 아니라서 마스킹하지 않는다.
export async function handleFindUsername(request, env) {
  if (await isRateLimited(env, `findusername:ip:${clientIp(request)}`, 20, 30 * 60)) {
    return json({ detail: "잠시 후 다시 시도해주세요." }, 429);
  }

  const body = await request.json().catch(() => null);
  const nickname = normalizeNickname(body?.nickname);
  if (!nickname) return json({ detail: "닉네임을 입력해주세요." }, 400);

  const user = await findUserByNickname(env, nickname);
  if (!user) return json({ detail: "해당 닉네임으로 가입된 계정을 찾을 수 없습니다." }, 404);
  return json({ username: user.username });
}

// 비밀번호 찾기 1단계: 이 아이디가 보안 답변을 등록해뒀는지부터 확인한다(등록 안 했으면 굳이 답변을
// 입력받을 필요 없이 바로 "관리자에게 문의" 안내로 넘어갈 수 있게).
export async function handleCheckSecurityQuestion(request, env) {
  if (await isRateLimited(env, `securitycheck:ip:${clientIp(request)}`, 20, 30 * 60)) {
    return json({ detail: "잠시 후 다시 시도해주세요." }, 429);
  }

  const body = await request.json().catch(() => null);
  const username = normalizeUsername(body?.username);
  if (!username) return json({ detail: "아이디를 입력해주세요." }, 400);

  const user = await getJSON(env, userKey(username));
  // 계정이 없는 경우와 보안 답변이 없는 경우를 구분하지 않고 똑같이 false로 응답한다 - 그렇지 않으면
  // "이 아이디는 존재하는데 보안질문이 없다"는 식으로 계정 존재 여부가 새어나갈 수 있다.
  return json({ hasSecurityQuestion: !!user?.securityAnswerHash, question: user?.securityAnswerHash ? SECURITY_QUESTION : null });
}

// 비밀번호 찾기 2단계: 보안 답변이 맞으면 그 자리에서 바로 새 비밀번호로 바꾼다(별도 재설정 토큰
// 발급 없이 한 번의 요청으로 끝냄 - 이메일 링크 클릭 같은 중간 단계가 없는 구조라 굳이 토큰을
// 나눌 필요가 없음).
// 보안 답변(축구선수 이름 등)은 비밀번호보다 훨씬 추측하기 쉬워서(대표 선수 몇 명으로 사전 공격 가능),
// 계정 탈취로 이어지는 가장 취약한 경로다 - 로그인보다 더 엄격하게 제한한다.
const RESET_WINDOW_SECONDS = 30 * 60;
const RESET_MAX_PER_USERNAME = 5;
const RESET_MAX_PER_IP = 20;

export async function handleResetPasswordWithAnswer(request, env) {
  const ip = clientIp(request);
  const body = await request.json().catch(() => null);
  const username = normalizeUsername(body?.username);
  const answer = normalizeSecurityAnswer(body?.securityAnswer);
  const newPassword = String(body?.newPassword || "");

  if (!username || !answer) return json({ detail: "아이디와 답변을 입력해주세요." }, 400);
  if (newPassword.length < 6) return json({ detail: "새 비밀번호는 6자 이상이어야 합니다." }, 400);

  const ipKey = `reset:ip:${ip}`;
  const userKeyRl = `reset:user:${username}`;
  if ((await isBlockedByFailures(env, ipKey, RESET_MAX_PER_IP)) || (await isBlockedByFailures(env, userKeyRl, RESET_MAX_PER_USERNAME))) {
    return json({ detail: "시도가 너무 많습니다. 잠시 후 다시 시도해주세요." }, 429);
  }

  const user = await getJSON(env, userKey(username));
  if (!user?.securityAnswerHash || !(await verifyPassword(answer, user.securityAnswerHash))) {
    await recordFailure(env, ipKey, RESET_WINDOW_SECONDS);
    await recordFailure(env, userKeyRl, RESET_WINDOW_SECONDS);
    return json({ detail: "아이디 또는 답변이 올바르지 않습니다." }, 401);
  }
  await clearFailures(env, userKeyRl);

  user.passwordHash = await hashPassword(newPassword);
  await putJSON(env, userKey(username), user);
  return json({ status: "ok" });
}
