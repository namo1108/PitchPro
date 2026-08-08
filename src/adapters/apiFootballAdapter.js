import { findCompetitionByLeagueId, findCompetition, isInSummerTransferWindow } from "../lib/config.js";

const STATUS_MAP = {
  NS: "SCHEDULED",
  // 친선경기는 킥오프 시각이 확정되기 전(TBD)에 API-Football이 임시 시각(대개 00:00)을 채워서 주는 경우가
  // 많아, 이걸 그대로 SCHEDULED로 표시하면 실제와 다른 킥오프 시간이 확정된 것처럼 보인다.
  // 별도 상태로 구분해서 프론트에서 "시간 미정"으로 보여주고 확정 시각은 표시하지 않는다.
  TBD: "TIME_TBD",
  "1H": "IN_PLAY",
  "2H": "IN_PLAY",
  ET: "IN_PLAY",
  BT: "IN_PLAY",
  P: "IN_PLAY",
  LIVE: "IN_PLAY",
  HT: "PAUSED",
  FT: "FINISHED",
  AET: "FINISHED",
  PEN: "FINISHED",
  WO: "FINISHED",
  AWD: "FINISHED",
  PST: "POSTPONED",
  CANC: "CANCELLED",
  ABD: "CANCELLED",
  SUSP: "SUSPENDED",
  INT: "SUSPENDED",
};

function mapStatus(shortStatus) {
  return STATUS_MAP[shortStatus] || "SCHEDULED";
}

// API-Football가 일부 K리그2 구단은 엠블럼이 없거나(플레이스홀더 PNG, 요청 자체는 200이라 onerror
// 폴백이 안 걸림) 실제와 다른(옛 로고 등) 이미지를 줘서, 확인된 팀은 우리가 받은 실제 엠블럼으로 덮어쓴다.
const CREST_OVERRIDES = {
  7087: "/img/emblems/화성.png", // Hwaseong FC
  7098: "/img/emblems/파주.png", // Paju Frontier FC
  7076: "/img/emblems/김해.png", // Gimhae FC
  9171: "/img/emblems/용인.png", // Yongin FC
  7078: "/img/emblems/김포.png", // Gimpo Citizen FC
  2760: "/img/emblems/전남.png", // Jeonnam Dragons
  7060: "/img/emblems/천안.png", // Cheonan City FC
  25719: "/img/emblems/gijang utd.jpg", // Gijang United (K4)
  25720: "/img/emblems/sejong.png", // Sejong SA (K4)
  27863: "/img/emblems/jincheon.png", // Jincheon (K4)
  7075: "/img/emblems/gangneung.png", // Gangneung City (K3)
  7111: "/img/emblems/yangpyeong.png", // Yangpyeong (K3)
  2748: "/img/emblems/anyang.png", // FC Anyang (K리그1) - API-Football이 옛 LG시절 로고를 씀
  23089: "/img/emblems/namyangju.png", // Namyangju FC (K4)
  7105: "/img/emblems/시흥.png", // Siheung Citizen FC (K3)
};

function safeCrest(teamId, logo) {
  const override = CREST_OVERRIDES[String(teamId)];
  return override || logo || null;
}

// API-Football은 K리그/K3/K4 팀 이름을 전부 영문 로마자로 준다("Jeonbuk Motors", "Asan Mugunghwa",
// "Jungnang Chorus Mustang" 등 - 실제 캐시 데이터로 확인한 원문 표기, 확인일 2026-07-18). 국내
// 사용자에게는 한글 공식 명칭이 훨씬 익숙하므로, 경기/순위/팀상세/검색/이적시장 어디서나 한글 이름으로
// 바꿔 보여준다. raw는 팀 id로 매칭이 안 될 때(예: 이적시장의 상대팀처럼 id 없이 이름 문자열만 오는
// 응답)를 위한 폴백 매칭 키다. id는 src/lib/kleagueVenues.js와 동일한 API-Football 팀 id 기준.
// K3/K4는 순위표 캐시(byCode.K3/K4)에서 실제 팀 id/원문명을 확인하고, 대한축구협회 공식 2026 시즌
// 순위표(사용자 제공 스크린샷)의 한글 표기와 도시/기관명으로 대조해 매칭했다(예: "Gyeongju HNP" ==
// 한수원(한국수력원자력) 소재지 경주 -> "경주한수원FC"). 25717(전북현대모터스 K3팀)은 1군(2762)과
// 이름이 같아 보이지만 서로 다른 대회의 별개 팀이다(2군).
const KLEAGUE_TEAM_NAMES = [
  // K리그1
  { id: 2766, raw: "FC Seoul", ko: "FC서울" },
  { id: 2762, raw: "Jeonbuk Motors", ko: "전북현대모터스" },
  { id: 2746, raw: "Gangwon FC", ko: "강원FC" },
  { id: 2764, raw: "Pohang Steelers", ko: "포항스틸러스" },
  { id: 2767, raw: "Ulsan Hyundai FC", ko: "울산HD" },
  { id: 2748, raw: "FC Anyang", ko: "FC안양" },
  { id: 2763, raw: "Incheon United", ko: "인천유나이티드" },
  { id: 2761, raw: "Jeju United FC", ko: "제주SK" },
  { id: 2745, raw: "Bucheon FC 1995", ko: "부천FC1995" },
  { id: 2750, raw: "Daejeon Citizen", ko: "대전하나시티즌" },
  { id: 2768, raw: "Gimcheon Sangmu FC", ko: "김천상무" },
  { id: 2759, raw: "Gwangju FC", ko: "광주FC" },
  // K리그2
  { id: 2752, raw: "Busan I Park", ko: "부산아이파크" },
  { id: 2765, raw: "Suwon Bluewings", ko: "수원삼성블루윙즈" },
  { id: 2747, raw: "Daegu FC", ko: "대구FC" },
  { id: 2756, raw: "Suwon City FC", ko: "수원FC" },
  { id: 2749, raw: "Seoul E-Land FC", ko: "서울이랜드FC" },
  { id: 7087, raw: "Hwaseong", ko: "화성FC" },
  { id: 2753, raw: "Asan Mugunghwa", ko: "충남아산FC" },
  { id: 7078, raw: "Gimpo Citizen", ko: "김포FC" },
  { id: 2751, raw: "Gyeongnam FC", ko: "경남FC" },
  { id: 7060, raw: "Cheonan City", ko: "천안시티FC" },
  { id: 9171, raw: "Yongin City", ko: "용인FC" },
  { id: 7098, raw: "Paju Citizen", ko: "파주시민축구단" },
  { id: 2757, raw: "Seongnam FC", ko: "성남FC" },
  { id: 7061, raw: "Cheongju", ko: "충북청주FC" },
  { id: 2758, raw: "Ansan Greeners", ko: "안산그리너스FC" },
  { id: 2760, raw: "Jeonnam Dragons", ko: "전남드래곤즈" },
  { id: 7076, raw: "Gimhae City", ko: "김해FC" },
  // K3리그
  { id: 7105, raw: "Siheung Citizen", ko: "시흥시민축구단" },
  { id: 7099, raw: "Pocheon", ko: "포천시민축구단" },
  { id: 7068, raw: "Daejeon Korail", ko: "대전코레일FC" },
  { id: 7056, raw: "Busan Transportation", ko: "부산교통공사축구단" },
  { id: 7059, raw: "Changwon City", ko: "창원FC" },
  { id: 18653, raw: "Dangjin Citizen", ko: "당진시민축구단" },
  { id: 7112, raw: "Yeoju Sejong", ko: "여주FC" },
  { id: 7083, raw: "Gyeongju HNP", ko: "경주한수원FC" },
  { id: 7108, raw: "Ulsan Citizen", ko: "울산시민축구단" },
  { id: 7075, raw: "Gangneung City", ko: "FC강릉" },
  { id: 7064, raw: "Chuncheon", ko: "춘천시민축구단" },
  { id: 7111, raw: "Yangpyeong", ko: "양평FC" },
  { id: 7096, raw: "Mokpo City", ko: "FC목포" },
  { id: 25717, raw: "Jeonbuk Motors II", ko: "전북현대모터스" },
  // K4리그
  { id: 16452, raw: "Jinju Citizen", ko: "진주시민축구단" },
  { id: 27863, raw: "Jincheon", ko: "진천HRFC" },
  { id: 27858, raw: "Geumsan Insam", ko: "금산인삼FC" },
  { id: 7092, raw: "Jungnang Chorus Mustang", ko: "서울중랑축구단" },
  { id: 27860, raw: "Jecheon Citizen", ko: "제천시민축구단" },
  { id: 23089, raw: "Namyangju", ko: "남양주시민축구단" },
  { id: 25720, raw: "Sejong SA", ko: "세종SA축구단" },
  { id: 18654, raw: "Geoje Citizen", ko: "거제시민축구단" },
  { id: 18656, raw: "Pyeongchang United", ko: "평창유나이티드축구클럽" },
  { id: 25719, raw: "Gijang United", ko: "기장군민축구단" },
  { id: 27859, raw: "Haman", ko: "함안군민축구단" },
  { id: 27865, raw: "Seosan Pioneer", ko: "서산에프씨" },
  { id: 7101, raw: "Pyeongtaek Citizen", ko: "평택시티즌FC" },
];

const KOREAN_TEAM_NAME_BY_ID = Object.fromEntries(KLEAGUE_TEAM_NAMES.map(({ id, ko }) => [String(id), ko]));
const KOREAN_TEAM_NAME_BY_RAW = Object.fromEntries(KLEAGUE_TEAM_NAMES.map(({ raw, ko }) => [raw.toLowerCase(), ko]));

export function koreanTeamName(teamId, fallbackName) {
  return (
    KOREAN_TEAM_NAME_BY_ID[String(teamId)] ||
    (fallbackName && KOREAN_TEAM_NAME_BY_RAW[fallbackName.toLowerCase()]) ||
    fallbackName
  );
}

// id 없이 이름 문자열만 있는 응답(예: 이적 목록의 상대팀)에 쓴다.
export function koreanizeTeamNameOnly(name) {
  if (!name) return name;
  return KOREAN_TEAM_NAME_BY_RAW[name.toLowerCase()] || name;
}

function pickTeam(team) {
  const name = koreanTeamName(team.id, team.name);
  return { id: String(team.id), name, shortName: name, crest: safeCrest(team.id, team.logo) };
}

// 이미 정규화된(오래된 캐시 등에 남아있을 수 있는) 팀 객체의 이름만 다시 한글로 보정한다 - KV에
// 캐시된 경기/순위 데이터는 새로 갱신되기 전까지 예전 이름을 들고 있을 수 있어(API 한도 초과 등으로
// 갱신이 오래 막히면 특히), 응답 직전에도 한 번 더 보정해서 캐시 갱신 여부와 무관하게 항상 맞게 보인다.
export function koreanizeTeam(team) {
  if (!team) return team;
  const name = koreanTeamName(team.id, team.name);
  return name === team.name && name === team.shortName ? team : { ...team, name, shortName: name };
}

// 목록(fixtures?league=)에는 이미 league 정보가 들어있어 그걸 그대로 쓰고,
// 우리 자체 대회 코드(競 code)가 필요할 때만 findCompetitionByLeagueId로 보강한다.
export function normalizeFixture(raw) {
  const comp = findCompetitionByLeagueId(raw.league.id);
  return {
    id: String(raw.fixture.id),
    utcDate: raw.fixture.date,
    status: mapStatus(raw.fixture.status.short),
    elapsed: raw.fixture.status.elapsed ?? null,
    matchday: raw.league.round || null,
    competition: {
      code: comp?.code || String(raw.league.id),
      name: comp?.name || raw.league.name,
      emblem: comp?.emblem || raw.league.logo || null,
    },
    homeTeam: pickTeam(raw.teams.home),
    awayTeam: pickTeam(raw.teams.away),
    score: {
      fullTime: { home: raw.goals.home ?? null, away: raw.goals.away ?? null },
      halfTime: { home: raw.score.halftime?.home ?? null, away: raw.score.halftime?.away ?? null },
      // 컵대회 승부차기 스코어 - goals.home/away는 연장전까지의 스코어에서 멈추고 승부차기 결과는
      // 따로 온다(API-Football). 예전엔 이 필드를 안 읽어서 승부차기로 끝난 경기의 승자를 알 방법이
      // 없었다(집관인증 포인트 정산·실시간 골 감지 둘 다 이 필드가 필요).
      penalty: { home: raw.score.penalty?.home ?? null, away: raw.score.penalty?.away ?? null },
    },
    venue: raw.fixture.venue?.name || null,
    referees: raw.fixture.referee ? [{ name: raw.fixture.referee }] : [],
  };
}

// 자주 나오는 포메이션에 대한 짧은 스타일 설명(간단한 전술 코멘트용).
const FORMATION_STYLES = {
  "4-3-3": "미드필더 3명이 폭넓게 커버하고 양쪽 윙어가 넓게 벌려 공격하는 균형 잡힌 포메이션",
  "4-2-3-1": "수비형 미드필더 2명이 안정감을 주고, 처진 공격형 미드필더 3명이 창의적인 플레이를 담당하는 포메이션",
  "4-4-2": "투톱이 함께 움직이는 전통적인 포메이션, 측면 크로스 위주의 공격이 특징",
  "4-4-1-1": "투톱 대신 세컨드 스트라이커를 두어 좀 더 유기적인 공격을 만드는 포메이션",
  "3-4-2-1": "3백으로 수비 안정감을 확보하고 윙백이 측면을 오르내리며 폭을 만드는 포메이션",
  "3-4-3": "공격적인 3백 포메이션, 윙백이 사실상 윙어 역할까지 겸함",
  "3-5-2": "중원 숫자 우위를 가져가며 윙백이 공수 양면에서 활발히 움직이는 포메이션",
  "4-1-4-1": "홀딩 미드필더 1명이 수비를 커버하고 나머지가 압박과 점유를 담당하는 포메이션",
  "4-5-1": "미드필드를 두텁게 채워 수비적으로 안정적인 포메이션",
  "5-3-2": "5백으로 수비를 단단히 하고 역습 위주로 운영하는 포메이션",
  "5-4-1": "매우 수비적인 포메이션, 실점을 최소화하는 데 집중",
};

export function describeFormation(formation) {
  if (!formation) return null;
  return FORMATION_STYLES[formation] || `${formation} 포메이션`;
}

export function normalizeLineups(rawList) {
  return (rawList || []).map((entry) => ({
    teamId: String(entry.team.id),
    formation: entry.formation || null,
    formationStyle: describeFormation(entry.formation),
    colors: {
      player: entry.team.colors?.player?.primary ? `#${entry.team.colors.player.primary}` : null,
      goalkeeper: entry.team.colors?.goalkeeper?.primary ? `#${entry.team.colors.goalkeeper.primary}` : null,
    },
    startXI: (entry.startXI || []).map((p) => ({
      id: String(p.player.id),
      name: p.player.name,
      number: p.player.number,
      position: p.player.pos,
      grid: p.player.grid || null,
    })),
    substitutes: (entry.substitutes || []).map((p) => ({
      id: String(p.player.id),
      name: p.player.name,
      number: p.player.number,
      position: p.player.pos,
      grid: null,
    })),
    coach: entry.coach?.name || null,
  }));
}

// 홈/원정 포메이션이 모두 있으면 각각 스타일을 한 줄씩 붙여 짧은 전술 코멘트를 만든다.
export function buildTacticalNote(lineups, homeTeamId, homeTeamName, awayTeamName) {
  if (!lineups || lineups.length < 2) return null;
  const home = lineups.find((l) => l.teamId === homeTeamId) || lineups[0];
  const away = lineups.find((l) => l.teamId !== homeTeamId) || lineups[1];
  if (!home?.formation && !away?.formation) return null;

  const parts = [];
  if (home?.formation) parts.push(`${homeTeamName}은(는) ${home.formation} — ${home.formationStyle}.`);
  if (away?.formation) parts.push(`${awayTeamName}은(는) ${away.formation} — ${away.formationStyle}.`);
  return parts.join(" ");
}

const STAT_KEY_MAP = {
  "Shots on Goal": "shotsOnGoal",
  "Total Shots": "shotsTotal",
  "Ball Possession": "possession",
  "Corner Kicks": "corners",
  Fouls: "fouls",
  "Yellow Cards": "yellowCards",
  "Red Cards": "redCards",
  "Goalkeeper Saves": "saves",
  "Passes %": "passAccuracy",
  expected_goals: "xg",
};

export function normalizeStatistics(rawList) {
  return (rawList || []).map((entry) => {
    const stats = {};
    for (const s of entry.statistics || []) {
      const key = STAT_KEY_MAP[s.type];
      if (key) stats[key] = s.value ?? null;
    }
    return { teamId: String(entry.team.id), stats };
  });
}

// 45+3', 90+4'처럼 정식 축구 표기(90분제 + 추가시간)로 보이도록 elapsed/extra를 합치지 않고 포맷한다.
function formatMinute(time) {
  if (!time) return "";
  return time.extra ? `${time.elapsed}+${time.extra}` : `${time.elapsed}`;
}

export function normalizeGoalEvents(events) {
  return (events || [])
    .filter((e) => e.type === "Goal")
    .map((e) => ({
      minute: formatMinute(e.time),
      teamId: String(e.team.id),
      scorer: e.player?.name || "알 수 없음",
      assist: e.assist?.name || null,
      ownGoal: e.detail === "Own Goal",
      penalty: e.detail === "Penalty",
    }));
}

// 매치 도미넌스를 시간대별로 쪼개 보여주기 위한 용도(routes/matches.js가 아니라 프론트 렌더링 쪽에서
// 세그먼트 계산에 씀) - 카드 이벤트는 이미 매번 fixture events를 받아오는 김에(goalEvents/
// substitutions와 같은 응답) 추가 API 호출 없이 뽑아낼 수 있다.
export function normalizeCardEvents(events) {
  return (events || [])
    .filter((e) => e.type === "Card")
    .map((e) => ({
      minute: formatMinute(e.time),
      teamId: String(e.team.id),
      player: e.player?.name || "알 수 없음",
      red: e.detail === "Red Card" || e.detail === "Second Yellow Card",
    }));
}

// subst 이벤트는 player가 교체되어 나가는 선수, assist가 들어오는 선수(API-Football 관례).
export function normalizeSubstitutionEvents(events) {
  return (events || [])
    .filter((e) => e.type === "subst")
    .map((e) => ({
      minute: formatMinute(e.time),
      teamId: String(e.team.id),
      playerOut: e.player?.name || "알 수 없음",
      playerIn: e.assist?.name || "알 수 없음",
    }));
}

// /fixtures/players는 팀별로 선수 배열을 주는데, 우리는 라인업 카드에 평점만 얹으면 되니까
// 선수 id -> {rating, minutes, substitute} 맵으로 평탄화한다. K3/K4처럼 커버리지가 약한 대회는
// rating이 "0"으로 오는 경우가 많아 그런 값은 걸러서 null로 둔다(뱃지 자체를 안 보여주기 위함).
export function normalizePlayerRatings(rawResponse) {
  const map = {};
  for (const team of rawResponse || []) {
    for (const p of team.players || []) {
      const stats = p.statistics?.[0];
      const ratingNum = parseFloat(stats?.games?.rating);
      map[String(p.player.id)] = {
        rating: ratingNum > 0 ? ratingNum : null,
        minutes: stats?.games?.minutes ?? null,
      };
    }
  }
  return map;
}

function buildStandingsTable(rows) {
  return rows.map((row) => ({
    position: row.rank,
    team: pickTeam(row.team),
    playedGames: row.all.played,
    won: row.all.win,
    draw: row.all.draw,
    lost: row.all.lose,
    points: row.points,
    goalsFor: row.all.goals?.for ?? null,
    goalsAgainst: row.all.goals?.against ?? null,
    goalDifference: row.goalsDiff,
  }));
}

// API-Football는 리그가 그룹(조)으로 나뉘어 있으면 raw.league.standings에 그룹별로 별도 배열을 준다
// (예: MLS는 [0]=서부 컨퍼런스, [1]=동부 컨퍼런스). 예전엔 [0]만 써서 MLS 동부 컨퍼런스 팀 전체가
// 순위표/이적시장 팀 목록에서 통째로 빠지는 문제가 있었다 -> 그룹이 여럿이면 그룹별로 각각 테이블을 만든다.
// (K리그/5대 리그 등 절대다수는 그룹이 하나뿐이라 기존과 동일하게 "TOTAL" 하나로 나간다.)
export function normalizeStandings(raw) {
  const groups = raw?.league?.standings || [];
  if (groups.length <= 1) {
    return { standings: [{ type: "TOTAL", table: buildStandingsTable(groups[0] || []) }] };
  }
  return {
    standings: groups.map((rows) => ({
      type: rows[0]?.group || "GROUP",
      table: buildStandingsTable(rows),
    })),
  };
}

// statKey: "goals"(득점왕) 또는 "assists"(도움왕) — topscorers/topassists 둘 다 같은 모양이라 공유한다.
// 하위 리그(K3/K4, 시즌 초반 K리그2 등)는 API-Football 쪽 통계 집계가 비어서 0골/0도움 선수가
// "랭킹"으로 잡히는 경우가 있어, 실제 기록이 없는(값 0) 항목은 걸러낸다.
export function normalizeTopPlayers(rawList, statKey) {
  return (rawList || [])
    .map((entry) => {
      const stats = entry.statistics?.[0];
      return {
        id: String(entry.player.id),
        name: entry.player.name,
        photo: entry.player.photo || null,
        team: stats?.team?.name || null,
        teamCrest: stats?.team?.logo || null,
        value: stats?.goals?.[statKey] ?? 0,
        appearances: stats?.games?.appearences ?? null,
      };
    })
    .filter((p) => p.value > 0);
}

export function normalizeTeam(raw) {
  const name = koreanTeamName(raw.team.id, raw.team.name);
  return {
    id: String(raw.team.id),
    name,
    shortName: name,
    crest: safeCrest(raw.team.id, raw.team.logo),
    country: raw.team.country || null,
    founded: raw.team.founded || null,
    venue: raw.venue?.name || null,
    venueCity: raw.venue?.city || null,
    venueCapacity: raw.venue?.capacity || null,
  };
}

// API-Football 사진이 깨진 실루엣 플레이스홀더인 선수를 개별적으로 보정한다(확인일 2026-07-13).
const PLAYER_PHOTO_OVERRIDES = {
  534373: "/img/player/petrov-hwaseong.png", // S. Petrov(화성) - 최근 영입이라 API-Football 사진 미반영
};

export function applyPlayerPhotoOverride(photo, playerId) {
  return PLAYER_PHOTO_OVERRIDES[String(playerId)] || photo;
}

// lookup_all_players 10명 제한(TheSportsDB 무료 티어) 없이 전체 스쿼드가 온다.
export function normalizeSquadPlayer(raw) {
  return {
    id: String(raw.id),
    name: raw.name,
    position: raw.position || null,
    nationality: null, // squads 엔드포인트는 국적을 안 줌(선수 상세에서 보강)
    number: raw.number ?? null,
    age: raw.age ?? null,
    photo: applyPlayerPhotoOverride(raw.photo || null, raw.id),
  };
}

// /coachs?team= 는 그 팀을 거쳐간 감독들을 배열로 다 주고, response[0]이 "현재 감독"이라는 보장이 없다
// (심지어 같은 사람이 이름 표기만 다르게 중복 등록된 사례도 있었음: "Cha Du-Ri"/"Du-Ri Cha").
// 그래서 각 감독의 "이 팀" 재임 기록 중 end가 없는(현재진행) 것을 우선하고, 그중 start가 가장 최근인 사람을 고른다.
export function selectCurrentCoach(rawList, teamId) {
  if (!rawList || !rawList.length) return null;

  const withTenure = rawList
    .map((coach) => {
      const stints = (coach.career || []).filter((c) => String(c.team?.id) === String(teamId));
      const latestStint = stints.sort((a, b) => new Date(b.start || 0) - new Date(a.start || 0))[0];
      return latestStint ? { coach, stint: latestStint } : null;
    })
    .filter(Boolean);

  if (!withTenure.length) return rawList[0];

  const ongoing = withTenure.filter((w) => !w.stint.end);
  const pool = ongoing.length ? ongoing : withTenure;
  pool.sort((a, b) => new Date(b.stint.start || 0) - new Date(a.stint.start || 0));

  return pool[0].coach;
}

export function normalizeCoach(raw) {
  if (!raw) return null;
  return {
    id: String(raw.id),
    name: raw.name,
    nationality: raw.nationality || null,
    age: raw.age ?? null,
    photo: raw.photo || null,
  };
}

// API-Football 자체 DB가 아직 못 따라간(웹 검색으로 사실 확인된) 감독/이적 건만 최소한으로 수동 보정한다.
// 전체 이적시장을 다 검증할 수는 없어서, 사용자가 즐겨찾는 팀 등 확인된 건만 등록.
const COACH_OVERRIDES = {
  // Chelsea: Xabi Alonso, 2026-07-01 부임(4년 계약) - API-Football coachs?team=49 엔드포인트 미반영(확인일 2026-07-12).
  // 사진은 API-Football coachs?search=Alonso로 찾은 그의 실제 coach 레코드(id 6801, 레버쿠젠/레알마드리드
  // 재임 시절 등록분)에서 가져온 것 - 같은 소스라 별도로 이미지를 호스팅할 필요가 없다(확인일 2026-07-26).
  49: { id: "override-alonso", name: "Xabi Alonso", nationality: "Spain", age: null, photo: "https://media.api-sports.io/football/coachs/6801.png" },
};

// 이름/재임 정보는 API-Football이 맞게 주는데 사진만 깨진 방패 아이콘 플레이스홀더인 경우(확인일 2026-07-13).
// 전체 감독 정보를 덮어쓸 필요는 없어서 사진만 별도로 교체한다.
const COACH_PHOTO_OVERRIDES = {
  7061: "/img/coaches/rui-quinta.jpg", // 충북청주 - 루이 퀸타
  7098: "/img/coaches/gerard-nus.jpg", // 파주 시민축구단 - 제라드 누스
};

export function applyCoachOverride(coach, teamId) {
  if (COACH_OVERRIDES[String(teamId)]) return COACH_OVERRIDES[String(teamId)];
  const photoOverride = COACH_PHOTO_OVERRIDES[String(teamId)];
  return photoOverride && coach ? { ...coach, photo: photoOverride } : coach;
}

// K3/K4는 API-Football이 감독 정보 자체를 아예 안 주는 구단이 많아서, 나무위키에서 확인한 현재 감독
// 이름을 "API가 비어있을 때만" 채워 넣는다(사용자 요청, 2026-08-08). COACH_OVERRIDES와 달리 API가 이미
// 뭔가 주면(설령 이름이 나무위키와 달라도) 절대 덮어쓰지 않는다 - API 쪽이 사진 등 더 풍부하고, 어느
// 쪽이 최신인지 개별 검증이 불가능해서 "있는 데이터를 안 건드린다"가 더 안전한 기본값이기 때문.
const MANUAL_COACH_FALLBACKS = {
  7105: "이승희", // 시흥시민축구단
  7099: "김준태", // 포천시민축구단
  7056: "백기홍", // 부산교통공사축구단
  18653: "한상민", // 당진시민축구단
  7083: "서보원", // 경주한수원FC
  7111: "양현정", // 양평FC
  16452: "이창엽", // 진주시민축구단
  27863: "유상수", // 진천HRFC
  7092: "곽경근", // 서울중랑축구단
  18654: "송홍섭", // 거제시민축구단
  27865: "이정재", // 서산 파이오니아 FC
  7068: "김찬석", // 대전코레일FC
  7059: "이영진", // 창원FC
  7112: "심봉섭", // 여주FC
  7108: "윤원일", // 울산시민축구단
  7075: "임다한", // FC강릉
  7064: "김우재", // 춘천시민축구단
  7096: "최영근", // FC목포
  25717: "권순형", // 전북현대모터스 B팀(나무위키 "전북 현대 모터스 N" 기준)
  27858: "이영민", // 금산인삼FC
  27860: "한상구", // 제천시민축구단
  23089: "김성일", // 남양주시민축구단
  25720: "김종필", // 세종SA축구단
  18656: "신기동", // 평창유나이티드축구클럽
  25719: "정정수", // 기장군민축구단
  27859: "오휘성", // 함안군민축구단
  7101: "윤상철", // 평택시티즌FC
};

export function applyManualCoachFallback(coach, teamId) {
  if (coach) return coach;
  const name = MANUAL_COACH_FALLBACKS[String(teamId)];
  return name ? { id: `manual-coach-${teamId}`, name, nationality: null, age: null, photo: null } : null;
}

// 이적이 확정됐는데도 스쿼드 목록에서 아직 안 빠진 선수를 수동으로 제거한다(구단 발표/보도로 확인된 건만).
const SQUAD_REMOVALS = {
  // Chelsea -> Real Madrid, 2026-06-15 공식 발표(Real Madrid 스쿼드에는 이미 반영됨, Chelsea 쪽만 안 빠짐)
  49: ["47380"], // Marc Cucurella
};

export function applySquadRemovals(players, teamId) {
  const removals = SQUAD_REMOVALS[String(teamId)];
  if (!removals || !removals.length) return players;
  return players.filter((p) => !removals.includes(p.id));
}

// 일부 선수는 raw.height/weight에 단위가 이미 붙어 오고(예: "185 cm"), 일부는 숫자만 온다(예: "183") ->
// 이미 단위가 있으면 그대로 쓰고, 없으면 붙인다.
function withUnit(value, unit) {
  if (!value) return null;
  return String(value).toLowerCase().includes(unit) ? String(value) : `${value} ${unit}`;
}

export function normalizePlayerDetail(raw) {
  return {
    id: String(raw.id),
    name: raw.name,
    position: raw.position || null,
    nationality: raw.nationality || null,
    number: raw.number ?? null,
    team: null,
    dateBorn: raw.birth?.date || null,
    height: withUnit(raw.height, "cm"),
    weight: withUnit(raw.weight, "kg"),
    photo: raw.photo || null,
    description: null,
  };
}

// 이적시장 탭에 보여줄 "지금 이적시장"만 남긴다 - /transfers?team=은 그 팀의 이적 역사 전체를 주기
// 때문에 옛날 이적까지 다 보이면 응답도 쓸데없이 커지고 원하는 느낌도 안 난다.
// 예전엔 "올해(달력 연도)" 전체를 기준으로 잘랐는데, 그러면 겨울 창구(1~2월) 이적까지 같이 섞여
// 나왔다 - 사용자 요청으로 "이번 여름 이적시장" 딱 그 기간(대회별 transferWindows[1])만 남긴다.
// 대회 코드가 없으면(호출부에서 안 넘겨준 경우) 판단할 기준이 없으니 안전하게 연도만으로 거른다.
function isThisSummerWindow(dateStr, competitionCode) {
  const t = new Date(dateStr);
  if (Number.isNaN(t.getTime())) return false;
  if (t.getUTCFullYear() !== new Date().getUTCFullYear()) return false;
  const comp = competitionCode ? findCompetition(competitionCode) : null;
  return comp ? isInSummerTransferWindow(comp, t) : true;
}

// player 하나가 여러 시즌에 걸쳐 여러 번 이적했을 수 있어 response 배열 전체를 순회하며,
// 그 팀이 "in"(영입) 또는 "out"(방출)으로 관여한 이적만 골라 방향을 붙인다.
export function normalizeTeamTransfers(rawResponse, teamId, competitionCode) {
  const results = [];

  for (const entry of rawResponse || []) {
    const player = entry.player;
    if (!player?.id) continue;

    for (const t of entry.transfers || []) {
      if (!t.date || !isThisSummerWindow(t.date, competitionCode)) continue;

      const inTeam = t.teams?.in;
      const outTeam = t.teams?.out;
      const isIncoming = String(inTeam?.id) === String(teamId);
      const isOutgoing = String(outTeam?.id) === String(teamId);
      if (!isIncoming && !isOutgoing) continue;

      results.push({
        playerId: String(player.id),
        playerName: player.name,
        playerPhoto: player.photo || null,
        fromTeam: outTeam ? koreanTeamName(outTeam.id, outTeam.name) : "알 수 없음",
        fromCrest: outTeam ? safeCrest(outTeam.id, outTeam.logo) : null,
        toTeam: inTeam ? koreanTeamName(inTeam.id, inTeam.name) : "알 수 없음",
        toCrest: inTeam ? safeCrest(inTeam.id, inTeam.logo) : null,
        date: t.date,
        moveType: t.type || null,
        direction: isIncoming ? "in" : "out",
      });
    }
  }

  return results;
}

export function normalizeTransfer(raw) {
  const inTeam = raw.teams?.in;
  return {
    team: inTeam ? koreanTeamName(inTeam.id, inTeam.name) : "알 수 없음",
    crest: inTeam ? safeCrest(inTeam.id, inTeam.logo) : null,
    joined: raw.date || null,
    departed: null,
    moveType: raw.type || null,
  };
}

// /injuries는 시즌 전체의 "결장 이력"을 주기 때문에(현재 부상 여부 플래그가 아님),
// 최근 30일 이내 + 선수별 최신 1건만 남겨서 "지금 결장 중일 가능성이 높은 선수" 목록으로 근사한다.
const INJURY_RECENCY_DAYS = 30;

export function normalizeInjuries(rawList) {
  const cutoff = Date.now() - INJURY_RECENCY_DAYS * 24 * 60 * 60 * 1000;
  const byPlayer = new Map();

  for (const entry of rawList || []) {
    const fixtureDate = entry.fixture?.date ? new Date(entry.fixture.date).getTime() : null;
    if (!fixtureDate || fixtureDate < cutoff) continue;

    const name = entry.player?.name;
    if (!name) continue;

    const existing = byPlayer.get(name);
    if (!existing || fixtureDate > existing.date) {
      byPlayer.set(name, { name, reason: entry.player?.reason || null, date: fixtureDate });
    }
  }

  return Array.from(byPlayer.values())
    .sort((a, b) => b.date - a.date)
    .slice(0, 3)
    .map(({ name, reason }) => ({ name, reason }));
}

export function normalizePlayerSeasonStats(statisticsList) {
  return (statisticsList || [])
    .filter((s) => s.games?.appearences)
    .map((s) => ({
      season: `${s.league.season}`,
      competition: s.league.name,
      competitionBadge: s.league.logo || null,
      team: s.team?.name || null,
      appearances: s.games?.appearences ?? null,
      goals: s.goals?.total ?? null,
      assists: s.goals?.assists ?? null,
      minutes: s.games?.minutes ?? null,
    }));
}
