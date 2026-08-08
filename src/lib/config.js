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

// featured: 유럽 5대리그 + 주요 대륙대회 + K리그 등 사용자 관심이 높은 주요 대회만 true.
// AI 분석 탭은 이 값이 true인 대회 경기만 분석 카드를 만들고(팀당 API 호출 비용이 커서 전체
// 대회를 다 만들 수 없음), 나머지는 링크만 보여준다.
export const COMPETITIONS = [
  { code: "PL", name: "Premier League", emblem: "https://media.api-sports.io/football/leagues/39.png", apiFootballLeagueId: 39, apiFootballSeason: 2026, transferWindows: EU_WINDOWS, featured: true },
  { code: "PD", name: "La Liga", emblem: "https://media.api-sports.io/football/leagues/140.png", apiFootballLeagueId: 140, apiFootballSeason: 2026, transferWindows: EU_WINDOWS, featured: true },
  { code: "BL1", name: "Bundesliga", emblem: "https://media.api-sports.io/football/leagues/78.png", apiFootballLeagueId: 78, apiFootballSeason: 2026, transferWindows: EU_WINDOWS, featured: true },
  { code: "SA", name: "Serie A", emblem: "https://media.api-sports.io/football/leagues/135.png", apiFootballLeagueId: 135, apiFootballSeason: 2026, transferWindows: EU_WINDOWS, featured: true },
  { code: "FL1", name: "Ligue 1", emblem: "https://media.api-sports.io/football/leagues/61.png", apiFootballLeagueId: 61, apiFootballSeason: 2026, transferWindows: EU_WINDOWS, featured: true },
  { code: "DED", name: "Eredivisie", emblem: "https://media.api-sports.io/football/leagues/88.png", apiFootballLeagueId: 88, apiFootballSeason: 2026, transferWindows: EU_WINDOWS },
  { code: "PPL", name: "Primeira Liga", emblem: "https://media.api-sports.io/football/leagues/94.png", apiFootballLeagueId: 94, apiFootballSeason: 2026, transferWindows: EU_WINDOWS },
  { code: "ELC", name: "Championship", emblem: "https://media.api-sports.io/football/leagues/40.png", apiFootballLeagueId: 40, apiFootballSeason: 2026, transferWindows: EU_WINDOWS },
  { code: "BSA", name: "Brasileirão", emblem: "https://media.api-sports.io/football/leagues/71.png", apiFootballLeagueId: 71, apiFootballSeason: 2026, transferWindows: [{ start: "01-01", end: "04-03" }, { start: "07-15", end: "09-18" }] },
  { code: "CL", name: "Champions League", emblem: "https://media.api-sports.io/football/leagues/2.png", apiFootballLeagueId: 2, apiFootballSeason: 2026, hasBracket: true, featured: true },
  { code: "WC", name: "World Cup", emblem: "/img/emblems/worldcup.jpg", apiFootballLeagueId: 1, apiFootballSeason: 2026, hasBracket: true, featured: true },
  { code: "EC", name: "European Championship", emblem: "https://media.api-sports.io/football/leagues/4.png", apiFootballLeagueId: 4, apiFootballSeason: 2024, hasBracket: true, featured: true },
  { code: "KL1", name: "K리그1", emblem: "https://media.api-sports.io/football/leagues/292.png", apiFootballLeagueId: 292, apiFootballSeason: 2026, transferWindows: [{ start: "01-01", end: "04-01" }, { start: "07-05", end: "08-25" }], featured: true },
  // promotionSpots: K리그2는 1~2위 자동 승격 + 3~6위 승격 플레이오프라 1~6위 전체가 "승격권"이다
  // (사용자 확인, 2026-07). 지정 안 한 다른 리그는 순위표 렌더링 쪽의 기존 근사 규칙(상위 4/하위 3)을 쓴다.
  { code: "KL2", name: "K리그2", emblem: "https://media.api-sports.io/football/leagues/293.png", apiFootballLeagueId: 293, apiFootballSeason: 2026, transferWindows: [{ start: "01-01", end: "04-01" }, { start: "07-05", end: "08-25" }], featured: true, promotionSpots: 6 },
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
  // 국가대표 친선경기(A매치): 클럽 친선경기(667)와 별개로 API-Football은 국가대표 친선경기를 리그
  // id 10 "Friendlies"로 묶어서 제공한다(유소년/여자 대표팀 경기도 섞여 있지만 팀 검색과 마찬가지로
  // 여기선 성인 남자 대표팀 경기 위주로 노출). 친선경기라 순위표/득점왕 개념이 없어 리그 탭엔 안 보여준다.
  { code: "INTFRIENDLY", name: "국가대표 친선경기", emblem: "https://media.api-sports.io/football/leagues/10.png", apiFootballLeagueId: 10, apiFootballSeason: 2026, hideFromLeagueTab: true },
  // 아시안컵: 대한민국 대표팀의 실제 다음 예정 경기(확인일 2026-07-25 기준 2027년 1월)가 이 대회라,
  // 국가대표팀도 집관인증이 되려면(경기 목록 캐시에 있어야 체크인 가능) 여기에 등록해둬야 한다.
  { code: "ACUP", name: "아시안컵", emblem: "https://media.api-sports.io/football/leagues/7.png", apiFootballLeagueId: 7, apiFootballSeason: 2027, hasBracket: true },
];

// 리그별 중계처 바로가기 - 경기별 딥링크는 제공되는 데이터가 없어 대회 단위 대표 링크로 연결한다
// (정확한 편성표/딥링크가 아니라 "어디서 보는지"를 안내하는 용도).
export const BROADCAST_LINKS = {
  KL1: { provider: "쿠팡플레이", url: "https://www.coupangplay.com/sports" },
  KL2: { provider: "쿠팡플레이", url: "https://www.coupangplay.com/sports" },
  PL: { provider: "쿠팡플레이", url: "https://www.coupangplay.com/sports" },
  BL1: { provider: "쿠팡플레이", url: "https://www.coupangplay.com/sports" },
  PD: { provider: "쿠팡플레이", url: "https://www.coupangplay.com/sports" },
  KFA: { provider: "유튜브", url: "https://www.youtube.com/results?search_query=%EC%BD%94%EB%A6%AC%EC%95%84%EC%BB%B5" },
};

const KOREA_CUP_YOUTUBE = { provider: "유튜브", url: "https://www.youtube.com/results?search_query=%EC%BD%94%EB%A6%AC%EC%95%84%EC%BB%B5" };
const KOREA_CUP_COUPANG = { provider: "쿠팡플레이", url: "https://www.coupangplay.com/sports" };

// 코리아컵은 라운드별로 중계처가 갈린다(2026시즌 기준 KFA 공식 발표) - 2라운드까지는 유튜브,
// 3라운드(=API-Football 라운드 표기로 "Round of 32")부터는 쿠팡플레이. matchday(API-Football의
// league.round)를 실제 KFA 공식 라운드 날짜(1라운드 7/4, 2라운드 7/15, 3라운드 7/29, 16강 8/19)와
// 대조해서 확인한 매핑이다: "Round of 128"=1라운드, "Round of 64"=2라운드, "Round of 32"=3라운드부터.
const KOREA_CUP_COUPANG_ROUNDS = new Set([
  "Round of 32",
  "Round of 16",
  "Quarterfinals",
  "Quarter-finals",
  "Semifinals",
  "Semi-finals",
  "Final",
]);

export function findBroadcastLink(competitionCode, round) {
  if (competitionCode === "KFA") {
    return round && KOREA_CUP_COUPANG_ROUNDS.has(round) ? KOREA_CUP_COUPANG : KOREA_CUP_YOUTUBE;
  }
  return BROADCAST_LINKS[competitionCode] || null;
}

export function findCompetition(code) {
  return COMPETITIONS.find((c) => c.code === code);
}

export function findCompetitionByLeagueId(leagueId) {
  return COMPETITIONS.find((c) => String(c.apiFootballLeagueId) === String(leagueId));
}

// 캐시로 미리 채워두는 경기 목록의 날짜 범위(오늘 기준 -DAYS_BEFORE ~ +DAYS_AFTER, 또는 아래
// MATCH_SCHEDULE_END_DATE 중 더 늦은 쪽). 이 범위 밖의 날짜를 요청하면 목록은 빈 배열로 온다.
export const MATCH_WINDOW_DAYS_BEFORE = 3;
export const MATCH_WINDOW_DAYS_AFTER = 7;
// "2026년 끝날 때까지 일정 다 넣어줘" 요청으로 추가한 고정 상한선 - /fixtures?from&to는 날짜 범위가
// 넓어져도 호출 1번은 그대로라(API-Football 쿼터에 영향 없음) 안전하게 늘릴 수 있다. 연도가 바뀌면
// 이 값도 다음 해 말로 옮겨줘야 한다(COMPETITIONS의 apiFootballSeason과 같은 성격의 수동 관리 값).
export const MATCH_SCHEDULE_END_DATE = "2026-12-31";

export const KV_KEYS = {
  matches: "matches:apifootball:v1",
  standings: "standings:apifootball:v1",
  news: "news:v1",
  transferMarket: "transfers:market:v1",
  pushSubscriptionsIndex: "push:subs:index",
  pushSubscriptionPrefix: "push:sub:",
  pushUsernameIndexPrefix: "push:byusername:",
  prevScores: "scores:prev:v1",
  prevStatuses: "status:prev:v1",
  lastRunPrefix: "lastrun:",
  detailPrefix: "detail:",
  // 로그인/집관인증/레벨/친구/명예의 전당(선택 기능) 관련 저장소.
  userPrefix: "user:",
  nicknameIndexPrefix: "nickname:",
  sessionPrefix: "session:",
  checkinPrefix: "checkin:",
  leaderboardCache: "leaderboard:v1",
  kleagueAdidasPoints: "kleague:adidaspoint:v1",
  // 우리 내부 경기 id -> kleague.com 자체 식별자(year/leagueId/gameId/meetSeq) 매핑.
  // refreshKLeagueResults.js가 스케줄 조회 때마다 갱신하고, matchDetail.js가 API-Football이
  // 비어있을 때(쿼터 소진 등) 매치센터 폴백 조회에 이 매핑으로 kleague.com을 바로 찾아간다.
  kleagueGameRefs: "kleague:gamerefs:v1",
  // K3/K4는 kleague.com이 아닌 KFA(대한축구협회) 공식 사이트가 매치센터 폴백 소스라 별도 키로 관리한다.
  // 우리 내부 경기 id -> KFA layer_popup 상세 조회 식별자(idx/sIdx/div) 매핑.
  kfaGameRefs: "kfa:gamerefs:v1",
  // 경기당 이미 알림 보낸 퇴장(선수+시각)을 기록해두는 중복방지용 저장소. 하루 지나면 만료시켜 정리한다.
  notifiedRedCards: "cards:notified:v1",
  // 리그 검색에서 국가대표팀도 찾을 수 있도록 캐시해두는 국가대표팀 목록(성인 남자만).
  nationalTeams: "teams:national:v1",
  // 팬 커뮤니티 게시판. index는 최신순 요약 목록(글 본문/댓글은 안 담음 - 목록 조회가 무거워지지 않게),
  // 글 본문+댓글 전체는 postPrefix로 글 하나씩 따로 저장한다.
  communityPostIndex: "community:posts:index",
  communityPostPrefix: "community:post:",
  // 신고 목록 - 게시글/댓글 공용으로 한 인덱스에 쌓는다(양이 많지 않을 거라 굳이 분리할 필요 없음).
  communityReportIndex: "community:reports:index",
  // 포인트가 오르내릴 때마다(집관인증 참여/승리/패배 정산 등) 한 줄씩 남기는 개인별 내역 - 유저당
  // 최근 POINTS_LOG_MAX_ENTRIES개만 유지한다(무한정 쌓아두지 않음).
  pointsLogPrefix: "pointslog:",
  // Transfermarkt 실제 이적료 보강용 캐시. player: API-Football 선수ID -> Transfermarkt 선수ID
  // (검색 반복 방지), fee: 선수ID+날짜 -> 실제 이적료(또는 못 찾음) - 한 번 찾으면 refreshTransferMarket.js가
  // 매번 새로 조회하는 이적 목록에 네트워크 호출 없이 그대로 덧붙일 수 있다.
  transfermarktPlayerPrefix: "tmplayer:",
  transfermarktFeePrefix: "tmfee:",
  // 외부 분석 도구 없이 자체적으로 남기는 익명 집계 통계(개인 식별 불가) - 날짜별로 탭 조회수/주요
  // 이벤트(가입/로그인/집관인증) 횟수만 더한다. 개인정보처리방침 7항에서 안내하는 바로 그 통계.
  analyticsPrefix: "analytics:",
};

export const POINTS_LOG_MAX_ENTRIES = 50;

// 설정 탭에서 종류별로 켜고 끌 수 있는 푸시 알림 타입 목록 - 각 크론(detectGoalsAndNotify.js 등)이
// 보내는 payload.type과 정확히 일치해야 한다. id만 쓰고 라벨/아이콘은 프론트(views/settings.js)가
// 따로 들고 있다(프론트는 이 서버 코드를 import할 수 없는 별도 정적 자산이라 중복 정의가 불가피함).
export const NOTIFICATION_TYPES = [
  { id: "goal" },
  { id: "concede" },
  { id: "var_cancel" },
  { id: "kickoff_soon" },
  { id: "kickoff" },
  { id: "halftime" },
  { id: "fulltime" },
  { id: "redcard" },
  { id: "lineup" },
  { id: "transfer" },
];

// 게시판 목록에 남겨두는 최대 글 수 - 이 이상 오래된 글은 목록/상세 모두에서 자연히 사라진다
// (아카이브 개념 없는 최신 위주 게시판이라, 무한정 쌓아두지 않고 KV 저장량을 안전한 선에서 유지).
export const COMMUNITY_MAX_POSTS = 300;
export const COMMUNITY_TITLE_MAX_LENGTH = 80;
export const COMMUNITY_BODY_MAX_LENGTH = 3000;
export const COMMUNITY_COMMENT_MAX_LENGTH = 500;

export const DETAIL_CACHE_TTL_SECONDS = 300;

export const REFRESH_INTERVALS_MS = {
  news: 20 * 60 * 1000,
  transfers: 20 * 60 * 60 * 1000,
  // 전체 대상 팀(400여 개)을 너무 오래 걸리지 않게 한 바퀴 다 돌리기 위한 순환 주기.
  // 2026-07-20에 3분으로 당겼다가 다음날(07-21) 오후 1시경 일일 한도(7500)를 다 써버려 경기/골
  // 갱신까지 통째로 멈추는 사고가 남 -> 5분으로 원복. 이 작업은 refreshTransferMarket.js의 자체
  // 쿼터 서킷브레이커로도 한 번 더 보호된다(사용량이 높으면 이 틱 자체를 건너뜀).
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
// 컵대회에서 정규시간+연장까지 무승부라 승부차기로 승부가 갈리면, 무승부 취급(5점 유지)이 아니라
// 승부차기 결과로 정산한다 - 정규시간 승리(10점)보다는 낮고 무승부(5점)보다는 유불리가 갈리게.
export const POINTS_CHECKIN_SHOOTOUT_WIN = 3;
export const POINTS_CHECKIN_SHOOTOUT_LOSS = 2;
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

// 이적시장 탭에는 "지금 이적시장"(여름 창구)만 보여달라는 요청 - transferWindows 배열은 항상
// [겨울, 여름] 순서로 정의해뒀으니(config.js 상단 주석 참고) 두 번째 항목만 검사한다. 정보가 없는
// 대회는 걸러내지 않고 통과시킨다(누락돼서 안 보이는 것보다 낫다).
export function isInSummerTransferWindow(comp, date) {
  const summer = comp.transferWindows?.[1];
  if (!summer) return true;
  const d = monthDayNumber(date);
  const s = parseMonthDay(summer.start);
  const e = parseMonthDay(summer.end);
  return s <= e ? d >= s && d <= e : d >= s || d <= e;
}

// 이적시장 탭은 사용자 요청으로 관심 리그만 좁혀서 보여준다: 유럽 5대리그 + K리그1~4 + 네덜란드
// (에레디비지에) + 사우디 1부 + 미국(MLS). 나머지 리그(포르투갈/챔피언십/브라질/일본/노르딕 등)는
// 이적시장 탭 대상에서 빠지고(순환 조회 대상에서도 자동으로 빠져 그만큼 API 호출도 아낀다),
// 경기/순위 탭에는 그대로 나온다.
const TRANSFER_MARKET_LEAGUE_CODES = ["PL", "PD", "BL1", "SA", "FL1", "KL1", "KL2", "K3", "K4", "DED", "KSA", "MLS"];

// 이적시장 탭에서 팀 목록을 뽑아올 대상 리그. 대륙컵/월드컵/컵대회(hasBracket)는 팀 구성이
// 시즌마다 바뀌고 그 팀들은 이미 자국 리그 쪽에서 커버되므로 제외하고, 친선경기(FRIENDLY)도 제외한다.
// onlyOpenWindow=true면 지금 이적 등록 기간이 아닌 리그도 걸러낸다 - 어차피 등록 기간이 아니면 새 이적이
// 안 생기니, 그런 리그까지 매번 순환 조회하는 건 낭비다(크론에서 크롤링 대상을 추릴 때 사용).
export function transferMarketCompetitions({ onlyOpenWindow = false } = {}) {
  return COMPETITIONS.filter(
    (c) =>
      !c.hasBracket &&
      c.code !== "FRIENDLY" &&
      TRANSFER_MARKET_LEAGUE_CODES.includes(c.code) &&
      (!onlyOpenWindow || isInTransferWindow(c))
  );
}
