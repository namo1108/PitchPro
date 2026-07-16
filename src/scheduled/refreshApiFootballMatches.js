import * as apiFootball from "../sources/apiFootball.js";
import { normalizeFixture } from "../adapters/apiFootballAdapter.js";
import { putJSON, getJSON, shouldRun } from "../lib/kv.js";
import { hasLiveOrImminentMatches } from "../lib/matchWindow.js";
import { KV_KEYS, COMPETITIONS, MATCH_WINDOW_DAYS_BEFORE, MATCH_WINDOW_DAYS_AFTER } from "../lib/config.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isoDateOffset(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// 조용한 시간대(진행/임박 경기 없음)에도 새로 잡힌 경기나 연기 등을 놓치지 않도록 최소 이 주기로는 갱신한다.
const QUIET_PERIOD_FALLBACK_MS = 60 * 60 * 1000;

// 진행 중이거나(진행 중이었어야 할, 킥오프 시각이 이미 지났는데 아직 SCHEDULED인) 대회를 먼저 조회해서,
// 틱 도중 레이트리밋에 걸리더라도 "지금 보고 있을 가능성이 높은" 경기가 먼저 갱신되게 한다.
function competitionUrgency(comp, existingByCode) {
  const matches = existingByCode.get(comp.code) || [];
  const now = Date.now();
  if (matches.some((m) => m.status === "IN_PLAY" || m.status === "PAUSED")) return 0;
  if (matches.some((m) => ["SCHEDULED", "TIMED"].includes(m.status) && new Date(m.utcDate).getTime() < now)) return 1;
  return 2;
}

// 14개 리그를 Promise.all로 한꺼번에 부르면 API-Football의 순간 동시요청 제한에 걸리는 것으로 확인돼
// 순차 호출 + 약간의 간격을 둔다(전체 소요 시간은 몇 초 늘지만 백그라운드 크론이라 문제 없음).
// 실패한 리그는 기존 캐시 값을 그대로 유지해 순간적으로 목록이 비지 않게 한다.
export async function refreshApiFootballMatches(env) {
  const from = isoDateOffset(-MATCH_WINDOW_DAYS_BEFORE);
  const to = isoDateOffset(MATCH_WINDOW_DAYS_AFTER);

  const existing = await getJSON(env, KV_KEYS.matches);

  if (existing?.matches?.length && !hasLiveOrImminentMatches(existing.matches)) {
    const dueForQuietRefresh = await shouldRun(env, `${KV_KEYS.lastRunPrefix}matches-quiet`, QUIET_PERIOD_FALLBACK_MS);
    if (!dueForQuietRefresh) return; // 조용한 시간대 -> API 호출/KV 쓰기 없이 스킵(하루 쓰기 한도 절약)
  }

  const existingByCode = new Map();
  for (const m of existing?.matches || []) {
    if (!existingByCode.has(m.competition.code)) existingByCode.set(m.competition.code, []);
    existingByCode.get(m.competition.code).push(m);
  }

  const orderedCompetitions = COMPETITIONS.slice().sort(
    (a, b) => competitionUrgency(a, existingByCode) - competitionUrgency(b, existingByCode)
  );

  const allMatches = [];
  for (const comp of orderedCompetitions) {
    try {
      const raw = await apiFootball.getFixturesByLeague(env, comp.apiFootballLeagueId, comp.apiFootballSeason, from, to, {
        retries: 1,
      });
      allMatches.push(...(raw.response || []).map(normalizeFixture));
    } catch (err) {
      console.error(`fixtures fetch failed for ${comp.code}:`, err);
      allMatches.push(...(existingByCode.get(comp.code) || []));
    }
    await sleep(300);
  }

  // 내용이 지난 틱과 완전히 같으면(비활성 시간대 등) 굳이 다시 안 써서 KV 무료 플랜의 하루 쓰기 한도를 아낀다.
  if (JSON.stringify(allMatches) === JSON.stringify(existing?.matches || [])) return;

  await putJSON(env, KV_KEYS.matches, { matches: allMatches, lastUpdated: new Date().toISOString() });
}
