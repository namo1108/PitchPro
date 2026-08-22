import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import * as apiFootball from "../sources/apiFootball.js";
import { loadSubscriptions, filterInterested, sendToSubscriber } from "../lib/subscriptions.js";

// 킥오프 60분 전부터 확인 시작(사용자 요청, 2026-08-08 - API-Football은 보통 킥오프 1시간 전쯤 라인업을 올림).
// 한 번 발표됐다고 확인되면(match.lineupsAnnounced=true) 그 경기는 다시 조회하지 않는다 -> API 절약.
// 이 플래그는 /api/matches 응답에도 그대로 실려 나가서, 프론트가 경기 상세를 매번 다시 안 불러도
// 목록만 보고 "라인업 발표됨"을 알 수 있다(예전엔 프론트가 30초마다 후보 경기 상세를 직접 조회해서
// API 요청이 폭증했었음).
const WINDOW_MAX_MS = 60 * 60 * 1000;
// 라인업이 유독 늦게(킥오프 직전~직후) 올라오는 경기가 있는데, 예전엔 상태가 SCHEDULED/TIMED일 때만
// 후보로 봐서 킥오프와 동시에 IN_PLAY로 넘어가버리면 그 경기는 영영 다시 확인을 안 했다 - 실제 데이터는
// 있는데도 lineupsAnnounced가 끝까지 false로 남고 알림도 안 나간 사고(부천FC1995 vs 광주FC, 2026-08-08
// 확인). 킥오프 후 20분까지는 계속 후보에 포함시켜 늦게 올라온 라인업도 잡아낸다.
const POST_KICKOFF_GRACE_MS = 20 * 60 * 1000;
const NOTIFIED_TTL_SECONDS = 6 * 60 * 60;
const NOTIFIED_KEY_PREFIX = "lineupnotified:";

export async function notifyLineups(env) {
  const matchesBlob = await getJSON(env, KV_KEYS.matches);
  const all = matchesBlob?.matches || [];
  const now = Date.now();

  const subscriptions = await loadSubscriptions(env);

  // pollLiveMatches.js가 live=all로 전세계 라이브 경기를 전부 캐시에 합쳐두기 때문에, 여기서
  // 상태/시간대만 보고 후보를 걸러내면 아무도 구독 안 한 해외 하부리그 경기까지 매 틱 라인업을
  // 조회하게 된다(detectCardsAndNotify.js의 watchedLive와 같은 이유로 API-Football 레이트리밋을
  // 갉아먹는 주범 중 하나였음, 2026-08-22). 구독자가 실제로 관심 있는 경기만 조회한다.
  const candidates = all.filter((m) => {
    if (m.lineupsAnnounced) return false; // 이미 확인 끝난 경기는 다시 안 봄
    if (!["SCHEDULED", "TIMED", "IN_PLAY"].includes(m.status)) return false;
    const untilKickoff = new Date(m.utcDate).getTime() - now;
    if (untilKickoff <= -POST_KICKOFF_GRACE_MS || untilKickoff > WINDOW_MAX_MS) return false;
    return filterInterested(subscriptions, m).length > 0;
  });

  if (!candidates.length) return;

  let matchesChanged = false;

  for (const match of candidates) {
    let lineupsRaw;
    try {
      lineupsRaw = await apiFootball.getFixtureLineups(env, match.id);
    } catch {
      continue;
    }
    if (!lineupsRaw.response || lineupsRaw.response.length < 2) continue; // 아직 미발표

    match.lineupsAnnounced = true;
    matchesChanged = true;

    const notifiedKey = `${NOTIFIED_KEY_PREFIX}${match.id}`;
    const alreadyNotified = subscriptions.length ? await env.CACHE.get(notifiedKey) : true;
    if (!alreadyNotified) {
      // 즐겨찾기 팀(teamIds)뿐 아니라 🔔로 이 경기만 개별 지정한(matchIds) 구독자도 대상에 포함해야 한다
      // (예전엔 teamIds만 봐서 즐겨찾기 안 한 팀 경기를 개별 알림 켜둬도 라인업 알림이 안 갔었음).
      const interested = filterInterested(subscriptions, match);
      if (interested.length) {
        const image = `/api/notif-image/status?homeTeam=${encodeURIComponent(
          match.homeTeam.shortName || match.homeTeam.name
        )}&homeCrest=${encodeURIComponent(match.homeTeam.crest || "")}&awayTeam=${encodeURIComponent(
          match.awayTeam.shortName || match.awayTeam.name
        )}&awayCrest=${encodeURIComponent(match.awayTeam.crest || "")}&badge=${encodeURIComponent("LINEUP")}&color=${encodeURIComponent(
          "#24e583"
        )}`;
        const payload = {
          type: "lineup",
          title: "📋 라인업 발표",
          body: `${match.homeTeam.shortName || match.homeTeam.name} vs ${match.awayTeam.shortName || match.awayTeam.name} 라인업이 발표됐습니다.`,
          matchId: match.id,
          image,
        };
        for (const sub of interested) {
          try {
            await sendToSubscriber(env, sub, payload);
          } catch (err) {
            console.error("lineup push send failed:", err);
          }
        }
      }
      try {
        await env.CACHE.put(notifiedKey, "1", { expirationTtl: NOTIFIED_TTL_SECONDS });
      } catch (err) {
        console.error(`lineup-notified flag write failed for ${match.id}:`, err);
      }
    }
  }

  if (matchesChanged) {
    await putJSON(env, KV_KEYS.matches, matchesBlob);
  }
}
