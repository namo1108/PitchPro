import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS, POINTS_PREDICTION_EXACT, POINTS_PREDICTION_RESULT } from "../lib/config.js";
import { awardPoints, userKey } from "../lib/auth.js";

function resultOf(home, away) {
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}

// 예측 시점엔 포인트를 아예 안 주고(prediction.js), 경기가 끝나면 여기서 한 번에 채점한다 -
// 집관인증(resolveCheckinOutcomes.js)과 완전히 같은 패턴(미정산 기록 순회 -> FINISHED인 것만 처리).
export async function resolvePredictionOutcomes(env) {
  const list = await env.CACHE.list({ prefix: KV_KEYS.predictionPrefix });
  if (!list.keys.length) return;

  const matchesBlob = await getJSON(env, KV_KEYS.matches);
  const matchById = new Map((matchesBlob?.matches || []).map((m) => [String(m.id), m]));

  for (const key of list.keys) {
    try {
      const record = await getJSON(env, key.name);
      if (!record || record.resolved) continue;

      const match = matchById.get(String(record.matchId));
      if (!match || match.status !== "FINISHED") continue;

      const home = match.score?.fullTime?.home;
      const away = match.score?.fullTime?.away;
      if (home === null || home === undefined || away === null || away === undefined) continue;

      const exact = record.homeGuess === home && record.awayGuess === away;
      const sameResult = !exact && resultOf(record.homeGuess, record.awayGuess) === resultOf(home, away);
      const finalPoints = exact ? POINTS_PREDICTION_EXACT : sameResult ? POINTS_PREDICTION_RESULT : 0;
      const reason = exact
        ? `승부예측 적중 (${home}-${away} 정확히 맞힘)`
        : sameResult
          ? `승부예측 결과 적중 (${home}-${away})`
          : `승부예측 실패 (${home}-${away})`;

      if (finalPoints > 0) {
        const user = await getJSON(env, userKey(record.username));
        if (user) await awardPoints(env, user, finalPoints, reason);
      }

      await putJSON(env, key.name, { ...record, resolved: true, finalPoints, actualHome: home, actualAway: away }, { expirationTtl: 60 * 24 * 60 * 60 });
    } catch (err) {
      console.error(`prediction outcome resolve failed for ${key.name}:`, err);
    }
  }
}
