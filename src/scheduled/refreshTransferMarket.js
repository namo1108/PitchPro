import * as apiFootball from "../sources/apiFootball.js";
import { normalizeTeamTransfers } from "../adapters/apiFootballAdapter.js";
import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS, transferMarketCompetitions } from "../lib/config.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 대상 리그 전체 팀 수가 400개를 넘어서 한 번에 다 못 돌고, 커서를 이어서 여러 틱에 나눠 순환 조회한다.
// Pro 플랜 분당 300회 한도 안에서, 팀 하나당 요청 1개 + 300ms 슬립이라 40팀도 20초 내로 끝나 여유 있다.
// 한 틱에 40팀씩(약 1시간 내 전체 한 바퀴) 처리해 "이적시장에 리그가 몇 개 안 보인다"는 초기 체감을 줄인다 -
// 예전 6팀/15분 페이스로는 한 바퀴에 17시간, 20팀/5분이어도 2시간 가까이 걸렸다.
const TEAMS_PER_TICK = 40;
const CURSOR_KEY = `${KV_KEYS.lastRunPrefix}transfermarket-cursor`;

// K리그는 사용자 요청상 항상 최우선(AI 분석 티어 시스템과 동일한 원칙) - 커서가 리그 배열 순서 그대로
// 돌면 K리그가 COMPETITIONS 뒤쪽에 있어서 정작 가장 궁금해할 K리그 이적이 몇 시간씩 안 보일 수 있었다.
// 그래서 이적시장 순환 대상만큼은 K리그를 맨 앞으로 당겨서, 서비스 기동 직후에도 바로 채워지게 한다.
const TRANSFER_PRIORITY_CODES = ["KL1", "KL2"];
function transferPriorityRank(code) {
  const idx = TRANSFER_PRIORITY_CODES.indexOf(code);
  return idx === -1 ? TRANSFER_PRIORITY_CODES.length : idx;
}

// 순위표 캐시에 이미 들어있는 팀 목록을 그대로 재사용한다(팀 목록만 필요한 거라 별도 API 호출이 필요 없음).
// MLS(동/서부 컨퍼런스)처럼 그룹이 여러 개인 리그는 standings 배열에 그룹별로 여러 테이블이 들어있으므로
// 전부 순회해야 한다 - 첫 번째 그룹만 보면 나머지 그룹 팀들이 통째로 이적시장 대상에서 빠지게 된다.
// onlyOpenWindow로 "지금 이적 등록 기간인 리그"만 추려서, 창구가 닫힌 리그(대부분의 기간)에 굳이
// 순환 조회 예산을 낭비하지 않고 실제로 이적이 일어나는 리그에 집중한다.
function buildTeamRoster(standingsBlob) {
  const roster = [];
  const comps = transferMarketCompetitions({ onlyOpenWindow: true }).sort((a, b) => transferPriorityRank(a.code) - transferPriorityRank(b.code));
  for (const comp of comps) {
    const tables = standingsBlob?.byCode?.[comp.code]?.standings || [];
    for (const table of tables) {
      for (const row of table.table || []) {
        roster.push({ teamId: row.team.id, teamName: row.team.name, competitionCode: comp.code });
      }
    }
  }
  return roster;
}

export async function refreshTransferMarket(env) {
  const standingsBlob = await getJSON(env, KV_KEYS.standings);
  const roster = buildTeamRoster(standingsBlob);
  // 순위표가 아직 하나도 안 채워졌거나(초기 구동 직후), 지금 이적 등록 기간인 리그가 하나도 없으면
  // (연중 조용한 시기) 이번 틱은 API 호출 없이 건너뛴다 - 기존에 모아둔 데이터는 그대로 남아있다.
  if (!roster.length) return;

  const existing = (await getJSON(env, KV_KEYS.transferMarket)) || { byTeam: {} };

  const cursorRaw = await env.CACHE.get(CURSOR_KEY);
  const cursor = Number(cursorRaw || "0") % roster.length;
  const batch = Array.from({ length: Math.min(TEAMS_PER_TICK, roster.length) }, (_, i) => roster[(cursor + i) % roster.length]);

  const beforeSnapshot = JSON.stringify(existing.byTeam);

  for (const { teamId, teamName, competitionCode } of batch) {
    try {
      const raw = await apiFootball.getTeamTransfers(env, teamId, { retries: 1 });
      const transfers = normalizeTeamTransfers(raw.response, teamId);
      existing.byTeam[teamId] = { teamId, teamName, competitionCode, transfers, fetchedAt: new Date().toISOString() };
    } catch (err) {
      console.error(`transfer market fetch failed for team ${teamId}:`, err);
    }
    await sleep(300);
  }

  if (JSON.stringify(existing.byTeam) !== beforeSnapshot) {
    existing.lastUpdated = new Date().toISOString();
    await putJSON(env, KV_KEYS.transferMarket, existing);
  }

  const nextCursor = (cursor + TEAMS_PER_TICK) % roster.length;
  try {
    await env.CACHE.put(CURSOR_KEY, String(nextCursor));
  } catch (err) {
    console.error("transfer market cursor write failed:", err);
  }
}
