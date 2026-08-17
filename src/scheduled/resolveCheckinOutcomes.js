import { getJSON, putJSON } from "../lib/kv.js";
import {
  KV_KEYS,
  POINTS_CHECKIN_WIN,
  POINTS_CHECKIN_DRAW,
  POINTS_CHECKIN_LOSS,
  POINTS_CHECKIN_SHOOTOUT_WIN,
  POINTS_CHECKIN_SHOOTOUT_LOSS,
} from "../lib/config.js";
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
      const cheeredTeamName = isHome ? match.homeTeam.shortName || match.homeTeam.name : match.awayTeam.shortName || match.awayTeam.name;

      let finalPoints;
      let reason;
      if (myGoals > oppGoals) {
        finalPoints = POINTS_CHECKIN_WIN;
        reason = `${cheeredTeamName} 경기 승리`;
      } else if (myGoals < oppGoals) {
        finalPoints = POINTS_CHECKIN_LOSS;
        reason = `${cheeredTeamName} 경기 패배`;
      } else {
        // 정규시간(+연장) 무승부 - 컵대회처럼 승부차기까지 갔으면 무승부 취급 대신 승부차기
        // 승패로 정산한다. 승부차기 스코어가 없으면(리그 경기 등) 무승부(2점)로 정산한다.
        const penHome = match.score?.penalty?.home;
        const penAway = match.score?.penalty?.away;
        const hasShootout = penHome !== null && penHome !== undefined && penAway !== null && penAway !== undefined;
        if (hasShootout) {
          const myPens = isHome ? penHome : penAway;
          const oppPens = isHome ? penAway : penHome;
          finalPoints = myPens > oppPens ? POINTS_CHECKIN_SHOOTOUT_WIN : POINTS_CHECKIN_SHOOTOUT_LOSS;
          reason = myPens > oppPens ? `${cheeredTeamName} 승부차기 승리` : `${cheeredTeamName} 승부차기 패배`;
        } else {
          finalPoints = POINTS_CHECKIN_DRAW;
          reason = `${cheeredTeamName} 경기 무승부`;
        }
      }

      const delta = finalPoints - record.awardedPoints;
      if (delta !== 0) {
        const user = await getJSON(env, userKey(record.username));
        if (user) await awardPoints(env, user, delta, reason);
      }

      await putJSON(env, key.name, { ...record, resolved: true, finalPoints }, { expirationTtl: 60 * 24 * 60 * 60 });
    } catch (err) {
      console.error(`checkin outcome resolve failed for ${key.name}:`, err);
    }
  }
}
