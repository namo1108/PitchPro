import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import { findCompetition } from "../lib/config.js";
import * as apiFootball from "../sources/apiFootball.js";
import { normalizeFixture } from "../adapters/apiFootballAdapter.js";

// 15분 -> 5분으로 줄임(사용자 제보: 대진표가 바로바로 안 바뀐다) - scheduled/refreshBrackets.js가
// 그 경기가 실제로 진행 중일 때만 이 캐시를 앞서 채워두므로, 라이브 중인 대진표는 사실상 그보다도
// 더 자주(1분 크론 주기로) 갱신된다. 이 TTL은 아무도 미리 안 채워준 조회(첫 방문 등)의 상한선일 뿐이다.
const BRACKET_CACHE_TTL_SECONDS = 300; // 5분

export function bracketCacheKey(code) {
  return `bracket:${code}`;
}

// 경기(matchday/round)별로 묶어서 라운드가 빠른 순(가장 이른 킥오프 기준)으로 정렬 -> 토너먼트 트리 컬럼 순서.
export async function buildBracket(env, comp) {
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
  await putJSON(env, bracketCacheKey(comp.code), result, { expirationTtl: BRACKET_CACHE_TTL_SECONDS });
  return result;
}

export async function handleLeagueBracket(request, env, code) {
  const comp = findCompetition(code);
  if (!comp || !comp.hasBracket) return json({ detail: "토너먼트 대진표가 없는 대회입니다." }, 404);

  const cached = await getJSON(env, bracketCacheKey(code));
  if (cached) return json(cached);

  const result = await buildBracket(env, comp);
  return json(result);
}
