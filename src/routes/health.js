import { json } from "../lib/http.js";
import { getJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";

export async function handleHealth(request, env) {
  const [fdMatches, fdStandings, klMatches, klStandings] = await Promise.all([
    getJSON(env, KV_KEYS.matchesFootballData),
    getJSON(env, KV_KEYS.standingsFootballData),
    getJSON(env, KV_KEYS.matchesKLeague),
    getJSON(env, KV_KEYS.standingsKLeague),
  ]);

  return json({
    status: "ok",
    cache: {
      footballDataMatches: fdMatches?.lastUpdated ?? null,
      footballDataStandings: fdStandings?.lastUpdated ?? null,
      kLeagueMatches: klMatches?.lastUpdated ?? null,
      kLeagueStandings: klStandings?.lastUpdated ?? null,
    },
  });
}
