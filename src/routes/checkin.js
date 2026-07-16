import { json } from "../lib/http.js";
import { getJSON } from "../lib/kv.js";
import { KV_KEYS, CHECKIN_WINDOW_MINUTES_BEFORE, CHECKIN_WINDOW_MINUTES_AFTER, POINTS_PER_CHECKIN } from "../lib/config.js";
import { getAuthedUser, awardPoints, levelProgress } from "../lib/auth.js";

async function findMatch(env, matchId) {
  const blob = await getJSON(env, KV_KEYS.matches);
  return (blob?.matches || []).find((m) => String(m.id) === String(matchId)) || null;
}

// 킥오프 -30분 ~ +30분 사이인지(경기를 "직관/집관"할 법한 시간대인지) 판정한다.
function checkinWindowState(utcDate) {
  const kickoff = new Date(utcDate).getTime();
  const now = Date.now();
  const opensAt = kickoff - CHECKIN_WINDOW_MINUTES_BEFORE * 60 * 1000;
  const closesAt = kickoff + CHECKIN_WINDOW_MINUTES_AFTER * 60 * 1000;
  if (now < opensAt) return { state: "too_early", opensAt, closesAt };
  if (now > closesAt) return { state: "closed", opensAt, closesAt };
  return { state: "open", opensAt, closesAt };
}

function checkinKey(username, matchId) {
  return `${KV_KEYS.checkinPrefix}${username}:${matchId}`;
}

export async function handleCheckinStatus(request, env, matchId) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const match = await findMatch(env, matchId);
  if (!match) return json({ detail: "경기를 찾을 수 없습니다." }, 404);

  const window = checkinWindowState(match.utcDate);
  const already = await env.CACHE.get(checkinKey(user.username, matchId));
  return json({ ...window, alreadyCheckedIn: !!already });
}

export async function handleCheckin(request, env) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const body = await request.json().catch(() => null);
  const matchId = body?.matchId ? String(body.matchId) : null;
  if (!matchId) return json({ detail: "matchId가 필요합니다." }, 400);

  const match = await findMatch(env, matchId);
  if (!match) return json({ detail: "경기를 찾을 수 없습니다." }, 404);

  const window = checkinWindowState(match.utcDate);
  if (window.state !== "open") {
    return json({ detail: "집관인증은 킥오프 30분 전부터 30분 후까지만 가능합니다.", ...window }, 409);
  }

  const key = checkinKey(user.username, matchId);
  if (await env.CACHE.get(key)) {
    return json({ detail: "이미 이 경기에 집관인증했습니다." }, 409);
  }

  await env.CACHE.put(key, "1", { expirationTtl: 60 * 24 * 60 * 60 });
  const result = await awardPoints(env, user, POINTS_PER_CHECKIN);
  return json({ status: "ok", ...result, progress: levelProgress(result.points), pointsAwarded: POINTS_PER_CHECKIN });
}
