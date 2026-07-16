import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import { sendGoalPush } from "../lib/push.js";
import * as apiFootball from "../sources/apiFootball.js";
import { normalizeGoalEvents } from "../adapters/apiFootballAdapter.js";

// 골이 감지된 경기는 이벤트 조회로 득점자 이름까지 알아내서 알림 문구에 붙인다(실패해도 알림 자체는 보냄).
async function getTeamGoalEvents(env, matchId, teamId) {
  try {
    const raw = await apiFootball.getFixtureEvents(env, matchId);
    return normalizeGoalEvents(raw.response).filter((g) => g.teamId === teamId);
  } catch {
    return [];
  }
}

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

export async function detectGoalsAndNotify(env) {
  const [matchesBlob, prev] = await Promise.all([getJSON(env, KV_KEYS.matches), getJSON(env, KV_KEYS.prevScores)]);

  const live = (matchesBlob?.matches || []).filter((m) => m.status === "IN_PLAY" || m.status === "PAUSED");

  const prevScores = prev?.scores || {};
  const nextScores = {};
  const goalEvents = [];

  for (const m of live) {
    const home = m.score.fullTime.home ?? 0;
    const away = m.score.fullTime.away ?? 0;
    nextScores[m.id] = { home, away };

    // 크론 간격 사이 같은 팀이 2골 이상 넣으면 점수 차이(count)가 1보다 커진다 -> 그만큼 알림도 여러 건
    // 보내야 하는데, 예전엔 "골이 들어갔다" 여부만 봐서 한 틱에 여러 골이 몰리면 뒤 골 알림만 가고
    // 앞 골 알림은 통째로 누락됐었다.
    const before = prevScores[m.id];
    if (before) {
      const homeDelta = home - before.home;
      const awayDelta = away - before.away;
      if (homeDelta > 0) goalEvents.push({ match: m, scoringTeamId: m.homeTeam.id, count: homeDelta });
      if (awayDelta > 0) goalEvents.push({ match: m, scoringTeamId: m.awayTeam.id, count: awayDelta });
    }
  }

  // 진행 중인 경기가 하나도 없으면 쓸 것도 없다 -> KV 무료 플랜의 하루 쓰기 한도(1,000회)를 아끼기 위해 스킵.
  if (live.length > 0) {
    await putJSON(env, KV_KEYS.prevScores, { scores: nextScores });
  }

  if (goalEvents.length === 0) return;

  const subscriptions = await loadSubscriptions(env);
  if (subscriptions.length === 0) return;

  for (const { match, scoringTeamId, count } of goalEvents) {
    const home = match.score.fullTime.home;
    const away = match.score.fullTime.away;
    const teamGoals = await getTeamGoalEvents(env, match.id, scoringTeamId);
    // 이번에 새로 늘어난 골만큼(count) 최근 골 이벤트를 뒤에서 잘라 각각 알림 하나씩 만든다.
    // 이벤트 조회 자체가 실패했으면 득점자 이름 없이도 최소 count건은 보낸다(놓치는 것보단 낫다).
    const newGoals = teamGoals.length >= count ? teamGoals.slice(-count) : Array.from({ length: count }, () => ({ scorer: null }));

    const interested = subscriptions.filter(
      (s) =>
        s.teamIds?.includes(match.homeTeam.id) ||
        s.teamIds?.includes(match.awayTeam.id) ||
        s.matchIds?.includes(match.id)
    );
    if (!interested.length) continue;

    for (const g of newGoals) {
      const payload = {
        type: "goal",
        title: g.scorer ? `⚽ 골! ${g.scorer}` : "⚽ 골!",
        body: `${match.homeTeam.shortName || match.homeTeam.name} ${home} - ${away} ${match.awayTeam.shortName || match.awayTeam.name}`,
        matchId: match.id,
      };

      for (const sub of interested) {
        try {
          await sendGoalPush(env, sub.subscription, payload);
        } catch (err) {
          console.error("push send failed:", err);
        }
      }
    }
  }
}
