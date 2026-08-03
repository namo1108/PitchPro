import { getJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import { lookupAndCacheFee } from "../lib/transfermarkt.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// API-Football이 실제 금액을 준 이적(예: "€ 55M")이나 애초에 금액이 없는 자유계약/임대는 굳이
// Transfermarkt까지 찾아볼 필요가 없다 - 금액도 없고 자유계약/임대도 아닌("Transfer"/null처럼 정보가
// 부족한) 이적만 대상으로 삼는다.
function needsLookup(moveType) {
  if (!moveType) return true;
  if (/\d/.test(moveType)) return false; // 이미 실제 금액이 있음
  if (/free/i.test(moveType) || /loan/i.test(moveType) || /n\/?a/i.test(moveType)) return false;
  return true;
}

// Transfermarkt 조회 자체가 매 틱 API-Football 호출과 무관한 별도 사이트라 쿼터 걱정은 없지만,
// 그 사이트에 부담을 주지 않으려고 한 틱에 아주 적은 수(5건)만, 그것도 사이 사이 쉬어가며 처리한다.
// 수천 건을 다 채우는 데 며칠 걸리겠지만 이적료는 골처럼 급한 정보가 아니라 이 정도 속도면 충분하다.
const BATCH_SIZE = 5;
const CURSOR_KEY = `${KV_KEYS.lastRunPrefix}transfermarkt-fee-cursor`;

export async function enrichTransferFees(env) {
  const blob = await getJSON(env, KV_KEYS.transferMarket);
  const teams = Object.values(blob?.byTeam || {});
  if (!teams.length) return;

  const candidates = teams
    .flatMap((team) => team.transfers || [])
    .filter((t) => t.playerId && needsLookup(t.moveType))
    // playerId+날짜 기준으로 정렬해두면 팀 목록이 갱신되며 순서가 흔들려도 커서가 대략 같은 지점을
    // 가리켜서, 매번 처음부터 다시 도는 대신 이어서 진행하는 효과를 볼 수 있다.
    .sort((a, b) => (a.playerId === b.playerId ? a.date.localeCompare(b.date) : String(a.playerId).localeCompare(String(b.playerId))));

  if (!candidates.length) return;

  const cursorRaw = await env.CACHE.get(CURSOR_KEY);
  const cursor = Number(cursorRaw || "0") % candidates.length;
  const batch = Array.from({ length: Math.min(BATCH_SIZE, candidates.length) }, (_, i) => candidates[(cursor + i) % candidates.length]);

  for (const t of batch) {
    try {
      await lookupAndCacheFee(env, { playerId: t.playerId, playerName: t.playerName, date: t.date });
    } catch (err) {
      console.error(`transfermarkt enrich failed for ${t.playerName}:`, err);
    }
    await sleep(400);
  }

  const nextCursor = (cursor + BATCH_SIZE) % candidates.length;
  try {
    await env.CACHE.put(CURSOR_KEY, String(nextCursor));
  } catch (err) {
    console.error("transfermarkt fee cursor write failed:", err);
  }
}
