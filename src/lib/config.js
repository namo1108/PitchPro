export const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";

// api-football.com(api-sports.io) 유료(Pro) 플랜으로 해외 리그 + K리그를 한 소스로 통합.
// apiFootballSeason은 API-Football이 각 리그에 대해 "current"로 표시하는 시즌 연도(리그마다 회계연도가
// 달라 수동 관리 필요 -> 시즌이 바뀌면 이 값을 갱신). emblem은 /leagues?id= 응답의 league.logo.
// transferWindows: 이적시장 크롤링 대상 여부를 정할 "등록 기간"(MM-DD, 며칠 여유를 둔 값 - 국가/연도별로
// 마감일이 며칠씩 흔들려서 정확한 날짜보다 넉넉한 구간이 안전함). 유럽 5대리그+주변국은 FIFA 국제이적
// 기간(6~9월 초, 1월)에 맞춰 통일돼 있고, 한국/일본/브라질/중국처럼 시즌이 달력 연도와 겹치는 리그는
// 시즌 개막 전(겨울)과 시즌 중(여름) 두 창구가 따로 있다. 값이 없으면(예: 대회/컵) 항상 열린 것으로 취급.
const EU_WINDOWS = [
  { start: "01-01", end: "02-07" },
  { start: "06-10", end: "09-08" },
];

// bettable: 스포츠토토(베트맨, betman.co.kr) "축구toto 승무패" 대상으로 알려진 대회만 true.
// AI 분석 탭은 이 값이 true인 대회 경기만 분석 카드를 만들고, 나머지는 링크만 보여준다.
// 베트맨의 실제 취급 종목은 시즌/주차마다 조금씩 바뀔 수 있어 이 목록은 근사치다 -
// 실제 사이트 라인업과 다르면 이 플래그만 바꾸면 된다.
export const COMPETITIONS = [
  { code: "PL", name: "Premier League", emblem: "https://media.api-sports.io/football/leagues/39.png", apiFootballLeagueId: 39, apiFootballSeason: 2026, transferWindows: EU_WINDOWS, bettable: true },
  { code: "PD", name: "La Liga", emblem: "https://media.api-sports.io/football/leagues/140.png", apiFootballLeagueId: 140, apiFootballSeason: 2026, transferWindows: EU_WINDOWS, bettable: true },
  { code: "BL1", name: "Bundesliga", emblem: "https://media.api-sports.io/football/leagues/78.png", apiFootballLeagueId: 78, apiFootballSeason: 2026, transferWindows: EU_WINDOWS, bettable: true },
  { code: "SA", name: "Serie A", emblem: "https://media.api-sports.io/football/leagues/135.png", apiFootballLeagueId: 135, apiFootballSeason: 2026, transferWindows: EU_WINDOWS, bettable: true },
  { code: "FL1", name: "Ligue 1", emblem: "https://media.api-sports.io/football/leagues/61.png", apiFootballLeagueId: 61, apiFootballSeason: 2026, transferWindows: EU_WINDOWS, bettable: true },
  { code: "DED", name: "Eredivisie", emblem: "https://media.api-sports.io/football/leagues/88.png", apiFootballLeagueId: 88, apiFootballSeason: 2026, transferWindows: EU_WINDOWS },
  { code: "PPL", name: "Primeira Liga", emblem: "https://media.api-sports.io/football/leagues/94.png", apiFootballLeagueId: 94, apiFootballSeason: 2026, transferWindows: EU_WINDOWS },
  { code: "ELC", name: "Championship", emblem: "https://media.api-sports.io/football/leagues/40.png", apiFootballLeagueId: 40, apiFootballSeason: 2026, transferWindows: EU_WINDOWS },
  { code: "BSA", name: "Brasileirão", emblem: "https://media.api-sports.io/football/leagues/71.png", apiFootballLeagueId: 71, apiFootballSeason: 2026, transferWindows: [{ start: "01-01", end: "04-03" }, { start: "07-15", end: "09-18" }] },
  { code: "CL", name: "Champions League", emblem: "https://media.api-sports.io/football/leagues/2.png", apiFootballLeagueId: 2, apiFootballSeason: 2026, hasBracket: true, bettable: true },
  { code: "WC", name: "World Cup", emblem: "/img/emblems/worldcup.jpg", apiFootballLeagueId: 1, apiFootballSeason: 2026, hasBracket: true, bettable: true },
  { code: "EC", name: "European Championship", emblem: "https://media.api-sports.io/football/leagues/4.png", apiFootballLeagueId: 4, apiFootballSeason: 2024, hasBracket: true, bettable: true },
  { code: "KL1", name: "K리그1", emblem: "https://media.api-sports.io/football/leagues/292.png", apiFootballLeagueId: 292, apiFootballSeason: 2026, transferWindows: [{ start: "01-01", end: "04-01" }, { start: "07-05", end: "08-25" }], bettable: true },
  { code: "KL2", name: "K리그2", emblem: "https://media.api-sports.io/football/leagues/293.png", apiFootballLeagueId: 293, apiFootballSeason: 2026, transferWindows: [{ start: "01-01", end: "04-01" }, { start: "07-05", end: "08-25" }], bettable: true },
  { code: "KFA", name: "코리아컵", emblem: "https://media.api-sports.io/football/leagues/294.png", apiFootballLeagueId: 294, apiFootballSeason: 2026, hasBracket: true },
  // K3/K4는 API-Football 커버리지가 순위/경기 일정 위주라 스쿼드·라인업·통계는 비어 보일 수 있음(정상 동작).
  // 등록 기간은 K리그1/2와 동일한 KFA 규정을 따른다.
  { code: "K3", name: "K3리그", emblem: "/img/emblems/k3리그.png", apiFootballLeagueId: 295, apiFootballSeason: 2026, transferWindows: [{ start: "01-01", end: "04-01" }, { start: "07-05", end: "08-25" }] },
  { code: "K4", name: "K4리그", emblem: "/img/emblems/k4리그.png", apiFootballLeagueId: 1234, apiFootballSeason: 2026, transferWindows: [{ start: "01-01", end: "04-01" }, { start: "07-05", end: "08-25" }] },
  { code: "J1", name: "J1리그", emblem: "https://media.api-sports.io/football/leagues/98.png", apiFootballLeagueId: 98, apiFootballSeason: 2027, transferWindows: [{ start: "01-01", end: "03-01" }, { start: "07-01", end: "08-10" }] },
  { code: "J2", name: "J2리그", emblem: "https://media.api-sports.io/football/leagues/99.png", apiFootballLeagueId: 99, apiFootballSeason: 2025, transferWindows: [{ start: "01-01", end: "03-01" }, { start: "07-01", end: "08-10" }] },
  { code: "J3", name: "J3리그", emblem: "https://media.api-sports.io/football/leagues/100.png", apiFootballLeagueId: 100, apiFootballSeason: 2026, transferWindows: [{ start: "01-01", end: "03-01" }, { start: "07-01", end: "08-10" }] },
  { code: "MLS", name: "MLS", emblem: "https://media.api-sports.io/football/leagues/253.png", apiFootballLeagueId: 253, apiFootballSeason: 2026, transferWindows: [{ start: "01-20", end: "04-02" }, { start: "07-06", end: "09-09" }] },
  { code: "NOR", name: "노르웨이 1부", emblem: "https://media.api-sports.io/football/leagues/103.png", apiFootballLeagueId: 103, apiFootballSeason: 2026, transferWindows: [{ start: "01-01", end: "04-15" }, { start: "07-01", end: "08-10" }] },
  { code: "DEN", name: "덴마크 1부", emblem: "https://media.api-sports.io/football/leagues/119.png", apiFootballLeagueId: 119, apiFootballSeason: 2026, transferWindows: EU_WINDOWS },
  { code: "SCO", name: "스코틀랜드 1부", emblem: "https://media.api-sports.io/football/leagues/179.png", apiFootballLeagueId: 179, apiFootballSeason: 2026, transferWindows: EU_WINDOWS },
  // 친선경기는 순위표/득점왕 개념이 없어 리그 탭에는 노출하지 않는다(경기 목록에는 그대로 나온다).
  { code: "FRIENDLY", name: "클럽 친선경기", emblem: "https://media.api-sports.io/football/leagues/667.png", apiFootballLeagueId: 667, apiFootballSeason: 2026, hideFromLeagueTab: true },
  // 호주는 남반구라 시즌(10월~5월)에 맞춰 시즌 개막 전(8~11월)/중반(1월) 두 창구를 쓴다.
  { code: "AUS", name: "호주 1부(A-League)", emblem: "https://media.api-sports.io/football/leagues/188.png", apiFootballLeagueId: 188, apiFootballSeason: 2025, transferWindows: [{ start: "01-01", end: "01-31" }, { start: "08-01", end: "11-15" }] },
  // 사우디는 최근 몇 시즌 유럽보다 살짝 더 늦게까지 등록을 받아줘서 마감을 여유 있게 잡는다.
  { code: "KSA", name: "사우디 1부", emblem: "https://media.api-sports.io/football/leagues/307.png", apiFootballLeagueId: 307, apiFootballSeason: 2025, transferWindows: [{ start: "01-01", end: "02-10" }, { start: "06-01", end: "09-15" }] },
  { code: "CHN", name: "중국 슈퍼리그", emblem: "https://media.api-sports.io/football/leagues/169.png", apiFootballLeagueId: 169, apiFootballSeason: 2026, transferWindows: [{ start: "01-01", end: "03-05" }, { start: "06-20", end: "08-10" }] },
];

export function findCompetition(code) {
  return COMPETITIONS.find((c) => c.code === code);
}

export function findCompetitionByLeagueId(leagueId) {
  return COMPETITIONS.find((c) => String(c.apiFootballLeagueId) === String(leagueId));
}

// 캐시로 미리 채워두는 경기 목록의 날짜 범위(오늘 기준 -DAYS_BEFORE ~ +DAYS_AFTER).
// 이 범위 밖의 날짜를 요청하면 목록은 빈 배열로 온다(개인용 트래픽 규모에서는 충분).
export const MATCH_WINDOW_DAYS_BEFORE = 3;
export const MATCH_WINDOW_DAYS_AFTER = 7;

export const KV_KEYS = {
  matches: "matches:apifootball:v1",
  standings: "standings:apifootball:v1",
  news: "news:v1",
  transferMarket: "transfers:market:v1",
  pushSubscriptionsIndex: "push:subs:index",
  pushSubscriptionPrefix: "push:sub:",
  pushUsernameIndexPrefix: "push:byusername:",
  prevScores: "scores:prev:v1",
  lastRunPrefix: "lastrun:",
  detailPrefix: "detail:",
  // 로그인/집관인증/레벨/친구/명예의 전당(선택 기능) 관련 저장소.
  userPrefix: "user:",
  nicknameIndexPrefix: "nickname:",
  sessionPrefix: "session:",
  checkinPrefix: "checkin:",
  leaderboardCache: "leaderboard:v1",
};

export const DETAIL_CACHE_TTL_SECONDS = 300;

export const REFRESH_INTERVALS_MS = {
  news: 20 * 60 * 1000,
  transfers: 20 * 60 * 60 * 1000,
  // 전체 대상 팀(400여 개)을 너무 오래 걸리지 않게 한 바퀴 다 돌리기 위한 순환 주기.
  transferMarketTick: 5 * 60 * 1000,
};

// 집관인증(선택 기능): 킥오프 -30분 ~ +30분 사이에만 인증 가능.
// 인증하는 시점엔 경기가 막 시작하거나 시작 전이라 승패를 알 수 없으므로, 우선 참여 포인트(5점)만 주고
// 경기가 끝나면(resolveCheckinOutcomes) 승리(10점)/무승부(5점 유지)/패배(-5점)로 최종 정산한다.
export const CHECKIN_WINDOW_MINUTES_BEFORE = 30;
export const CHECKIN_WINDOW_MINUTES_AFTER = 30;
export const POINTS_CHECKIN_BASE = 5;
export const POINTS_CHECKIN_WIN = 10;
export const POINTS_CHECKIN_LOSS = -5;
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const LEADERBOARD_CACHE_TTL_SECONDS = 300;
export const LEADERBOARD_SIZE = 100;

// 여기 적은 아이디(소문자)는 포인트와 상관없이 레벨 99 "나 개발자(Goat)"로 고정 표시된다(운영자 이스터에그).
export const GOAT_USERNAMES = ["bongmars"];

function monthDayNumber(date) {
  return (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

function parseMonthDay(md) {
  const [m, d] = md.split("-").map(Number);
  return m * 100 + d;
}

// 오늘이 그 리그의 이적 등록 기간(transferWindows) 안에 드는지. 정보가 없는 대회는 안전하게
// "항상 열림"으로 취급한다(누락돼서 영영 안 긁히는 것보다는 낫다).
export function isInTransferWindow(comp, now = new Date()) {
  if (!comp.transferWindows?.length) return true;
  const today = monthDayNumber(now);
  return comp.transferWindows.some(({ start, end }) => {
    const s = parseMonthDay(start);
    const e = parseMonthDay(end);
    return s <= e ? today >= s && today <= e : today >= s || today <= e; // 혹시 연말연시를 걸치는 구간 대비
  });
}

// 이적시장 탭에서 팀 목록을 뽑아올 대상 리그. 대륙컵/월드컵/컵대회(hasBracket)는 팀 구성이
// 시즌마다 바뀌고 그 팀들은 이미 자국 리그 쪽에서 커버되므로 제외하고, 친선경기(FRIENDLY)도 제외한다.
// onlyOpenWindow=true면 지금 이적 등록 기간이 아닌 리그도 걸러낸다 - 어차피 등록 기간이 아니면 새 이적이
// 안 생기니, 그런 리그까지 매번 순환 조회하는 건 낭비다(크론에서 크롤링 대상을 추릴 때 사용).
export function transferMarketCompetitions({ onlyOpenWindow = false } = {}) {
  return COMPETITIONS.filter((c) => !c.hasBracket && c.code !== "FRIENDLY" && (!onlyOpenWindow || isInTransferWindow(c)));
}
