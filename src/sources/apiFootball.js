import { API_FOOTBALL_BASE } from "../lib/config.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 분당 한도 진단용(2026-09-20) - 코드를 아무리 손봐도(순간 버스트 방지 등) 레이트리밋이 안 풀려서,
// API-Football이 매 응답에 실어주는 실제 남은 분당/일일 한도 헤더를 직접 찍어본다. 남은 분당 한도가
// 얼마 안 남았을 때만(50 미만) 로그를 남겨서 평소엔 로그가 너무 많아지지 않게 한다. 헤더 이름은
// API-Football 문서 기준(대소문자는 Headers.get()이 알아서 구분 안 함) - requests-limit/remaining은
// 일일 한도, limit/remaining(접두사 없음)은 분당 한도.
function logRateLimitHeaders(res, url) {
  const minuteRemaining = res.headers.get("x-ratelimit-remaining");
  const minuteLimit = res.headers.get("x-ratelimit-limit");
  if (minuteRemaining !== null && Number(minuteRemaining) < 50) {
    console.warn(`API-Football 분당 한도 얼마 안 남음: remaining=${minuteRemaining}/${minuteLimit} url=${url.pathname}${url.search}`);
  }
  return { minuteRemaining, minuteLimit };
}

// 이제 API-Football을 직접 호출하지 않고 고정 IP 릴레이 서버(VPS)를 거친다 - 실제 API-Football
// 키는 그 서버에만 있고(env.API_FOOTBALL_KEY는 더 이상 안 씀), 여기서는 그 서버 자체에 대한
// 인증용 비밀값만 보낸다(2026-09-20, config.js의 API_FOOTBALL_BASE 주석 참고).
async function fetchOnce(env, url) {
  const res = await fetch(url, {
    headers: { "x-proxy-secret": env.PROXY_SECRET || "" },
  });
  const { minuteRemaining, minuteLimit } = logRateLimitHeaders(res, url);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API-Football ${res.status}: ${body} [분당한도 remaining=${minuteRemaining}/${minuteLimit}]`);
  }

  const data = await res.json();
  if (data.errors && (Array.isArray(data.errors) ? data.errors.length : Object.keys(data.errors).length)) {
    throw new Error(`API-Football error: ${JSON.stringify(data.errors)} [분당한도 remaining=${minuteRemaining}/${minuteLimit}]`);
  }
  return data;
}

// 계정 전체 한도(메가플랜, 분당 900회)는 여유가 있는데도, 실사용 트래픽(온디맨드 팀/선수 조회)과 크론이
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

// Pro 플랜 일일 한도(7500) 대비 지금까지 쓴 호출 수를 알려준다 - 이 호출 자체도 1회를 쓰지만,
// 무거운 벌크 작업(이적시장 순환 조회) 앞에서만 확인하므로 하루 몇백 회 수준으로 무시할 만하다.
// 2026-07-21에 이적시장 순환 조회가 하루치 한도를 다 써버려 경기/골 갱신까지 멈춘 사고가 있었고,
// 그 사고를 막으려고 도입한 서킷브레이커(src/scheduled/refreshTransferMarket.js)가 이 함수를 쓴다.
export async function getApiUsage(env) {
  const data = await request(env, "/status", {}, { retries: 1 });
  const requests = data.response?.requests;
  if (!requests) return null;
  return { current: requests.current, limit: requests.limit_day };
}

export function getFixturesByLeague(env, leagueId, season, from, to, opts) {
  return request(env, "/fixtures", { league: leagueId, season, from, to, timezone: "UTC" }, opts);
}

// 전세계에서 지금 진행 중인 경기를 리그 구분 없이 한 번의 호출로 전부 받는다(대회별로 28번 나눠
// 부르는 getFixturesByLeague보다 훨씬 가벼움) - 골 알림 지연을 줄이려고 크론 tick 안에서 짧은 간격으로
// 반복 조회할 때 이걸 쓴다(src/scheduled/pollLiveMatches.js).
export function getLiveFixtures(env, opts) {
  return request(env, "/fixtures", { live: "all", timezone: "UTC" }, opts);
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
  return request(env, "/fixtures/headtohead", { h2h: `${teamIdA}-${teamIdB}`, last, timezone: "UTC" });
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

// 국가대표팀 목록 캐시용 - 리그(대회) 하나의 시즌에 참가한 팀 전체를 한 번의 호출로 받아온다.
// league=10(Friendlies)로 부르면 그 시즌에 친선경기를 치른 전 세계 대표팀이 거의 다 걸린다.
export function getTeamsByLeague(env, leagueId, season, opts) {
  return request(env, "/teams", { league: leagueId, season }, opts);
}

export function getSquad(env, teamId) {
  return request(env, "/players/squads", { team: teamId });
}

export function getCoach(env, teamId) {
  return request(env, "/coachs", { team: teamId });
}

export function getTeamRecentFixtures(env, teamId, count) {
  return request(env, "/fixtures", { team: teamId, last: count, timezone: "UTC" });
}

export function getTeamUpcomingFixtures(env, teamId, count) {
  return request(env, "/fixtures", { team: teamId, next: count, timezone: "UTC" });
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
