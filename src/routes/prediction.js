import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import { getAuthedUser } from "../lib/auth.js";

async function findMatch(env, matchId) {
  const blob = await getJSON(env, KV_KEYS.matches);
  return (blob?.matches || []).find((m) => String(m.id) === String(matchId)) || null;
}

function predictionKey(username, matchId) {
  return `${KV_KEYS.predictionPrefix}${username}:${matchId}`;
}

// 승부예측은 집관인증처럼 "경기 중"에 의미가 있는 게 아니라 "경기 전 예측"이 핵심이라, 킥오프
// 전까지만 제출/수정할 수 있게 한다 - 열려있는 동안은 몇 번이든 다시 찍어도 된다(마지막 제출만 유효).
function isBeforeKickoff(utcDate) {
  return Date.now() < new Date(utcDate).getTime();
}

export async function handlePredictionStatus(request, env, matchId) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const match = await findMatch(env, matchId);
  if (!match) return json({ detail: "경기를 찾을 수 없습니다." }, 404);

  const record = await getJSON(env, predictionKey(user.username, matchId));
  return json({
    state: isBeforeKickoff(match.utcDate) ? "open" : "closed",
    prediction: record ? { homeGuess: record.homeGuess, awayGuess: record.awayGuess } : null,
    resolved: record?.resolved || false,
    finalPoints: record?.finalPoints ?? null,
  });
}

// 예측 시점엔 아직 결과를 모르니 포인트는 0으로 기록해두고, 경기가 끝나면
// scheduled/resolvePredictionOutcomes.js가 정답 여부에 따라 정산한다.
export async function handleSubmitPrediction(request, env) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const body = await request.json().catch(() => null);
  const matchId = body?.matchId ? String(body.matchId) : null;
  const homeGuess = Number(body?.homeGuess);
  const awayGuess = Number(body?.awayGuess);
  if (!matchId || !Number.isInteger(homeGuess) || !Number.isInteger(awayGuess) || homeGuess < 0 || awayGuess < 0) {
    return json({ detail: "matchId와 0 이상의 정수 스코어(homeGuess, awayGuess)가 필요합니다." }, 400);
  }
  if (homeGuess > 20 || awayGuess > 20) return json({ detail: "스코어가 너무 큽니다." }, 400);

  const match = await findMatch(env, matchId);
  if (!match) return json({ detail: "경기를 찾을 수 없습니다." }, 404);
  if (!isBeforeKickoff(match.utcDate)) return json({ detail: "이미 시작된 경기는 예측할 수 없습니다." }, 409);

  const key = predictionKey(user.username, matchId);
  const existing = await getJSON(env, key);
  await putJSON(
    env,
    key,
    {
      username: user.username,
      matchId,
      homeGuess,
      awayGuess,
      resolved: false,
      submittedAt: new Date().toISOString(),
    },
    { expirationTtl: 60 * 24 * 60 * 60 }
  );

  return json({ status: "ok", updated: !!existing });
}
