import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import { sendGoalPush } from "../lib/push.js";

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
  const [fdMatches, klMatches, prev] = await Promise.all([
    getJSON(env, KV_KEYS.matchesFootballData),
    getJSON(env, KV_KEYS.matchesKLeague),
    getJSON(env, KV_KEYS.prevScores),
  ]);

  const live = [...(fdMatches?.matches || []), ...(klMatches?.matches || [])].filter(
    (m) => m.status === "IN_PLAY" || m.status === "PAUSED"
  );

  const prevScores = prev?.scores || {};
  const nextScores = {};
  const goalEvents = [];

  for (const m of live) {
    const home = m.score.fullTime.home ?? 0;
    const away = m.score.fullTime.away ?? 0;
    nextScores[m.id] = { home, away };

    const before = prevScores[m.id];
    if (before && (home > before.home || away > before.away)) {
      goalEvents.push(m);
    }
  }

  await putJSON(env, KV_KEYS.prevScores, { scores: nextScores });

  if (goalEvents.length === 0) return;

  const subscriptions = await loadSubscriptions(env);
  if (subscriptions.length === 0) return;

  for (const match of goalEvents) {
    const home = match.score.fullTime.home;
    const away = match.score.fullTime.away;
    const payload = {
      title: "⚽ 골!",
      body: `${match.homeTeam.shortName || match.homeTeam.name} ${home} - ${away} ${match.awayTeam.shortName || match.awayTeam.name}`,
      matchId: match.id,
    };

    const interested = subscriptions.filter(
      (s) => s.teamIds?.includes(match.homeTeam.id) || s.teamIds?.includes(match.awayTeam.id)
    );

    for (const sub of interested) {
      try {
        await sendGoalPush(env, sub.subscription, payload);
      } catch (err) {
        console.error("push send failed:", err);
      }
    }
  }
}
