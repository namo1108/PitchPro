import { getJSON } from "../lib/kv.js";
import { KV_KEYS, COMPETITIONS } from "../lib/config.js";
import { buildBracket } from "../routes/leagueBracket.js";

// 대진표는 5분 캐시(routes/leagueBracket.js)라 그냥 놔둬도 5분 내로는 알아서 최신화되지만, 사용자가
// "바로바로" 갱신되길 원해서(2026-07 제보) 실제로 그 대회에 지금 진행 중인 경기가 있을 때만 1분
// 크론에 맞춰 앞서 채워둔다 - 월드컵/유로처럼 대부분 시즌엔 아무 경기도 없는 대회를 매분 API-Football
// 조회로 깨우는 낭비를 피하면서도, 실제로 라이브인 동안은 사실상 실시간으로 보이게 한다.
export async function refreshBrackets(env) {
  const matchesBlob = await getJSON(env, KV_KEYS.matches);
  const liveCodesSet = new Set(
    (matchesBlob?.matches || []).filter((m) => m.status === "IN_PLAY" || m.status === "PAUSED").map((m) => m.competition.code)
  );
  if (!liveCodesSet.size) return;

  const bracketComps = COMPETITIONS.filter((c) => c.hasBracket && liveCodesSet.has(c.code));
  for (const comp of bracketComps) {
    try {
      await buildBracket(env, comp);
    } catch (err) {
      console.error(`bracket refresh failed for ${comp.code}:`, err);
    }
  }
}
