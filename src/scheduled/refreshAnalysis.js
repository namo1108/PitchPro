import { buildAnalysis } from "../routes/analysis.js";
import { isQuotaTight } from "../lib/quotaGuard.js";

// AI 분석 탭은 계산이 무거워서(카드당 팀 컨텍스트 2콜 + H2H 1콜 + 배당 1콜 - 카드 최대 8개면 최대
// 약 48콜) 실제 사용자 요청이 냉캐시를 만나면 몇 초씩 걸린다. 캐시가 끝나기 전에 미리 다시 채워둬서,
// 실사용자는 이 계산을 직접 기다릴 일이 없게 한다(matches/standings와 같은 "크론이 미리 채운다" 원칙).
// 단, 이 갱신 자체가 한 번에 최대 48콜이나 쓰는 무거운 작업이라 이적시장과 마찬가지로 쿼터가
// 빠듯할 땐 건너뛴다(2026-07-26: 이 가드 없이 15분마다 돌다가 이적시장과 겹쳐서 하루 한도를
// 다 써버린 사고가 있었음 - 그래서 주기도 15분 -> 1시간으로 늘리고 이 가드를 추가함).
export async function refreshAnalysis(env) {
  if (await isQuotaTight(env)) return;
  try {
    await buildAnalysis(env);
  } catch (err) {
    console.error("analysis pre-warm failed:", err);
  }
}
