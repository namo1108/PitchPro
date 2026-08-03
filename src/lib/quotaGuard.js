import * as apiFootball from "../sources/apiFootball.js";

// 하루 한도의 이 비율을 넘어가면 부가 기능(이적시장/AI 분석 사전 갱신 등)은 이번 틱을 건너뛴다 -
// 경기/골처럼 훨씬 중요한 실시간 기능이 쓸 나머지 쿼터를 부가 기능이 다 먹어버리는 걸 막는 안전장치.
// 2026-07-26 AI 분석 사전 갱신(15분마다 카드당 최대 6콜)이 이 체크 없이 돌다가 이적시장과 겹쳐서
// 하루 한도를 다 써버린 사고가 있었다 - 이후로 부가 기능은 전부 이 가드를 거치게 통일한다.
const QUOTA_SAFE_RATIO = 0.8;

export async function isQuotaTight(env) {
  try {
    const usage = await apiFootball.getApiUsage(env);
    if (!usage?.limit) return false;
    return usage.current / usage.limit > QUOTA_SAFE_RATIO;
  } catch (err) {
    // /status 호출 자체가 실패하면 대개 한도 초과가 원인이니, 모르면 안전하게 건너뛴다.
    console.error("quota check failed, treating as tight:", err);
    return true;
  }
}
