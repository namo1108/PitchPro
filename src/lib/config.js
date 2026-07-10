export const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";

// 공개 테스트 키("3")는 회원가입 없이 무료로 쓸 수 있음(분당 30회 한도).
// 실제 운영에서는 https://www.thesportsdb.com/free_sports_api 에서 본인 키를 발급받아
// THESPORTSDB_API_KEY 시크릿으로 넣는 걸 권장(전 세계가 공유하는 테스트 키 부하를 줄이기 위함).
export const THESPORTSDB_DEFAULT_KEY = "3";
export const THESPORTSDB_BASE_PATH = "/api/v1/json";
export const THESPORTSDB_HOST = "https://www.thesportsdb.com";

// football-data.org 무료 티어(Tier One)에서 접근 가능한 주요 대회
export const FOOTBALL_DATA_COMPETITIONS = [
  { code: "PL", name: "Premier League", emblem: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", source: "footballdata" },
  { code: "PD", name: "La Liga", emblem: "🇪🇸", source: "footballdata" },
  { code: "BL1", name: "Bundesliga", emblem: "🇩🇪", source: "footballdata" },
  { code: "SA", name: "Serie A", emblem: "🇮🇹", source: "footballdata" },
  { code: "FL1", name: "Ligue 1", emblem: "🇫🇷", source: "footballdata" },
  { code: "DED", name: "Eredivisie", emblem: "🇳🇱", source: "footballdata" },
  { code: "PPL", name: "Primeira Liga", emblem: "🇵🇹", source: "footballdata" },
  { code: "ELC", name: "Championship", emblem: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", source: "footballdata" },
  { code: "BSA", name: "Brasileirão", emblem: "🇧🇷", source: "footballdata" },
  { code: "CL", name: "Champions League", emblem: "⭐", source: "footballdata" },
  { code: "WC", name: "World Cup", emblem: "🌍", source: "footballdata" },
  { code: "EC", name: "European Championship", emblem: "🏆", source: "footballdata" },
];

// TheSportsDB의 idLeague (search_all_leagues.php?c=South Korea 로 확인).
export const K_LEAGUE_COMPETITIONS = [
  { code: "KL1", name: "K리그1", emblem: "🇰🇷", source: "thesportsdb", theSportsDbLeagueId: 4689 },
  { code: "KL2", name: "K리그2", emblem: "🇰🇷", source: "thesportsdb", theSportsDbLeagueId: 4822 },
];

export const ALL_COMPETITIONS = [...FOOTBALL_DATA_COMPETITIONS, ...K_LEAGUE_COMPETITIONS];

export const FOOTBALL_DATA_COMPETITION_CODES = FOOTBALL_DATA_COMPETITIONS.map((c) => c.code).join(",");

export function findCompetition(code) {
  return ALL_COMPETITIONS.find((c) => c.code === code);
}

// K리그 시즌은 매년 2~3월에 시작 -> 시즌이 바뀌면 이 값을 수동으로 갱신해야 함.
export const K_LEAGUE_SEASON = 2026;

// 캐시로 미리 채워두는 경기 목록의 날짜 범위(오늘 기준 -DAYS_BEFORE ~ +DAYS_AFTER).
// 이 범위 밖의 날짜를 요청하면 목록은 빈 배열로 온다(개인용 트래픽 규모에서는 충분).
export const MATCH_WINDOW_DAYS_BEFORE = 3;
export const MATCH_WINDOW_DAYS_AFTER = 7;

export const KV_KEYS = {
  matchesFootballData: "matches:footballdata:v1",
  standingsFootballData: "standings:footballdata:v1",
  matchesKLeague: "matches:kleague:v1",
  standingsKLeague: "standings:kleague:v1",
  standingsFootballDataCursor: "cursor:footballdata-standings",
  lastRunPrefix: "lastrun:",
  detailPrefix: "detail:",
};

export const DETAIL_CACHE_TTL_SECONDS = 300;

// 공유 테스트 키에 부담을 주지 않으려고 football-data.org와 비슷한 주기로 유지.
export const REFRESH_INTERVALS_MS = {
  kLeagueMatches: 15 * 60 * 1000,
  kLeagueStandings: 60 * 60 * 1000,
};
