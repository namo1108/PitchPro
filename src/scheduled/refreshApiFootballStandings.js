import * as apiFootball from "../sources/apiFootball.js";
import { normalizeStandings } from "../adapters/apiFootballAdapter.js";
import { getJSON, putJSON, shouldRun } from "../lib/kv.js";
import { hasLiveOrImminentMatches } from "../lib/matchWindow.js";
import { KV_KEYS, COMPETITIONS } from "../lib/config.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const COMPETITIONS_PER_TICK = 5;
const CURSOR_KEY = `${KV_KEYS.lastRunPrefix}standings-cursor`;
const QUIET_PERIOD_FALLBACK_MS = 60 * 60 * 1000;

// 순위는 골보다도 더 뜸하게 바뀌어서(경기 종료 시점에만), 진행/임박 경기가 없는 조용한 시간대엔
// API-Football 일일 요청 한도를 아끼려고 건너뛴다(단, 최소 1시간마다는 갱신).
export async function refreshApiFootballStandings(env) {
  const existing = (await getJSON(env, KV_KEYS.standings)) || { byCode: {} };

  // 새로 추가한 리그처럼 한 번도 못 가져온 대회는, 조용한 시간대라도 최우선으로 즉시 채운다
  // (일반 로테이션 커서에 맡기면 리그 수가 많아진 지금은 몇 시간씩 걸릴 수 있음).
  const neverFetched = COMPETITIONS.filter((c) => !(c.code in existing.byCode));

  const matchesBlob = await getJSON(env, KV_KEYS.matches);
  if (!neverFetched.length && matchesBlob?.matches?.length && !hasLiveOrImminentMatches(matchesBlob.matches)) {
    const dueForQuietRefresh = await shouldRun(env, `${KV_KEYS.lastRunPrefix}standings-quiet`, QUIET_PERIOD_FALLBACK_MS);
    if (!dueForQuietRefresh) return;
  }

  const cursorRaw = await env.CACHE.get(CURSOR_KEY);
  const cursor = Number(cursorRaw || "0") % COMPETITIONS.length;

  const batch = neverFetched.length
    ? neverFetched.slice(0, COMPETITIONS_PER_TICK)
    : Array.from({ length: COMPETITIONS_PER_TICK }, (_, i) => COMPETITIONS[(cursor + i) % COMPETITIONS.length]);

  const beforeSnapshot = JSON.stringify(existing.byCode);

  for (const comp of batch) {
    try {
      const raw = await apiFootball.getStandings(env, comp.apiFootballLeagueId, comp.apiFootballSeason, { retries: 1 });
      // 응답이 비어도(친선경기 등 원래 순위표가 없는 대회) "시도는 했다"로 기록해야 매 tick 재시도하지 않는다.
      existing.byCode[comp.code] = raw.response?.[0] ? normalizeStandings(raw.response[0]) : { standings: [] };
    } catch (err) {
      console.error(`standings fetch failed for ${comp.code}:`, err);
    }
    await sleep(300);
  }

  // 이번 배치 결과가 이전과 완전히 같으면(비활성 시간대) KV 쓰기를 스킵해 하루 쓰기 한도를 아낀다.
  // 커서는 항상 진행시켜야 다음 틱에 나머지 대회를 순환 조회할 수 있어 이건 그대로 쓴다.
  if (JSON.stringify(existing.byCode) !== beforeSnapshot) {
    existing.lastUpdated = new Date().toISOString();
    await putJSON(env, KV_KEYS.standings, existing);
  }

  // neverFetched 배치를 돌 때는 정규 로테이션 순서가 아니라서 커서를 그대로 둔다.
  if (!neverFetched.length) {
    const nextCursor = (cursor + COMPETITIONS_PER_TICK) % COMPETITIONS.length;
    try {
      await env.CACHE.put(CURSOR_KEY, String(nextCursor));
    } catch (err) {
      console.error("standings cursor write failed:", err);
    }
  }
}
