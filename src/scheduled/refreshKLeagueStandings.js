import * as theSportsDb from "../sources/theSportsDb.js";
import { normalizeStandings } from "../adapters/theSportsDbAdapter.js";
import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS, K_LEAGUE_COMPETITIONS, K_LEAGUE_SEASON } from "../lib/config.js";

export async function refreshKLeagueStandings(env) {
  const existing = (await getJSON(env, KV_KEYS.standingsKLeague)) || { byCode: {} };

  for (const comp of K_LEAGUE_COMPETITIONS) {
    try {
      const raw = await theSportsDb.getStandings(env, comp.theSportsDbLeagueId, K_LEAGUE_SEASON);
      existing.byCode[comp.code] = normalizeStandings(raw);
    } catch (err) {
      console.error(`${comp.code} standings fetch failed:`, err);
    }
  }

  existing.lastUpdated = new Date().toISOString();
  await putJSON(env, KV_KEYS.standingsKLeague, existing);
}
