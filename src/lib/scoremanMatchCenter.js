import { getJSON, putJSON } from "./kv.js";
import { KV_KEYS } from "./config.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// AiScore(aiscoreMatchCenter.js)로 K3/K4 라이브 통계를 붙여봤는데, 라벨이 없어서 카테고리를 추측해야
// 했고 슈팅/코너킥처럼 값이 자주 겹치는 항목은 끝까지 확신을 못 가졌다. scoreman123.com은 브라우저
// 네트워크 탭에서 실제 호출을 캡처해보니 라벨이 필요 없을 만큼 데이터 자체가 이미 검증하기 쉬운
// 구조였다(전반/후반 나눠주는 값이 기존에 스크린샷으로 이미 확인해둔 공격/위협공격 수치와 정확히
// 일치, 2026-08-23) - 그래서 이 사이트를 추가 소스로 쓴다.
//
// - /ajax/soccerajax?type=6 : "id" 파라미터와 무관하게 그 시점 진행/예정 경기를 전부 담은 목록
//   (JS 배열 리터럴 문자열, JSON 아님). 한 줄이 "A[i]=[matchId, 리그ID, 홈팀ID, 원정팀ID, '홈팀명',
//   '원정팀명', 'YYYY,M(0-based),D,H,m,s', ...]" 형태 - 이 사이트 자체 팀ID/리그ID 체계라 우리
//   API-Football 팀ID와 매핑표가 필요하다(K-리그 사이트 매핑과 같은 방식). 날짜 문자열의 월은 JS
//   Date.getMonth()처럼 0부터 시작하고 시각은 UTC 그대로다(우리 utcDate와 시간대 변환 없이 바로 비교
//   가능, 확인일 2026-08-23).
// - /ajax/soccerajax?type=15&id=... : 통계값. "tT_f[id]=[[통계타입, '홈값', '원정값', 홈%, 원정%], ...]"
//   형태(JS 배열 리터럴). 통계타입 0=슈팅, 1=유효슈팅, 6=공격, 7=위협공격, 11=점유율(현재),
//   12=점유율(전반전) - 전후반 분리값과 대조해서 확인함. 2(코너킥 추정)는 아직 스크린샷 대조가
//   부족해 보류.
const SCOREMAN_LEAGUE_ID_K4 = "108";
const SCOREMAN_LEAGUE_IDS = { K4: SCOREMAN_LEAGUE_ID_K4 }; // K3는 아직 확인된 경기가 없어 비워둠(2026-08-23)

// K3/K4는 팀이 많아 한 번에 다 못 채운다 - AiScore 매핑 때처럼 확인되는 경기부터 하나씩 늘린다.
const SCOREMAN_TEAM_ID_BY_APIFOOTBALL_ID = {
  27865: "78139", // 서산에프씨
  27858: "78137", // 금산인삼FC
};

// JSON이 아니라 작은따옴표를 쓰는 JS 배열 리터럴로 와서, eval 없이 정규식으로 필요한 필드만 뽑는다
// (외부 응답을 eval하는 건 보안상 절대 안 됨 - 값 자체도 숫자/짧은 문자열이라 정규식으로 충분하다).
const MATCH_ROW_RE =
  /A\[\d+\]=\[(\d+),(\d+),(\d+),(\d+),'([^']*)','([^']*)','(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)'/g;

async function fetchScoremanText(url) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
  if (!res.ok) throw new Error(`scoreman123 ${res.status}`);
  return res.json();
}

function parseMatchList(text) {
  const rows = [];
  let m;
  MATCH_ROW_RE.lastIndex = 0;
  while ((m = MATCH_ROW_RE.exec(text))) {
    const [, matchId, leagueId, homeId, awayId, , , y, mo, d, h, mi, s] = m;
    // 이 사이트 날짜 문자열은 월이 0부터 시작하는 JS Date 표기이고 시각은 UTC 그대로다.
    const kickoff = Date.UTC(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s)) / 1000;
    rows.push({ matchId, leagueId, homeId, awayId, kickoff });
  }
  return rows;
}

export async function findScoremanMatchId(env, match) {
  const leagueId = SCOREMAN_LEAGUE_IDS[match.competition.code];
  if (!leagueId) return null;

  const refs = (await getJSON(env, KV_KEYS.scoremanGameRefs)) || {};
  if (refs[match.id]) return refs[match.id];

  const homeScoremanId = SCOREMAN_TEAM_ID_BY_APIFOOTBALL_ID[match.homeTeam.id];
  const awayScoremanId = SCOREMAN_TEAM_ID_BY_APIFOOTBALL_ID[match.awayTeam.id];
  if (!homeScoremanId && !awayScoremanId) return null; // 둘 다 모르는 팀이면 안전하게 포기

  try {
    const data = await fetchScoremanText("https://www.scoreman123.com/ajax/soccerajax?type=6&id=0");
    const rows = parseMatchList(String(data.Data || ""));
    const targetKickoff = Math.round(new Date(match.utcDate).getTime() / 1000);

    const found = rows.find(
      (r) =>
        r.leagueId === leagueId &&
        r.kickoff === targetKickoff &&
        ((homeScoremanId && r.homeId === homeScoremanId) || (awayScoremanId && r.awayId === awayScoremanId))
    );
    if (!found) return null;

    refs[match.id] = found.matchId;
    await putJSON(env, KV_KEYS.scoremanGameRefs, refs);
    return found.matchId;
  } catch (err) {
    console.error("scoreman123 match list fetch failed:", err);
    return null;
  }
}

// 통계타입번호 -> {stats 필드, 값 변환}. 우리 통계 화면 기존 항목과 바로 연결되는 것만 켠다.
const STAT_TYPE_MAP = {
  0: { key: "shotsTotal", format: (v) => Number(v) },
  1: { key: "shotsOnGoal", format: (v) => Number(v) },
  11: { key: "possession", format: (v) => v }, // 이미 "43%" 형태 문자열로 옴
};

export async function fetchScoremanStatistics(scoremanMatchId, match) {
  const data = await fetchScoremanText(`https://www.scoreman123.com/ajax/soccerajax?type=15&id=${scoremanMatchId}`);
  const text = String(data.Data || "");
  const arrMatch = text.match(new RegExp(`tT_f\\[${scoremanMatchId}\\]=(\\[[\\s\\S]*?\\]);`));
  if (!arrMatch) return [];

  // 배열 리터럴이지만 작은따옴표를 쓰고 트레일링 콤마가 없어 큰따옴표로만 바꾸면 JSON으로 안전하게
  // 파싱된다(내용 자체가 숫자/퍼센트 문자열뿐이라 이스케이프 문제가 생길 여지가 없다).
  let rows;
  try {
    rows = JSON.parse(arrMatch[1].replace(/'/g, '"'));
  } catch (err) {
    console.error("scoreman123 team_stats parse failed:", err);
    return [];
  }

  const homeStats = {};
  const awayStats = {};
  for (const row of rows) {
    const [typeId, homeVal, awayVal] = row;
    const mapping = STAT_TYPE_MAP[typeId];
    if (!mapping) continue;
    homeStats[mapping.key] = mapping.format(homeVal);
    awayStats[mapping.key] = mapping.format(awayVal);
  }

  if (!Object.keys(homeStats).length) return [];
  return [
    { teamId: String(match.homeTeam.id), stats: homeStats },
    { teamId: String(match.awayTeam.id), stats: awayStats },
  ];
}
