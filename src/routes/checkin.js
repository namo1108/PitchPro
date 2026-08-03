import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS, CHECKIN_WINDOW_MINUTES_BEFORE, CHECKIN_WINDOW_MINUTES_AFTER, POINTS_CHECKIN_BASE } from "../lib/config.js";
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
  const record = await getJSON(env, checkinKey(user.username, matchId));
  return json({
    ...window,
    alreadyCheckedIn: !!record,
    resolved: record?.resolved || false,
    awardedPoints: record?.awardedPoints ?? null,
    finalPoints: record?.finalPoints ?? null,
  });
}

// 인증 시점엔 경기가 막 시작하거나 시작 전이라 승패를 모르니 우선 참여 포인트(POINTS_CHECKIN_BASE)만 주고,
// 실제 승/무/패에 따른 최종 정산은 경기 종료 후 scheduled/resolveCheckinOutcomes.js가 처리한다.
export async function handleCheckin(request, env) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const body = await request.json().catch(() => null);
  const matchId = body?.matchId ? String(body.matchId) : null;
  const teamId = body?.teamId ? String(body.teamId) : null;
  if (!matchId || !teamId) return json({ detail: "matchId, teamId가 필요합니다." }, 400);

  const match = await findMatch(env, matchId);
  if (!match) return json({ detail: "경기를 찾을 수 없습니다." }, 404);
  if (String(match.homeTeam.id) !== teamId && String(match.awayTeam.id) !== teamId) {
    return json({ detail: "해당 경기에 출전하는 팀이 아닙니다." }, 400);
  }

  const window = checkinWindowState(match.utcDate);
  if (window.state !== "open") {
    return json({ detail: "집관인증은 킥오프 30분 전부터 30분 후까지만 가능합니다.", ...window }, 409);
  }

  const key = checkinKey(user.username, matchId);
  if (await env.CACHE.get(key)) {
    return json({ detail: "이미 이 경기에 집관인증했습니다." }, 409);
  }

  const cheeredTeam = String(match.homeTeam.id) === teamId ? match.homeTeam : match.awayTeam;
  const result = await awardPoints(env, user, POINTS_CHECKIN_BASE, `${cheeredTeam.shortName || cheeredTeam.name} 집관인증 참여`);
  await putJSON(
    env,
    key,
    {
      username: user.username,
      matchId,
      teamId,
      awardedPoints: POINTS_CHECKIN_BASE,
      resolved: false,
      checkedInAt: new Date().toISOString(),
    },
    { expirationTtl: 60 * 24 * 60 * 60 }
  );

  return json({ status: "ok", ...result, progress: levelProgress(result.points, user.username), pointsAwarded: POINTS_CHECKIN_BASE });
}
