import { THESPORTSDB_HOST, THESPORTSDB_BASE_PATH, THESPORTSDB_DEFAULT_KEY } from "../lib/config.js";

async function request(env, path, params) {
  const apiKey = env.THESPORTSDB_API_KEY || THESPORTSDB_DEFAULT_KEY;
  const url = new URL(`${THESPORTSDB_HOST}${THESPORTSDB_BASE_PATH}/${apiKey}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TheSportsDB ${res.status}: ${body}`);
  }
  return res.json();
}

// eventsseason.php는 공유 무료 키에서 시즌 1라운드만 돌려주는 것으로 확인됨(전체 시즌 아님) ->
// 대신 다음/이전 경기로 "현재 라운드"를 알아낸 뒤 eventsround.php로 라운드 단위로 가져온다.
export function getNextEvents(env, leagueId) {
  return request(env, "/eventsnextleague.php", { id: leagueId });
}

export function getPastEvents(env, leagueId) {
  return request(env, "/eventspastleague.php", { id: leagueId });
}

export function getEventsByRound(env, leagueId, round, season) {
  return request(env, "/eventsround.php", { id: leagueId, r: round, s: season });
}

export function getEvent(env, eventId) {
  return request(env, "/lookupevent.php", { id: eventId });
}

export function getStandings(env, leagueId, season) {
  return request(env, "/lookuptable.php", { l: leagueId, s: season });
}
