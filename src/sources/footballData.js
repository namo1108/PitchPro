import { FOOTBALL_DATA_BASE } from "../lib/config.js";

async function request(env, path, params) {
  const url = new URL(`${FOOTBALL_DATA_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url, {
    headers: { "X-Auth-Token": env.FOOTBALL_DATA_API_KEY || "" },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`football-data.org ${res.status}: ${body}`);
  }

  return res.json();
}

export function getMatches(env, dateFrom, dateTo, competitions) {
  return request(env, "/matches", { dateFrom, dateTo, competitions });
}

export function getMatch(env, matchId) {
  return request(env, `/matches/${matchId}`);
}

export function getStandings(env, competitionCode) {
  return request(env, `/competitions/${competitionCode}/standings`);
}
