import { getJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import { loadSubscriptions, filterInterested, cleanupDeadSubscription, sendToSubscriber } from "../lib/subscriptions.js";

// notifyMatchEvents.js의 "kickoff"는 실제로 시작된 순간(SCHEDULED -> IN_PLAY 전이)에 나가는데, 그와
// 별개로 "곧 시작한다"는 예고 알림을 킥오프 5분 전 딱 한 번 보낸다 - 이 창이 좁아서(5분) 1분 간격
// 크론에서도 한 경기당 보통 한 번 정도만 이 범위 안에 들어온다.
const WINDOW_MS = 5 * 60 * 1000;
const NOTIFIED_TTL_SECONDS = 60 * 60; // 경기 하나당 한 시간이면 창을 다시 통과할 일이 없어 충분
const NOTIFIED_KEY_PREFIX = "kickoffsoonnotified:";

function teamLabel(team) {
  return team.shortName || team.name;
}

export async function notifyUpcomingKickoff(env) {
  const matchesBlob = await getJSON(env, KV_KEYS.matches);
  const all = matchesBlob?.matches || [];
  const now = Date.now();

  const candidates = all.filter((m) => {
    if (!["SCHEDULED", "TIMED"].includes(m.status)) return false;
    const untilKickoff = new Date(m.utcDate).getTime() - now;
    return untilKickoff > 0 && untilKickoff <= WINDOW_MS;
  });
  if (!candidates.length) return;

  const subscriptions = await loadSubscriptions(env);
  if (!subscriptions.length) return;

  for (const match of candidates) {
    const notifiedKey = `${NOTIFIED_KEY_PREFIX}${match.id}`;
    if (await env.CACHE.get(notifiedKey)) continue;

    const interested = filterInterested(subscriptions, match);
    if (interested.length) {
      const image = `/api/notif-image/status?homeTeam=${encodeURIComponent(teamLabel(match.homeTeam))}&homeCrest=${encodeURIComponent(
        match.homeTeam.crest || ""
      )}&awayTeam=${encodeURIComponent(teamLabel(match.awayTeam))}&awayCrest=${encodeURIComponent(
        match.awayTeam.crest || ""
      )}&badge=${encodeURIComponent("5 MIN")}&color=${encodeURIComponent("#24e583")}`;
      const payload = {
        type: "kickoff_soon",
        title: "⏱ 5분 후 킥오프!",
        body: `${teamLabel(match.homeTeam)} vs ${teamLabel(match.awayTeam)} 곧 시작합니다.`,
        matchId: match.id,
        image,
      };
      for (const sub of interested) {
        try {
          const res = await sendToSubscriber(env, sub, payload);
          if (res && (res.status === 404 || res.status === 410)) {
            await cleanupDeadSubscription(env, sub);
          }
        } catch (err) {
          console.error("kickoff-soon push send failed:", err);
        }
      }
    }

    try {
      await env.CACHE.put(notifiedKey, "1", { expirationTtl: NOTIFIED_TTL_SECONDS });
    } catch (err) {
      console.error(`kickoff-soon-notified flag write failed for ${match.id}:`, err);
    }
  }
}
