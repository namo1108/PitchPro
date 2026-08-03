import { getJSON } from "./kv.js";
import { KV_KEYS } from "./config.js";

const UA = "Mozilla/5.0 (compatible; PitchProBot/1.0)";

// K3/K4는 API-Football이 일정/순위 위주만 채워주고(config.js 주석 참고) 득점자/라인업/교체는
// 비어있다 - KFA(대한축구협회) 공식 사이트가 이 정보를 그대로 HTML로 서빙하고 있어서(별도 API
// 없음), K리그의 kleague.com 폴백(kleagueMatchCenter.js)과 같은 역할을 K3/K4에서는 이 파일이 한다.
// 우리 팀 이름 표기가 이미 KFA 사이트와 대부분 동일해서(둘 다 결국 KFA 등록명 기반), kleague처럼
// 별도의 팀ID 매핑 테이블 없이 "리그+날짜+홈팀명+어웨이팀명" 문자열 매칭만으로 우리 경기와 KFA
// 경기를 이어붙인다(refreshKfaResults.js).
const COMPETITIONS = {
  K3: { url: "https://www.kfa.or.kr/competition/k3_2026.php", act: "k3" },
  K4: { url: "https://www.kfa.or.kr/competition/k4_2026.php", act: "k4" },
};

// 라인업/득점자 상세 표(score_table)에 시간/도움 컬럼이 <!-- 주석 --> 처리로 숨겨져 있어서(디자인
// 변경 흔적으로 보임), 이 주석들을 먼저 지워야 실제로 보이는 <td> 순서(선수명/득점/경고/퇴장)와
// 정규식이 어긋나지 않는다.
function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

async function fetchKfaHtml(url, referer) {
  const res = await fetch(url, { headers: { "User-Agent": UA, referer } });
  if (!res.ok) throw new Error(`kfa fetch failed: ${res.status} ${url}`);
  return stripComments(await res.text());
}

// 경기일정/결과 표 한 줄(<td>)에서 경기장/홈팀/어웨이팀/일시/스코어를 뽑는다. 스코어가 기록된
// 경기만 onclick="k3_result('idx','s_idx','div')"가 붙어있어(라인업 상세 조회 열쇠), 아직 안 열린
// 경기는 이 부분이 빠진다. 홈팀은 항상 첫 번째 <h3>(승/패와 무관하게 icon_home.png로 표시)다.
const ROW_RE =
  /<td([^>]*)>\s*<div><span>([^<]*)<\/span>\s*<h3[^>]*><img src="([^"]*)"[^>]*\/?>\s*([^<]*?)\s*(?:<img[^>]*icon_home[^>]*\/?>)?\s*<\/h3>\s*<h3[^>]*><img src="([^"]*)"[^>]*\/?>\s*([^<]*?)\s*(?:<img[^>]*icon_home[^>]*\/?>)?\s*<\/h3>\s*<\/div>\s*<div><span>([^<]*)<\/span>\s*<h3[^>]*>([^<]*)<\/h3>\s*<h3[^>]*>([^<]*)<\/h3>\s*<\/div>\s*<\/td>/g;

const RESULT_ATTR_RE = /k[34]_result\('(\d+)','(\d+)','(\w+)'\)/;

function parseRoundSchedule(html) {
  const rows = [];
  let m;
  ROW_RE.lastIndex = 0;
  while ((m = ROW_RE.exec(html))) {
    const [, tdAttrs, , , homeNameRaw, , awayNameRaw, dateSpan, homeScoreText, awayScoreText] = m;
    const dateMatch = dateSpan.match(/^(\d{2}-\d{2})\(([^)]+)\)\s*([\d:]+)/);
    if (!dateMatch) continue;
    const resultMatch = tdAttrs.match(RESULT_ATTR_RE);
    rows.push({
      idx: resultMatch ? resultMatch[1] : null,
      sIdx: resultMatch ? resultMatch[2] : null,
      div: resultMatch ? resultMatch[3] : null,
      homeName: homeNameRaw.trim(),
      awayName: awayNameRaw.trim(),
      date: dateMatch[1],
      homeScore: homeScoreText.trim() === "" ? null : Number(homeScoreText.trim()),
      awayScore: awayScoreText.trim() === "" ? null : Number(awayScoreText.trim()),
    });
  }
  return rows;
}

// round=1부터 순서대로 조회하는 용도 - 라운드 번호가 항상 날짜순은 아니라서(예: K3 2026시즌 20라운드가
// 21라운드보다 늦은 날짜) "최근 라운드부터 몇 개만" 방식은 못 쓰고, 시즌 시작 라운드부터 훑어야
// 놓치는 경기가 없다. 존재하지 않는 라운드(시즌 총 라운드 수를 넘어감)는 빈 표를 반환하므로,
// 그걸 호출부(refreshKfaResults.js)에서 중단 신호로 쓴다.
export async function fetchKfaRound(code, round) {
  const comp = COMPETITIONS[code];
  if (!comp) return [];
  const url = `${comp.url}?act=${comp.act}_round&chk_round=now&act_sub=${comp.act}&round=${round}`;
  const html = await fetchKfaHtml(url, comp.url);
  return parseRoundSchedule(html);
}

// 코리아컵(fa_cup.php)은 K3/K4처럼 라운드별로 나눠 조회하는 게 아니라, 토너먼트 대진표 전체가 한
// 페이지에 다 나온다(단판 토너먼트 구조라 8강/4강/결승 등 라운드가 좌우 대칭 트리 표로 한 번에 표시됨).
// 그래서 round 파라미터 없이 한 번만 받아 대진표 전체에서 이미 열린(idx가 있는) 경기를 다 뽑는다.
// K3/K4와 달리 홈/원정 개념이 없는 중립경기 방식이라, 두 팀 순서가 우리 쪽 homeTeam/awayTeam과
// 다를 수 있어 매칭은 팀 이름 "집합"으로 한다(호출부인 refreshKfaCupResults.js에서 처리).
const CUP_MATCH_RE =
  /<div class="draw"([^>]*)>\s*<div\s+class="team[^"]*">\s*<ul>\s*<li>([^<]*)<\/li>\s*<li class="score">([^<]*)<\/li>\s*<\/ul>\s*<\/div>\s*<div\s+class="team[^"]*">\s*<ul>\s*<li>([^<]*)<\/li>\s*<li class="score">([^<]*)<\/li>\s*<\/ul>\s*<\/div>\s*(?:<div class="pso">PSO<\/div>\s*)?<div class="place[^"]*">([^<]*)<span>\|<\/span>([^<]*)<\/div>/g;

const CUP_RESULT_ATTR_RE = /korea_cup_result\('(\d+)','(\d+)'\)/;

// 스코어 칸이 "1[5]"처럼 나오면 앞은 정규시간(+연장) 득점, [괄호]는 승부차기 스코어다.
function parseCupScore(raw) {
  const m = raw.trim().match(/^(\d+)?(?:\[(\d+)\])?$/);
  if (!m) return { goals: null, pso: null };
  return { goals: m[1] != null ? Number(m[1]) : null, pso: m[2] != null ? Number(m[2]) : null };
}

export async function fetchKfaCupBracket() {
  const url = "https://www.kfa.or.kr/competition/fa_cup.php";
  const html = await fetchKfaHtml(url, url);
  const rows = [];
  let m;
  CUP_MATCH_RE.lastIndex = 0;
  while ((m = CUP_MATCH_RE.exec(html))) {
    const [, drawAttrs, name1, score1Raw, name2, score2Raw, dateTimeText, venue] = m;
    const resultMatch = drawAttrs.match(CUP_RESULT_ATTR_RE);
    if (!resultMatch) continue; // 아직 안 열린 경기(idx 없음) - 라인업 조회 자체가 의미 없어 건너뜀
    const dateMatch = dateTimeText.trim().match(/^(\d{2}-\d{2})/);
    if (!dateMatch) continue;
    const s1 = parseCupScore(score1Raw);
    const s2 = parseCupScore(score2Raw);
    rows.push({
      idx: resultMatch[1],
      sIdx: resultMatch[2],
      div: "fa",
      date: dateMatch[1],
      venue: venue.trim(),
      teamA: { name: name1.trim(), goals: s1.goals, pso: s1.pso },
      teamB: { name: name2.trim(), goals: s2.goals, pso: s2.pso },
    });
  }
  return rows;
}

export async function findKfaGameRef(env, matchId) {
  const refs = await getJSON(env, KV_KEYS.kfaGameRefs);
  return refs?.[matchId] || null;
}

// div=fa(코리아컵)는 COMPETITIONS(K3/K4 라운드 조회용 맵)에 없어서, 예전엔 이 경우 K3 페이지 URL로
// 잘못된 referer가 붙었다 - 실제로 응답이 깨지는지는 몰라도(값이 있음에도 파싱 결과가 비어 나온 사고가
// 있어 확인 차 제대로 맞춰줌), div별 정확한 origin 페이지를 명시해서 요청이 항상 실제로 그 경기가
// 걸려있는 페이지에서 온 것처럼 보이게 한다.
const DETAIL_REFERERS = {
  k3: "https://www.kfa.or.kr/competition/k3_2026.php",
  k4: "https://www.kfa.or.kr/competition/k4_2026.php",
  fa: "https://www.kfa.or.kr/competition/fa_cup.php",
};

export async function fetchKfaMatchDetail({ idx, sIdx, div }) {
  const referer = DETAIL_REFERERS[div?.toLowerCase()] || DETAIL_REFERERS.k3;
  const url = `https://www.kfa.or.kr/layer_popup/domestic.php?act=domestic_detail&idx=${idx}&s_idx=${sIdx}&div=${div}`;
  return fetchKfaHtml(url, referer);
}

// 득점/경고/퇴장 셀은 그 일이 벌어진 분(分)을 담고 있다 - 한 선수가 여러 골을 넣으면 "52, 74, 72, 90"
// 처럼 쉼표로 나열되고, 추가시간 골은 "45(+6)"처럼 괄호 표기가 붙는다. 괄호를 무시하고 그냥
// /\d+/g로만 뽑으면 "45(+6)"이 "45"와 "6" 두 개의 서로 다른 골로 쪼개져 버리는 버그가 있었다 -
// 실제로는 후반 추가시간 6분(45+6)에 넣은 골 하나인데 전반 6분 골이 하나 더 있는 것처럼 보였다.
function parseMinutes(cellText) {
  const minutes = [];
  const re = /(\d+)(?:\s*\(\+(\d+)\))?/g;
  let m;
  while ((m = re.exec(cellText))) {
    minutes.push(m[2] ? `${m[1]}+${m[2]}` : m[1]);
  }
  return minutes;
}

// "1. 최영은[GK]" 형태의 라벨을 등번호/이름/포지션으로 쪼갠다.
const PLAYER_ROW_RE = /<tr>\s*<td>(\d+)\.\s*([^[<]+?)\[([A-Za-z]+)\]<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<\/tr>/g;

function parsePlayerRows(html) {
  const rows = [];
  let m;
  PLAYER_ROW_RE.lastIndex = 0;
  while ((m = PLAYER_ROW_RE.exec(html))) {
    rows.push({
      number: m[1],
      name: m[2].trim(),
      position: m[3].toUpperCase(),
      goalMinutes: parseMinutes(m[4]),
    });
  }
  return rows;
}

// "선발출전선수"/"후보선수" 두 표가 한 팀 섹션 안에 이어져 있어서, "후보선수" 캡션을 기준으로
// 그 앞뒤를 선발/후보로 나눠 각각 파싱한다.
function parseTeamSection(sectionHtml) {
  const benchIdx = sectionHtml.indexOf("후보선수");
  const starterHtml = benchIdx === -1 ? sectionHtml : sectionHtml.slice(0, benchIdx);
  const benchHtml = benchIdx === -1 ? "" : sectionHtml.slice(benchIdx);

  // 상대자책골: "이 팀 섹션"에 적힌 분은 상대가 자책골을 넣어 이 팀이 득점한 경우다(득점자 이름은
  // 안 나오고 분만 나옴). 아직 실제 발생 사례를 못 봐서 형식이 다를 수 있어, 못 찾으면 조용히 건너뛴다.
  const ownGoalMatch = sectionHtml.match(/상대자책골<\/td>\s*<td[^>]*>[^<]*<\/td>\s*<td[^>]*>([^<]*)<\/td>/);
  const ownGoalMinutes = ownGoalMatch ? parseMinutes(ownGoalMatch[1]) : [];

  return { starters: parsePlayerRows(starterHtml), bench: parsePlayerRows(benchHtml), ownGoalMinutes };
}

// 교체 블록(change_list): "▲ IN {선수}"/"▼ OUT {선수}" 한 쌍 + 교체 시각(연장이면 "90 (+2)"처럼 표기).
const CHANGE_RE =
  /▲ IN<\/th>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>[\s\S]*?▼ OUT<\/th>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>/g;

function formatChangeMinute(text) {
  const m = text.match(/(\d+)\s*(?:\(\+(\d+)\))?/);
  if (!m) return text.trim();
  return m[2] ? `${m[1]}+${m[2]}` : m[1];
}

function stripNumber(label) {
  return label.replace(/^\s*\d+\.\s*/, "").trim();
}

function parseSubstitutions(sectionHtml, teamId) {
  const subs = [];
  let m;
  CHANGE_RE.lastIndex = 0;
  while ((m = CHANGE_RE.exec(sectionHtml))) {
    subs.push({
      minute: formatChangeMinute(m[4]),
      teamId,
      playerOut: stripNumber(m[3]),
      playerIn: stripNumber(m[1]),
    });
  }
  return subs;
}

function minuteSortKey(minute) {
  const m = String(minute).match(/^(\d+)(?:\+(\d+))?$/);
  if (!m) return 0;
  return Number(m[1]) + (m[2] ? Number(m[2]) / 100 : 0);
}

function toLineup(teamId, section) {
  const toPlayer = (r) => ({ id: `kfa-${teamId}-${r.number}`, name: r.name, number: r.number, position: r.position, grid: null });
  return {
    teamId,
    formation: null,
    formationStyle: null,
    colors: { player: null, goalkeeper: null },
    startXI: section.starters.map(toPlayer),
    substitutes: section.bench.map(toPlayer),
    coach: null,
  };
}

// KFA 매치센터 상세 팝업(layer_popup/domestic.php) HTML 하나에서 라인업 + 득점 이벤트 + 교체를
// 모두 뽑아 API-Football 어댑터와 같은 모양으로 맞춘다(matchDetail.js가 그대로 꽂아 쓸 수 있게).
// 득점자별 "분" 정보가 별도 이벤트 로그가 아니라 라인업 표의 득점 컬럼에 들어있는 게 KFA 사이트의
// 특징이라, 골 이벤트는 여기서 라인업을 파싱하는 김에 같이 조립한다.
export function parseKfaMatchDetail(html, homeTeamId, awayTeamId) {
  const leftStart = html.indexOf('class="left_table"');
  const rightStart = html.indexOf('class="right_table"');
  if (leftStart === -1 || rightStart === -1) return { lineups: [], goalEvents: [], substitutions: [] };

  const cupInfoStart = html.indexOf('class="cup_info"');
  const leftHtml = html.slice(leftStart, rightStart);
  const rightHtml = html.slice(rightStart, cupInfoStart > rightStart ? cupInfoStart : undefined);

  const home = parseTeamSection(leftHtml);
  const away = parseTeamSection(rightHtml);

  const goalEvents = [];
  function collectGoals(teamId, section) {
    [...section.starters, ...section.bench].forEach((r) => {
      r.goalMinutes.forEach((minute) => {
        goalEvents.push({ minute, teamId, scorer: r.name, assist: null, ownGoal: false, penalty: false });
      });
    });
    section.ownGoalMinutes.forEach((minute) => {
      goalEvents.push({ minute, teamId, scorer: "자책골", assist: null, ownGoal: true, penalty: false });
    });
  }
  collectGoals(homeTeamId, home);
  collectGoals(awayTeamId, away);
  goalEvents.sort((a, b) => minuteSortKey(a.minute) - minuteSortKey(b.minute));

  const substitutions = [...parseSubstitutions(leftHtml, homeTeamId), ...parseSubstitutions(rightHtml, awayTeamId)].sort(
    (a, b) => minuteSortKey(a.minute) - minuteSortKey(b.minute)
  );

  return {
    lineups: [toLineup(homeTeamId, home), toLineup(awayTeamId, away)],
    goalEvents,
    substitutions,
  };
}
