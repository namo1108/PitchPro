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

  const raw = await apiFootball.getHeadToHead(env, teamA, teamB, 10);
  const result = { matches: (raw.response || []).map(normalizeFixture), aggregates: null, limited: false };

  await putJSON(env, cacheKey, result, { expirationTtl: 600 });
  return json(result);
}
