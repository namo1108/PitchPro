import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS, POINTS_CHECKIN_WIN, POINTS_CHECKIN_LOSS } from "../lib/config.js";
import { awardPoints, userKey } from "../lib/auth.js";

// 집관인증 시점엔 참여 포인트만 주고(checkin.js), 경기가 끝나면(FINISHED) 여기서 승/무/패에 따라
// 최종 포인트로 정산한다(이미 준 참여 포인트와의 차액만 추가/차감). 아직 안 끝난 경기는 다음 틱에 다시 본다.
export async function resolveCheckinOutcomes(env) {
  const list = await env.CACHE.list({ prefix: KV_KEYS.checkinPrefix });
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

      const isHome = String(match.homeTeam.id) === String(record.teamId);
      const myGoals = isHome ? home : away;
      const oppGoals = isHome ? away : home;
      const finalPoints = myGoals > oppGoals ? POINTS_CHECKIN_WIN : myGoals < oppGoals ? POINTS_CHECKIN_LOSS : record.awardedPoints;

      const delta = finalPoints - record.awardedPoints;
      if (delta !== 0) {
        const user = await getJSON(env, userKey(record.username));
        if (user) await awardPoints(env, user, delta);
      }

      await putJSON(env, key.name, { ...record, resolved: true, finalPoints }, { expirationTtl: 60 * 24 * 60 * 60 });
    } catch (err) {
      console.error(`checkin outcome resolve failed for ${key.name}:`, err);
    }
  }
}
