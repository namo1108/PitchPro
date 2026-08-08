import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import * as apiFootball from "../sources/apiFootball.js";
import { normalizeFixture } from "../adapters/apiFootballAdapter.js";

export async function handleHeadToHead(request, env, url) {
  const teamA = url.searchParams.get("a");
  const teamB = url.searchParams.get("b");
  if (!teamA || !teamB) return json({ detail: "a, b 팀 id가 필요합니다." }, 400);

  const cacheKey = `h2h:${[teamA, teamB].sort().join("_")}`;
  const cached = await getJSON(env, cacheKey);
  if (cached) return json(cached);

  // 상대전적은 팀/경기 상세를 보조하는 정보라, 레이트리밋 등으로 조회에 실패해도 그 페이지 전체를
  // 죽이지 않고 "지금은 상대전적을 불러올 수 없다"는 뜻으로 빈 결과 + limited 플래그를 돌려준다
  // (2026-08-08, team.js와 같은 원인으로 발견 - 이 라우트는 아예 try/catch가 없었다).
  let raw;
  try {
    raw = await apiFootball.getHeadToHead(env, teamA, teamB, 10);
  } catch (err) {
    console.error("head-to-head fetch failed:", err);
    return json({ matches: [], aggregates: null, limited: true });
  }
  const result = { matches: (raw.response || []).map(normalizeFixture), aggregates: null, limited: false };

  await putJSON(env, cacheKey, result, { expirationTtl: 600 });
  return json(result);
}
