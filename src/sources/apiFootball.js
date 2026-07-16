import { API_FOOTBALL_BASE } from "../lib/config.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchOnce(env, url) {
  const res = await fetch(url, {
    headers: { "x-apisports-key": env.API_FOOTBALL_KEY || "" },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API-Football ${res.status}: ${body}`);
  }

  const data = await res.json();
  if (data.errors && (Array.isArray(data.errors) ? data.errors.length : Object.keys(data.errors).length)) {
    throw new Error(`API-Football error: ${JSON.stringify(data.errors)}`);
  }
  return data;
}

// 계정 전체 한도(분당 300회)는 여유가 있는데도, 실사용 트래픽(온디맨드 팀/선수 조회)과 크론이
// 겹치는 순간에 종종 레이트리밋에 걸리는 것으로 확인됨 -> 지수 백오프로 재시도한다.
// 단, 대회 14~16개를 순차 조회하는 크론 벌크 작업(retries:1)에서까지 이 백오프를 적용하면
// 레이트리밋이 걸린 순간 재시도가 재시도를 부르며 한 틱 전체가 Cloudflare CPU/실행시간 한도를
// 넘겨 통째로 죽어버린다(2026-07-11 밤 이후 실제로 이 문제로 매치 캐시가 며칠간 안 갱신됐음).
// 그래서 크론 쪽은 retries:1(재시도 없음, 실패하면 그 대회만 기존 캐시로 폴백)로 호출한다.
async function request(env, path, params, { retries = 3 } = {}) {
  const url = new URL(`${API_FOOTBALL_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    }
  }

  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fetchOnce(env, url);
    } catch (err) {
      lastErr = err;
      if (!/rateLimit/.test(err.message) || attempt === retries - 1) throw err;
      await sleep(500 * 2 ** attempt);
    }
  }
  throw lastErr;
}

export function getFixturesByLeague(env, leagueId, season, from, to, opts) {
  return request(env, "/fixtures", { league: leagueId, season, from, to, timezone: "UTC" }, opts);
}

// 토너먼트 대진표(월드컵/컵대회)는 -3~+7일 창을 벗어난 라운드도 다 보여줘야 해서 날짜 제한 없이 전체를 가져온다.
export function getFixturesBySeason(env, leagueId, season) {
  return request(env, "/fixtures", { league: leagueId, season, timezone: "UTC" });
}

export function getFixture(env, fixtureId) {
  return request(env, "/fixtures", { id: fixtureId, timezone: "UTC" });
}

export function getFixtureEvents(env, fixtureId) {
  return request(env, "/fixtures/events", { fixture: fixtureId });
}

export function getFixtureLineups(env, fixtureId) {
  return request(env, "/fixtures/lineups", { fixture: fixtureId });
}

export function getFixturePlayers(env, fixtureId) {
  return request(env, "/fixtures/players", { fixture: fixtureId });
}

export function getFixtureStatistics(env, fixtureId) {
  return request(env, "/fixtures/statistics", { fixture: fixtureId });
}

export function getHeadToHead(env, teamIdA, teamIdB, last = 10) {
  return request(env, "/fixtures/headtohead", { h2h: `${teamIdA}-${teamIdB}`, last });
}

export function getStandings(env, leagueId, season, opts) {
  return request(env, "/standings", { league: leagueId, season }, opts);
}

export function getTopScorers(env, leagueId, season) {
  return request(env, "/players/topscorers", { league: leagueId, season });
}

export function getTopAssists(env, leagueId, season) {
  return request(env, "/players/topassists", { league: leagueId, season });
}

export function getTeam(env, teamId) {
  return request(env, "/teams", { id: teamId });
}

export function getSquad(env, teamId) {
  return request(env, "/players/squads", { team: teamId });
}

export function getCoach(env, teamId) {
  return request(env, "/coachs", { team: teamId });
}

export function getTeamRecentFixtures(env, teamId, count) {
  return request(env, "/fixtures", { team: teamId, last: count });
}

export function getTeamUpcomingFixtures(env, teamId, count) {
  return request(env, "/fixtures", { team: teamId, next: count });
}

export function getPlayerProfile(env, playerId) {
  return request(env, "/players/profiles", { player: playerId });
}

export function getPlayerStats(env, playerId, season) {
  return request(env, "/players", { id: playerId, season });
}

export function getPlayerTransfers(env, playerId) {
  return request(env, "/transfers", { player: playerId });
}

export function getTeamTransfers(env, teamId, opts) {
  return request(env, "/transfers", { team: teamId }, opts);
}

export function getTeamInjuries(env, teamId, season) {
  return request(env, "/injuries", { team: teamId, season });
}

export function getOdds(env, fixtureId) {
  return request(env, "/odds", { fixture: fixtureId });
}
