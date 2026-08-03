import { getJSON } from "./kv.js";
import { KV_KEYS } from "./config.js";
import { KLEAGUE_SITE_TEAM_ID_TO_APIFOOTBALL_ID } from "../scheduled/refreshKLeagueResults.js";
import { describeFormation } from "../adapters/apiFootballAdapter.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// K리그 매치센터(kleague.com)는 API-Football과 완전히 무관한 별도 소스라, API-Football 쿼터가
// 소진돼도(2026-07-21 사고) 경기 상세(득점자/도움/교체/통계/라인업)를 계속 채울 수 있는 폴백이다.
// refreshKLeagueResults.js가 스케줄 조회 때마다 우리 내부 경기 id -> kleague gameId 매핑을
// KV_KEYS.kleagueGameRefs에 저장해두므로, 여기서는 그 매핑만 찾아 바로 조회한다.
export async function findKLeagueGameRef(env, matchId) {
  const refs = await getJSON(env, KV_KEYS.kleagueGameRefs);
  return refs?.[matchId] || null;
}

async function postForm(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
      referer: "https://www.kleague.com/match.do",
    },
    body,
  });
  if (!res.ok) throw new Error(`kleague matchcenter fetch failed: ${res.status} ${url}`);
  const data = await res.json();
  if (data.resultCode !== "200") throw new Error(`kleague matchcenter error: ${data.resultMsg}`);
  return data.data;
}

export function fetchKLeagueMatchInfo(ref) {
  return postForm(
    "https://www.kleague.com/api/ddf/match/matchInfo.do",
    `year=${ref.year}&meetSeq=${ref.meetSeq}&gameId=${ref.gameId}`
  );
}

export function fetchKLeagueMatchRecord(ref) {
  return postForm(
    "https://www.kleague.com/api/ddf/match/matchRecord.do",
    `year=${ref.year}&meetSeq=${ref.meetSeq}&gameId=${ref.gameId}`
  );
}

function toApiFootballId(kleagueTeamId) {
  return KLEAGUE_SITE_TEAM_ID_TO_APIFOOTBALL_ID[kleagueTeamId] || null;
}

// kleague.com의 firstHalf timeMin은 이미 절대 분(전반 추가시간 포함, 예: 47 = "45+2")인데,
// secondHalf timeMin은 후반 킥오프부터 다시 세는 "그 반 안에서의" 분이다(예: 후반 8분 -> 8).
// 이 차이를 모르고 그대로 썼더니 후반 8분에 넣은 골이 "8'"로 표시돼 마치 전반 8분(경기 시작하자마자)
// 선제골을 넣은 것처럼 보이는 버그가 있었다(2026-07 사용자 제보, 서울삼성vs부산 경기 - 실제로는
// 부산이 36분에 넣은 게 선제골이었는데 수원삼성의 후반 8분(=53분) 골이 8분으로 잘못 표시돼 그게
// 선제골처럼 보였음). 후반은 45를 더해 절대 분으로 바꾸고, 90분을 넘는 만큼은 축구 표기 관례대로
// "90+n"으로 표시한다(전반 추가시간도 마찬가지로 "45+n").
function formatKLeagueMinute(timeMin, half) {
  const raw = Number(timeMin) || 0;
  if (half === 2) {
    // 후반은 45를 더해 절대 분으로 바꾸고, 정규 후반(46~90분)은 그대로 보여주되 그걸 넘는 만큼만
    // 추가시간으로 "90+n" 표기한다 - 정규 시간대(예: 53분)까지 "45+n"으로 잘못 접어버리면 안 된다.
    const absolute = 45 + raw;
    return absolute > 90 ? `90+${absolute - 90}` : String(absolute);
  }
  // 전반은 raw 자체가 이미 절대 분이라, 45를 넘는 만큼만 추가시간으로 "45+n" 표기한다.
  return raw > 45 ? `45+${raw - 45}` : String(raw);
}

// matchInfo.do의 firstHalf/secondHalf 이벤트 배열(시간순)에서 "득점" 바로 다음(같은 반의 같은 분)에
// 오는 "도움" 이벤트를 그 골의 어시스트로 묶는다(공식 사이트 이벤트 로그가 득점->도움 순으로 붙어서
// 나온다). 전후반 모두 raw timeMin이 비슷한 범위(1~45 안팎)를 쓰기 때문에, 같은 분이어도 반이
// 다르면 서로 다른 이벤트이니 half까지 같이 확인해야 엉뚱한 반의 도움이 묶이지 않는다.
export function normalizeKLeagueGoalEvents(matchInfo) {
  const events = [
    ...(matchInfo.firstHalf || []).map((e) => ({ ...e, half: 1 })),
    ...(matchInfo.secondHalf || []).map((e) => ({ ...e, half: 2 })),
  ];
  const goals = [];
  events.forEach((e, i) => {
    if (e.eventName !== "득점") return;
    const next = events[i + 1];
    const assist = next && next.eventName === "도움" && next.timeMin === e.timeMin && next.half === e.half ? next.playerName : null;
    goals.push({
      minute: formatKLeagueMinute(e.timeMin, e.half),
      teamId: toApiFootballId(e.teamId),
      scorer: e.playerName || "알 수 없음",
      assist,
      ownGoal: false,
      penalty: false,
    });
  });
  return goals;
}

export function normalizeKLeagueSubstitutions(matchInfo) {
  const events = [
    ...(matchInfo.firstHalf || []).map((e) => ({ ...e, half: 1 })),
    ...(matchInfo.secondHalf || []).map((e) => ({ ...e, half: 2 })),
  ];
  return events
    .filter((e) => e.eventName === "교체")
    .map((e) => ({
      minute: formatKLeagueMinute(e.timeMin, e.half),
      teamId: toApiFootballId(e.teamId),
      playerOut: e.playerName || "알 수 없음",
      playerIn: e.playerName2 || "알 수 없음",
    }));
}

export function normalizeKLeagueStatistics(matchRecord, homeTeamId, awayTeamId) {
  const toStats = (t) =>
    t
      ? {
          shotsOnGoal: t.onTarget ?? null,
          shotsTotal: t.attempts ?? null,
          possession: t.possession != null ? `${t.possession}%` : null,
          corners: t.corners ?? null,
          fouls: t.fouls ?? null,
          yellowCards: t.yellowCards ?? null,
          redCards: t.redCards ?? null,
        }
      : {};
  return [
    { teamId: homeTeamId, stats: toStats(matchRecord.home) },
    { teamId: awayTeamId, stats: toStats(matchRecord.away) },
  ];
}

export async function fetchKLeagueMatchPageHtml(ref) {
  const url = `https://www.kleague.com/match.do?year=${ref.year}&leagueId=${ref.leagueId}&gameId=${ref.gameId}&meetSeq=${ref.meetSeq}&startTabNum=0`;
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`kleague match.do fetch failed: ${res.status}`);
  return res.text();
}

// "88.조인정", "97.이유현(c)" 형태의 라벨을 등번호/이름으로 쪼갠다. (c)는 주장 표기라 이름에서 뗀다.
function splitNumberName(label) {
  const m = (label || "").trim().match(/^(\d+)\.(.+)$/);
  if (!m) return { number: null, name: (label || "").trim() };
  return { number: m[1], name: m[2].replace(/\(c\)\s*$/i, "").trim() };
}

// 선발 11명은 .lineup-wrap의 .home/.away 블록에 포메이션 좌표(top/left %)와 함께 그대로 나온다
// (kleague 자체 pitch 다이어그램용 데이터). .home/.away 사이 구간을 잘라서 팀별로 따로 파싱하면
// 두 팀이 섞일 위험 없이 확실하게 나뉜다.
const STARTER_RE =
  /<div onclick="playerDetailPop\('(\w+)',\s*'(\d+)'\)" style="cursor:pointer;\s*top:\s*([\d.]+)%;\s*left:\s*([\d.]+)%;">[\s\S]*?<div style="background-image: url\('([^']*)'\);"><\/div>\s*<p>([^<]*)<\/p>/g;

function parsePitchSection(sectionHtml) {
  const starters = [];
  let m;
  STARTER_RE.lastIndex = 0;
  while ((m = STARTER_RE.exec(sectionHtml))) {
    const { number, name } = splitNumberName(m[6]);
    starters.push({ teamCode: m[1], playerId: m[2], top: parseFloat(m[3]), left: parseFloat(m[4]), photo: m[5] || null, number, name });
  }
  return { starters };
}

// 포메이션은 서버 HTML에 바로 안 박혀있고(".hFormation"/".aFormation" div가 비어있음), 페이지 하단
// 인라인 스크립트가 브라우저에서 "$(.hFormation).text(separateNumber('4231'))"처럼 클라이언트 JS로
// 채워 넣는다 - 우리는 JS를 실행할 수 없으니, 그 숫자 리터럴을 정규식으로 직접 읽고
// separateNumber와 동일하게(자릿수마다 "-") 재구성한다.
function extractFormations(html) {
  const home = html.match(/\$\(["']\.hFormation["']\)\.text\(separateNumber\(['"](\d+)['"]\)\)/);
  const away = html.match(/\$\(["']\.aFormation["']\)\.text\(separateNumber\(['"](\d+)['"]\)\)/);
  const toDashed = (digits) => (digits ? digits.split("").join("-") : null);
  return { home: toDashed(home?.[1]), away: toDashed(away?.[1]) };
}

// 팀 전체 스쿼드(선발+교체+감독)는 .match-lineup-player의 테이블 두 개(팀별)에 그대로 나온다.
// 감독 행은 onclick에 팀 코드가 없어서, 바로 다음 행(그 팀 첫 선수)의 팀 코드로 소속을 정한다.
const ROSTER_ROW_RE =
  /<tr onclick="(?:playerDetailPop\('(\w+)',\s*'(\d+)'\)|window\.open\('\/record\/playerDetail\.do\?playerId=(\d+)','_blank'\);?)">\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>\s*([^<]*)<\/td>/g;

function parseRosterRows(html) {
  const start = html.indexOf('class="match-lineup-player"');
  if (start === -1) return [];
  const section = html.slice(start, start + 400000); // 두 팀 로스터 테이블을 넉넉히 포함하는 구간
  const rows = [];
  let m;
  ROSTER_ROW_RE.lastIndex = 0;
  while ((m = ROSTER_ROW_RE.exec(section))) {
    rows.push({
      teamCode: m[1] || null,
      playerId: m[2] || m[3] || null,
      number: m[4].trim(),
      position: m[5].trim(),
      name: m[6].trim(),
      isCoach: m[5].trim() === "감독",
    });
  }
  // 감독 행 소속팀 채우기
  rows.forEach((row, i) => {
    if (row.isCoach && !row.teamCode) row.teamCode = rows[i + 1]?.teamCode || null;
  });
  return rows;
}

// match.do 페이지 HTML 하나에서 라인업(선발 pitch 좌표 + 교체/감독 포함 전체 스쿼드)을 모두 뽑아
// API-Football 라인업과 같은 모양({teamId, formation, startXI, substitutes, coach, ...})으로 맞춘다.
// startXI에는 grid(row:col) 대신 pitchPosition(top/left %)을 실어서, 프론트가 실제 kleague 좌표를
// 그대로 써서 피치 다이어그램을 그리게 한다(변환 손실 없이 그대로 재사용).
export function parseKLeagueLineups(html, homeTeamId, awayTeamId) {
  const homeStart = html.indexOf('<div class="home">');
  const awayStart = html.indexOf('<div class="away">');
  const legendStart = html.indexOf('<div class="match-formation-wrap">');
  if (homeStart === -1 || awayStart === -1) return [];

  const homePitch = parsePitchSection(html.slice(homeStart, awayStart));
  const awayPitch = parsePitchSection(html.slice(awayStart, legendStart > awayStart ? legendStart : awayStart + 100000));
  const rosterRows = parseRosterRows(html);
  const formations = extractFormations(html);

  const teamCodes = [...new Set(rosterRows.map((r) => r.teamCode).filter(Boolean))];
  return teamCodes
    .map((teamCode) => {
      const apiFootballId = toApiFootballId(teamCode);
      if (!apiFootballId || (apiFootballId !== homeTeamId && apiFootballId !== awayTeamId)) return null;

      const isHomeSide = teamCode === homePitch.starters[0]?.teamCode;
      const pitch = isHomeSide ? homePitch : teamCode === awayPitch.starters[0]?.teamCode ? awayPitch : null;
      const formation = isHomeSide ? formations.home : formations.away;
      const pitchById = new Map((pitch?.starters || []).map((p) => [p.playerId, p]));
      const coachRow = rosterRows.find((r) => r.teamCode === teamCode && r.isCoach);

      const startXI = [];
      const substitutes = [];
      for (const row of rosterRows) {
        if (row.teamCode !== teamCode || row.isCoach) continue;
        const pitchInfo = pitchById.get(row.playerId);
        const player = { id: row.playerId, name: row.name, number: row.number, position: row.position, grid: null };
        if (pitchInfo) {
          player.pitchPosition = { top: pitchInfo.top, left: pitchInfo.left };
          player.photo = pitchInfo.photo;
          startXI.push(player);
        } else {
          substitutes.push(player);
        }
      }

      return {
        teamId: apiFootballId,
        formation,
        formationStyle: describeFormation(formation),
        colors: { player: null, goalkeeper: null },
        startXI,
        substitutes,
        coach: coachRow?.name || null,
      };
    })
    .filter(Boolean);
}
