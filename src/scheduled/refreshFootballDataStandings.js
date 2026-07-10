import * as footballData from "../sources/footballData.js";
import { normalizeStandings } from "../adapters/footballDataAdapter.js";
import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS, FOOTBALL_DATA_COMPETITIONS } from "../lib/config.js";

const COMPETITIONS_PER_TICK = 2;

// 12개 대회를 한 tick에 다 부르면 순간적으로 분당 호출 제한을 넘길 수 있으므로,
// 매 tick마다 2개씩만 순환 조회해 30분에 걸쳐 전체를 갱신한다.
export async function refreshFootballDataStandings(env) {
  const cursorRaw = await env.CACHE.get(KV_KEYS.standingsFootballDataCursor);
  const cursor = Number(cursorRaw || "0") % FOOTBALL_DATA_COMPETITIONS.length;

  const batch = [];
  for (let i = 0; i < COMPETITIONS_PER_TICK; i++) {
    batch.push(FOOTBALL_DATA_COMPETITIONS[(cursor + i) % FOOTBALL_DATA_COMPETITIONS.length]);
  }

  const existing = (await getJSON(env, KV_KEYS.standingsFootballData)) || { byCode: {} };

  for (const comp of batch) {
    try {
      const raw = await footballData.getStandings(env, comp.code);
      existing.byCode[comp.code] = normalizeStandings(raw);
    } catch (err) {
      console.error(`standings fetch failed for ${comp.code}:`, err);
    }
  }

  existing.lastUpdated = new Date().toISOString();
  await putJSON(env, KV_KEYS.standingsFootballData, existing);

  const nextCursor = (cursor + COMPETITIONS_PER_TICK) % FOOTBALL_DATA_COMPETITIONS.length;
  await env.CACHE.put(KV_KEYS.standingsFootballDataCursor, String(nextCursor));
}
