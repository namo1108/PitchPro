import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import { findCompetition } from "../lib/config.js";
import * as apiFootball from "../sources/apiFootball.js";
import { normalizeFixture } from "../adapters/apiFootballAdapter.js";

const BRACKET_CACHE_TTL_SECONDS = 900; // 15분

// 경기(matchday/round)별로 묶어서 라운드가 빠른 순(가장 이른 킥오프 기준)으로 정렬 -> 토너먼트 트리 컬럼 순서.
export async function handleLeagueBracket(request, env, code) {
  const comp = findCompetition(code);
  if (!comp || !comp.hasBracket) return json({ detail: "토너먼트 대진표가 없는 대회입니다." }, 404);

  const cacheKey = `bracket:${code}`;
  const cached = await getJSON(env, cacheKey);
  if (cached) return json(cached);

  const raw = await apiFootball.getFixturesBySeason(env, comp.apiFootballLeagueId, comp.apiFootballSeason);
  const matches = (raw.response || []).map(normalizeFixture);

  const roundsMap = new Map();
  matches.forEach((m) => {
    const key = m.matchday || "기타";
    if (!roundsMap.has(key)) roundsMap.set(key, { round: key, earliestDate: m.utcDate, matches: [] });
    const bucket = roundsMap.get(key);
    bucket.matches.push(m);
    if (new Date(m.utcDate) < new Date(bucket.earliestDate)) bucket.earliestDate = m.utcDate;
  });

  const rounds = Array.from(roundsMap.values())
    .sort((a, b) => new Date(a.earliestDate) - new Date(b.earliestDate))
    .map((r) => ({
      round: r.round,
      matches: r.matches.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate)),
    }));

  const result = { rounds };
  await putJSON(env, cacheKey, result, { expirationTtl: BRACKET_CACHE_TTL_SECONDS });
  return json(result);
}
