import { json } from "../lib/http.js";
import { getJSON } from "../lib/kv.js";
import { KV_KEYS, K_LEAGUE_COMPETITIONS } from "../lib/config.js";
import { buildMatchAnalysis } from "../lib/analysis.js";

const K_LEAGUE_CODES = new Set(K_LEAGUE_COMPETITIONS.map((c) => c.code));

function recentFormFor(allMatches, teamId, beforeDate) {
  return allMatches
    .filter((m) => m.status === "FINISHED" && new Date(m.utcDate) < beforeDate)
    .filter((m) => m.homeTeam.id === teamId || m.awayTeam.id === teamId)
    .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
    .slice(0, 5);
}

export async function handleAnalysis(request, env) {
  const [fdMatches, klMatches, fdStandings, klStandings] = await Promise.all([
    getJSON(env, KV_KEYS.matchesFootballData),
    getJSON(env, KV_KEYS.matchesKLeague),
    getJSON(env, KV_KEYS.standingsFootballData),
    getJSON(env, KV_KEYS.standingsKLeague),
  ]);

  const allFd = fdMatches?.matches || [];
  const allKl = klMatches?.matches || [];
  const all = [...allFd, ...allKl];

  const now = new Date();
  const horizon = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  const upcoming = all
    .filter((m) => ["SCHEDULED", "TIMED"].includes(m.status))
    .filter((m) => new Date(m.utcDate) <= horizon)
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
    .slice(0, 20);

  const cards = upcoming.map((match) => {
    const isKLeague = K_LEAGUE_CODES.has(match.competition.code);
    const pool = isKLeague ? allKl : allFd;
    const matchDate = new Date(match.utcDate);

    const teamRecents = {
      [match.homeTeam.id]: recentFormFor(pool, match.homeTeam.id, matchDate),
      [match.awayTeam.id]: recentFormFor(pool, match.awayTeam.id, matchDate),
    };

    const standingsBlob = isKLeague ? klStandings : fdStandings;
    const standingsTable = standingsBlob?.byCode?.[match.competition.code]?.standings?.find((s) => s.type === "TOTAL");

    return buildMatchAnalysis(match, teamRecents, standingsTable);
  });

  return json({ analysis: cards });
}
