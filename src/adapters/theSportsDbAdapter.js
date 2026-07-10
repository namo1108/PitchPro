const STATUS_MAP = {
  NS: "SCHEDULED",
  "1H": "IN_PLAY",
  "2H": "IN_PLAY",
  ET: "IN_PLAY",
  HT: "PAUSED",
  FT: "FINISHED",
  AET: "FINISHED",
  PEN: "FINISHED",
  AWARDED: "FINISHED",
  CANC: "CANCELLED",
  CANCELLED: "CANCELLED",
  ABANDONED: "CANCELLED",
  SUSP: "SUSPENDED",
  SUSPENDED: "SUSPENDED",
  PST: "POSTPONED",
  POSTPONED: "POSTPONED",
};

// strStatus 값이 알려지지 않은 형태면(문서화되지 않은 라이브 상태 문자열 등), 스코어 유무로 추정한다.
function mapStatus(raw) {
  if (raw.strPostponed === "yes") return "POSTPONED";
  const known = STATUS_MAP[(raw.strStatus || "").toUpperCase()];
  if (known) return known;
  const hasScore = raw.intHomeScore !== null && raw.intHomeScore !== undefined && raw.intHomeScore !== "";
  return hasScore ? "FINISHED" : "SCHEDULED";
}

function toInt(value) {
  return value === null || value === undefined || value === "" ? null : Number(value);
}

// TheSportsDB의 strTimestamp/dateEvent+strTime은 UTC 값이지만 Z 접미사가 없어 그대로 두면
// new Date()가 로컬 시간으로 잘못 해석한다 -> 명시적으로 Z를 붙여준다.
function toUtcDate(raw) {
  if (raw.strTimestamp) return `${raw.strTimestamp}Z`;
  return `${raw.dateEvent}T${raw.strTime}Z`;
}

export function normalizeEvent(raw, competitionMeta) {
  return {
    id: `kl:${raw.idEvent}`,
    utcDate: toUtcDate(raw),
    status: mapStatus(raw),
    matchday: raw.intRound ?? null,
    competition: { code: competitionMeta.code, name: competitionMeta.name },
    homeTeam: { id: raw.idHomeTeam, name: raw.strHomeTeam, shortName: raw.strHomeTeam, crest: raw.strHomeTeamBadge },
    awayTeam: { id: raw.idAwayTeam, name: raw.strAwayTeam, shortName: raw.strAwayTeam, crest: raw.strAwayTeamBadge },
    score: {
      fullTime: { home: toInt(raw.intHomeScore), away: toInt(raw.intAwayScore) },
      halfTime: { home: null, away: null },
    },
    venue: raw.strVenue || null,
    referees: [],
  };
}

export function normalizeStandings(raw) {
  const rows = raw.table || [];
  return {
    standings: [
      {
        type: "TOTAL",
        table: rows.map((row) => ({
          position: toInt(row.intRank),
          team: {
            id: row.idTeam,
            name: row.strTeam,
            shortName: row.strTeam,
            crest: (row.strBadge || "").replace(/\/tiny$/, ""),
          },
          playedGames: toInt(row.intPlayed),
          won: toInt(row.intWin),
          draw: toInt(row.intDraw),
          lost: toInt(row.intLoss),
          points: toInt(row.intPoints),
          goalDifference: toInt(row.intGoalDifference),
        })),
      },
    ],
  };
}
