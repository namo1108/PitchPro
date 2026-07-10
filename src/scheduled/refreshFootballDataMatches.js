import * as footballData from "../sources/footballData.js";
import { normalizeMatch } from "../adapters/footballDataAdapter.js";
import { putJSON } from "../lib/kv.js";
import {
  KV_KEYS,
  FOOTBALL_DATA_COMPETITION_CODES,
  MATCH_WINDOW_DAYS_BEFORE,
  MATCH_WINDOW_DAYS_AFTER,
} from "../lib/config.js";

function isoDateOffset(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function refreshFootballDataMatches(env) {
  const dateFrom = isoDateOffset(-MATCH_WINDOW_DAYS_BEFORE);
  const dateTo = isoDateOffset(MATCH_WINDOW_DAYS_AFTER);
  const raw = await footballData.getMatches(env, dateFrom, dateTo, FOOTBALL_DATA_COMPETITION_CODES);
  const matches = (raw.matches || []).map(normalizeMatch);
  await putJSON(env, KV_KEYS.matchesFootballData, { matches, lastUpdated: new Date().toISOString() });
}
