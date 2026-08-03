import * as apiFootball from "../sources/apiFootball.js";
import { normalizeFixture } from "../adapters/apiFootballAdapter.js";
import { putJSON, getJSON, shouldRun } from "../lib/kv.js";
import { hasLiveOrImminentMatches } from "../lib/matchWindow.js";
import { KV_KEYS, COMPETITIONS, MATCH_WINDOW_DAYS_BEFORE, MATCH_WINDOW_DAYS_AFTER, MATCH_SCHEDULE_END_DATE } from "../lib/config.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isoDateOffset(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// 조용한 시간대(진행/임박 경기 없음)에도 새로 잡힌 경기나 연기 등을 놓치지 않도록 최소 이 주기로는 갱신한다.
const QUIET_PERIOD_FALLBACK_MS = 60 * 60 * 1000;
// 활성 시간대(어딘가 진행/임박 경기 있음)라고 매분 이 28개 대회 전체를 다 훑으면(리그당 1콜)
// 하루 종일 활성인 날엔 그것만으로 API-Football 일일 한도를 다 써버릴 수 있다(2026-07-22 확인,
// 실사용자는 3명뿐인데 쿼터가 오전 중 바닥남). 라이브 스코어 자체의 실시간성은 pollLiveMatches(가벼운
// live=all 호출 1번)가 이미 훨씬 촘촘히(10초 간격) 담당하므로, 이 무거운 전체 스윕은 "새 경기 추가/
// 연기" 같은 걸 잡는 용도로 2분 간격이면 충분하다.
const ACTIVE_MIN_INTERVAL_MS = 2 * 60 * 1000;

// 킥오프 이 시간 전부터는 "곧 시작"으로 쳐서 매치데이 당일의 편성/시간 변경 정도는 여전히 놓치지 않는다.
const UPCOMING_BUFFER_MS = 3 * 60 * 60 * 1000;

// 진행 중이거나(진행 중이었어야 할, 킥오프 시각이 이미 지났는데 아직 SCHEDULED인) 대회를 먼저 조회해서,
// 틱 도중 레이트리밋에 걸리더라도 "지금 보고 있을 가능성이 높은" 경기가 먼저 갱신되게 한다.
// 0/1(급함)은 아래 fetchAndStoreMatches가 활성 시간대에도 항상 다시 불러오고, 2(당분간 조용함)는
// 활성 시간대엔 새로 안 부르고 기존 캐시를 그대로 재사용한다(연말까지 이미 캐싱돼 있어 안전함).
function competitionUrgency(comp, existingByCode) {
  const matches = existingByCode.get(comp.code) || [];
  if (!matches.length) return 0; // 캐시가 아예 없는(새로 추가된) 대회는 항상 최우선으로 채운다
  const now = Date.now();
  if (matches.some((m) => m.status === "IN_PLAY" || m.status === "PAUSED")) return 0;
  if (matches.some((m) => ["SCHEDULED", "TIMED"].includes(m.status) && new Date(m.utcDate).getTime() < now)) return 1;
  if (matches.some((m) => ["SCHEDULED", "TIMED"].includes(m.status) && new Date(m.utcDate).getTime() - now <= UPCOMING_BUFFER_MS)) return 1;
  return 2;
}

// 14개 리그를 Promise.all로 한꺼번에 부르면 API-Football의 순간 동시요청 제한에 걸리는 것으로 확인돼
// 순차 호출 + 약간의 간격을 둔다(전체 소요 시간은 몇 초 늘지만 백그라운드 크론이라 문제 없음).
// 실패한 리그는 기존 캐시 값을 그대로 유지해 순간적으로 목록이 비지 않게 한다.
export async function refreshApiFootballMatches(env) {
  const existing = await getJSON(env, KV_KEYS.matches);

  if (existing?.matches?.length) {
    const isActive = hasLiveOrImminentMatches(existing.matches);
    const gateKey = isActive ? `${KV_KEYS.lastRunPrefix}matches-active` : `${KV_KEYS.lastRunPrefix}matches-quiet`;
    const gateInterval = isActive ? ACTIVE_MIN_INTERVAL_MS : QUIET_PERIOD_FALLBACK_MS;
    if (!(await shouldRun(env, gateKey, gateInterval))) return; // 아직 최소 간격 안 지남 -> API 호출/KV 쓰기 없이 스킵
  }

  await fetchAndStoreMatches(env, existing);
}

// 게이트(간격 제한) 없이 바로 조회+저장하는 부분만 따로 뺐다 - 새 대회를 추가했거나 일정 범위를 넓힌
// 직후처럼, 다음 정기 tick(최대 1시간)을 기다리지 않고 관리자가 즉시 반영해서 확인하고 싶을 때
// (router.js의 /api/admin/refresh-matches?force=1)이 게이트를 건너뛰고 바로 이 함수를 호출한다.
export async function fetchAndStoreMatches(env, existing) {
  const from = isoDateOffset(-MATCH_WINDOW_DAYS_BEFORE);
  // 날짜 범위가 넓어져도 리그당 호출은 여전히 1번이라(API-Football 쿼터엔 영향 없음) 연말까지 미리 채운다.
  const to = [isoDateOffset(MATCH_WINDOW_DAYS_AFTER), MATCH_SCHEDULE_END_DATE].sort().at(-1);

  const existingByCode = new Map();
  for (const m of existing?.matches || []) {
    if (!existingByCode.has(m.competition.code)) existingByCode.set(m.competition.code, []);
    existingByCode.get(m.competition.code).push(m);
  }

  const urgencyByCode = new Map(COMPETITIONS.map((c) => [c.code, competitionUrgency(c, existingByCode)]));
  const orderedCompetitions = COMPETITIONS.slice().sort((a, b) => urgencyByCode.get(a.code) - urgencyByCode.get(b.code));

  // 활성 시간대(2분 간격)엔 대회 29개를 매번 다 다시 부르는 대신, 지금 당장 급한(urgency 0/1) 대회만
  // 실제로 호출한다 - 나머지는 이미 연말까지 캐싱돼 있는 값을 그대로 쓴다. 조용한 시간대(1시간 간격)엔
  // 이 스킵을 하지 않고 전 대회를 다 훑어서, 한가한 리그도 최소 한 시간엔 한 번은 편성 변경(연기 등)을
  // 놓치지 않게 한다(그래도 1시간에 29콜이면 부담 없는 수준).
  const isActive = existing?.matches?.length ? hasLiveOrImminentMatches(existing.matches) : true;

  const allMatches = [];
  for (const comp of orderedCompetitions) {
    const cached = existingByCode.get(comp.code) || [];
    if (isActive && cached.length && urgencyByCode.get(comp.code) === 2) {
      allMatches.push(...cached);
      continue;
    }
    try {
      const raw = await apiFootball.getFixturesByLeague(env, comp.apiFootballLeagueId, comp.apiFootballSeason, from, to, {
        retries: 1,
      });
      allMatches.push(...(raw.response || []).map(normalizeFixture));
    } catch (err) {
      console.error(`fixtures fetch failed for ${comp.code}:`, err);
      allMatches.push(...cached);
    }
    await sleep(300);
  }

  // 내용이 지난 틱과 완전히 같으면(비활성 시간대 등) 굳이 다시 안 써서 KV 무료 플랜의 하루 쓰기 한도를 아낀다.
  if (JSON.stringify(allMatches) === JSON.stringify(existing?.matches || [])) return;

  await putJSON(env, KV_KEYS.matches, { matches: allMatches, lastUpdated: new Date().toISOString() });
}
