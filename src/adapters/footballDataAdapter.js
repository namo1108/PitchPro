// football-data.org 응답은 app.js가 기대하는 형태와 거의 동일 -> 필요한 필드만 추려서
// KV 블롭 크기를 줄이고, id에 소스 접두사를 붙여 API-Football의 id와 충돌하지 않게 한다.
export function normalizeMatch(raw) {
  return {
    id: `fd:${raw.id}`,
    utcDate: raw.utcDate,
    status: raw.status,
    matchday: raw.matchday,
    competition: { code: raw.competition.code, name: raw.competition.name },
    homeTeam: pickTeam(raw.homeTeam),
    awayTeam: pickTeam(raw.awayTeam),
    score: raw.score,
    venue: raw.venue ?? null,
    referees: raw.referees ?? [],
  };
}

function pickTeam(team) {
  return { id: team.id, name: team.name, shortName: team.shortName, crest: team.crest };
}

export function normalizeStandings(raw) {
  return {
    standings: (raw.standings || []).map((table) => ({
      type: table.type,
      table: table.table.map((row) => ({
        position: row.position,
        team: pickTeam(row.team),
        playedGames: row.playedGames,
        won: row.won,
        draw: row.draw,
        lost: row.lost,
        points: row.points,
        goalDifference: row.goalDifference,
      })),
    })),
  };
}
