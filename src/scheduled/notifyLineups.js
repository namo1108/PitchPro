import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import { sendGoalPush } from "../lib/push.js";
import * as apiFootball from "../sources/apiFootball.js";

// 킥오프 70분 전부터 확인 시작(API-Football은 보통 킥오프 1시간 전쯤 라인업을 올림).
// 한 번 발표됐다고 확인되면(match.lineupsAnnounced=true) 그 경기는 다시 조회하지 않는다 -> API 절약.
// 이 플래그는 /api/matches 응답에도 그대로 실려 나가서, 프론트가 경기 상세를 매번 다시 안 불러도
// 목록만 보고 "라인업 발표됨"을 알 수 있다(예전엔 프론트가 30초마다 후보 경기 상세를 직접 조회해서
// API 요청이 폭증했었음).
const WINDOW_MAX_MS = 70 * 60 * 1000;
const NOTIFIED_TTL_SECONDS = 6 * 60 * 60;
const NOTIFIED_KEY_PREFIX = "lineupnotified:";

async function loadSubscriptions(env) {
  const list = await env.CACHE.list({ prefix: KV_KEYS.pushSubscriptionPrefix });
  const subs = await Promise.all(
    list.keys.map(async (k) => {
      const raw = await env.CACHE.get(k.name);
      return raw ? JSON.parse(raw) : null;
    })
  );
  return subs.filter(Boolean);
}

export async function notifyLineups(env) {
  const matchesBlob = await getJSON(env, KV_KEYS.matches);
  const all = matchesBlob?.matches || [];
  const now = Date.now();

  const candidates = all.filter((m) => {
    if (m.lineupsAnnounced) return false; // 이미 확인 끝난 경기는 다시 안 봄
    if (!["SCHEDULED", "TIMED"].includes(m.status)) return false;
    const untilKickoff = new Date(m.utcDate).getTime() - now;
    return untilKickoff > 0 && untilKickoff <= WINDOW_MAX_MS;
  });

  if (!candidates.length) return;

  const subscriptions = await loadSubscriptions(env);
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
      const interested = subscriptions.filter(
        (s) => s.teamIds?.includes(match.homeTeam.id) || s.teamIds?.includes(match.awayTeam.id)
      );
      if (interested.length) {
        const payload = {
          type: "lineup",
          title: "📋 라인업 발표",
          body: `${match.homeTeam.shortName || match.homeTeam.name} vs ${match.awayTeam.shortName || match.awayTeam.name} 라인업이 발표됐습니다.`,
          matchId: match.id,
        };
        for (const sub of interested) {
          try {
            await sendGoalPush(env, sub.subscription, payload);
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
