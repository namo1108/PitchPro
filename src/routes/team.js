import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import { K_LEAGUE_COMPETITIONS } from "../lib/config.js";
import * as footballData from "../sources/footballData.js";
import * as theSportsDb from "../sources/theSportsDb.js";
import { normalizeMatch } from "../adapters/footballDataAdapter.js";
import { normalizeEvent } from "../adapters/theSportsDbAdapter.js";
import { normalizePlayer, normalizeTeamInfoFD, normalizeTeamInfoTSDB } from "../adapters/teamAdapter.js";

const TEAM_CACHE_TTL_SECONDS = 600;

function competitionMetaFor(leagueId) {
  const comp = K_LEAGUE_COMPETITIONS.find((c) => String(c.theSportsDbLeagueId) === String(leagueId));
  return comp || { code: "KL", name: "K리그" };
}

async function buildFootballDataTeam(env, rawId) {
  const [teamInfo, finished, scheduled] = await Promise.all([
    footballData.getTeam(env, rawId),
    footballData.getTeamMatches(env, rawId, "FINISHED", 5),
    footballData.getTeamMatches(env, rawId, "SCHEDULED", 5),
  ]);

  let squad = [];
  try {
    // "Arsenal FC" 같은 정식명으로 검색하면 TheSportsDB의 느슨한 매칭이 엉뚱한 팀을 주는 경우가
    // 있어(예: "Arsenal FC" -> 루마니아 구단), shortName으로 검색 후 정확히 일치하는 항목을 우선한다.
    const searchName = teamInfo.shortName || teamInfo.name;
    const found = await theSportsDb.searchTeam(env, searchName);
    const teams = found.teams || [];
    const exact = teams.find((t) => (t.strTeam || "").toLowerCase() === searchName.toLowerCase());
    const match = exact || teams[0];
    if (match) {
      const players = await theSportsDb.getSquad(env, match.idTeam);
      squad = (players.player || []).map(normalizePlayer);
    }
  } catch (err) {
    console.error("squad lookup failed:", err);
  }

  return {
    team: normalizeTeamInfoFD(teamInfo),
    recentMatches: (finished.matches || []).map(normalizeMatch).reverse(),
    upcomingMatches: (scheduled.matches || []).map(normalizeMatch),
    squad,
  };
}

async function buildKLeagueTeam(env, rawId) {
  const [teamInfo, next, last, players] = await Promise.all([
    theSportsDb.lookupTeam(env, rawId),
    theSportsDb.getTeamNextEvents(env, rawId),
    theSportsDb.getTeamLastEvents(env, rawId),
    theSportsDb.getSquad(env, rawId),
  ]);

  const info = teamInfo.teams?.[0];

  const normalizeWithComp = (event) => normalizeEvent(event, competitionMetaFor(event.idLeague));

  return {
    team: info ? normalizeTeamInfoTSDB(info) : { id: `kl:${rawId}`, name: "K리그 팀", crest: null, venue: null },
    recentMatches: (last.results || []).map(normalizeWithComp),
    upcomingMatches: (next.events || []).map(normalizeWithComp),
    squad: (players.player || []).map(normalizePlayer),
  };
}

export async function handleTeamDetail(request, env, id) {
  const cacheKey = `team:${id}`;
  const cached = await getJSON(env, cacheKey);
  if (cached) return json(cached);

  const [source, rawId] = id.split(":");

  let result;
  if (source === "fd") {
    result = await buildFootballDataTeam(env, rawId);
  } else if (source === "kl") {
    result = await buildKLeagueTeam(env, rawId);
  } else {
    return json({ detail: "알 수 없는 팀 id" }, 404);
  }

  await putJSON(env, cacheKey, result, { expirationTtl: TEAM_CACHE_TTL_SECONDS });
  return json(result);
}
