import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import * as footballData from "../sources/footballData.js";
import { normalizeMatch } from "../adapters/footballDataAdapter.js";

function involvesBothTeams(match, teamA, teamB) {
  const ids = [match.homeTeam.id, match.awayTeam.id];
  return ids.includes(teamA) && ids.includes(teamB);
}

// football-data.org 무료 티어는 head2head의 실제 경기 목록(matches)은 안 주고
// 집계(aggregates: 맞대결 횟수/총득점/승무패)만 준다(실제 호출로 확인) -> matches는 비어있을 수 있음.
async function footballDataHeadToHead(env, teamA, teamB) {
  const cached = await getJSON(env, KV_KEYS.matchesFootballData);
  const anyMatch = (cached?.matches || []).find((m) => involvesBothTeams(m, teamA, teamB));
  if (!anyMatch) return { matches: [], aggregates: null, limited: true };

  const rawMatchId = anyMatch.id.split(":")[1];
  const raw = await footballData.getHeadToHead(env, rawMatchId, 10);
  return {
    matches: (raw.matches || []).map(normalizeMatch),
    aggregates: raw.aggregates || null,
    limited: false,
  };
}

// K리그는 전용 head2head 엔드포인트가 무료 티어에 없어, 이미 캐시된 경기 목록에서
// 두 팀이 모두 등장하는 경기만 필터한다 -> 캐시 윈도우 내 맞대결로 범위가 제한됨(limited: true).
async function kLeagueHeadToHead(env, teamA, teamB) {
  const cached = await getJSON(env, KV_KEYS.matchesKLeague);
  const matches = (cached?.matches || []).filter((m) => involvesBothTeams(m, teamA, teamB));
  return { matches, aggregates: null, limited: true };
}

export async function handleHeadToHead(request, env, url) {
  const teamA = url.searchParams.get("a");
  const teamB = url.searchParams.get("b");
  if (!teamA || !teamB) return json({ detail: "a, b 팀 id가 필요합니다." }, 400);

  const cacheKey = `h2h:${[teamA, teamB].sort().join("_")}`;
  const cached = await getJSON(env, cacheKey);
  if (cached) return json(cached);

  const sourceA = teamA.split(":")[0];
  const sourceB = teamB.split(":")[0];

  let result;
  if (sourceA === "fd" && sourceB === "fd") {
    result = await footballDataHeadToHead(env, teamA, teamB);
  } else if (sourceA === "kl" && sourceB === "kl") {
    result = await kLeagueHeadToHead(env, teamA, teamB);
  } else {
    result = { matches: [], aggregates: null, limited: true };
  }

  await putJSON(env, cacheKey, result, { expirationTtl: 600 });
  return json(result);
}
