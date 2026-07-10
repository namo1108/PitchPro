import * as theSportsDb from "../sources/theSportsDb.js";
import { normalizeEvent } from "../adapters/theSportsDbAdapter.js";
import { putJSON } from "../lib/kv.js";
import { KV_KEYS, K_LEAGUE_COMPETITIONS, K_LEAGUE_SEASON } from "../lib/config.js";

// eventsnextleague/eventspastleague로 "현재 라운드"를 알아낸 뒤, 그 주변 라운드를
// eventsround.php로 통째로 가져온다(라운드당 여러 경기 포함). 이렇게 하면 eventsseason.php가
// 시즌 1라운드로 제한되는 문제를 피하면서 -1~+1 라운드 범위의 실제 일정을 얻을 수 있다.
async function discoverRoundWindow(env, leagueId) {
  const [next, past] = await Promise.all([
    theSportsDb.getNextEvents(env, leagueId).catch(() => ({ events: [] })),
    theSportsDb.getPastEvents(env, leagueId).catch(() => ({ events: [] })),
  ]);

  const rounds = [next.events?.[0]?.intRound, past.events?.[0]?.intRound]
    .map(Number)
    .filter((r) => Number.isFinite(r));

  if (rounds.length === 0) return [];

  const from = Math.max(1, Math.min(...rounds) - 1);
  const to = Math.max(...rounds) + 1;
  const window = [];
  for (let r = from; r <= to; r++) window.push(r);
  return window;
}

export async function refreshKLeagueMatches(env) {
  const matches = [];

  for (const comp of K_LEAGUE_COMPETITIONS) {
    try {
      const rounds = await discoverRoundWindow(env, comp.theSportsDbLeagueId);
      const byId = new Map();

      for (const round of rounds) {
        const raw = await theSportsDb.getEventsByRound(env, comp.theSportsDbLeagueId, round, K_LEAGUE_SEASON);
        for (const event of raw.events || []) {
          byId.set(event.idEvent, event);
        }
      }

      for (const event of byId.values()) {
        matches.push(normalizeEvent(event, comp));
      }
    } catch (err) {
      console.error(`${comp.code} events fetch failed:`, err);
    }
  }

  if (matches.length > 0) {
    await putJSON(env, KV_KEYS.matchesKLeague, { matches, lastUpdated: new Date().toISOString() });
  }
}
