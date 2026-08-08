// LLM 호출 없이, API-Football에서 받아온 실제 최근 5경기/순위/부상자 데이터로 규칙 기반 분석을 만든다.
// 경기마다 같은 문장이 반복되지 않도록, matchId 기반 해시로 문구 후보 중 하나를 결정적으로 골라 쓴다
// (풀이 넉넉해야 여러 경기를 동시에 봐도 비슷한 문구가 겹치지 않는다).

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pick(templates, seed) {
  return templates[hash(seed) % templates.length];
}

function formLetter(myGoals, oppGoals) {
  if (myGoals === null || myGoals === undefined) return null;
  if (myGoals > oppGoals) return "W";
  if (myGoals < oppGoals) return "L";
  return "D";
}

// 시간순(과거 -> 최근)으로 정렬해둬야 배열 끝쪽이 항상 "가장 최근 경기"가 되어 연승/연패 계산이
// 맞다 - API-Football의 last= 응답 순서를 그대로 믿지 않고 여기서 직접 날짜로 다시 정렬한다.
function teamForm(recentMatches, teamId) {
  return recentMatches
    .slice()
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
    .map((m) => {
      const isHome = m.homeTeam.id === teamId;
      const my = isHome ? m.score.fullTime.home : m.score.fullTime.away;
      const opp = isHome ? m.score.fullTime.away : m.score.fullTime.home;
      return { letter: formLetter(my, opp), my, opp };
    })
    .filter((r) => r.letter);
}

function summarizeForm(results) {
  const letters = results.map((r) => r.letter);
  const wins = letters.filter((l) => l === "W").length;
  const draws = letters.filter((l) => l === "D").length;
  const losses = letters.filter((l) => l === "L").length;
  const goalsFor = results.reduce((sum, r) => sum + (r.my ?? 0), 0);
  const goalsAgainst = results.reduce((sum, r) => sum + (r.opp ?? 0), 0);
  return { wins, draws, losses, letters, goalsFor, goalsAgainst };
}

const FORM_TEMPLATES = {
  none: [(n) => `${n}은(는) 최근 치른 경기 기록이 확인되지 않습니다.`],
  good: [
    (n, s) => `${n} 최근 ${s.letters.length}경기 ${s.wins}승 ${s.draws}무 ${s.losses}패(득실 ${s.goalsFor}-${s.goalsAgainst})로 물오른 상승세를 타고 있습니다.`,
    (n, s) => `${n}는 최근 ${s.letters.length}경기에서 ${s.wins}승을 챙기며 ${s.goalsFor}골을 몰아넣는 등 좋은 흐름을 이어가고 있습니다.`,
    (n, s) => `최근 ${s.letters.length}경기 ${s.wins}승 ${s.draws}무 ${s.losses}패, ${n}의 최근 폼은 확실히 좋은 편입니다.`,
    (n, s) => `${n}는 최근 ${s.letters.length}경기 무패(${s.wins}승 ${s.draws}무)에 가까운 안정적인 경기력을 보여주고 있습니다.`,
    (n, s) => `${n}는 최근 ${s.letters.length}경기에서 ${s.goalsFor}골을 넣고 ${s.goalsAgainst}골만 내주며 공수 밸런스가 좋습니다.`,
    (n, s) => `상승세의 ${n}, 최근 ${s.letters.length}경기 승률이 높아(${s.wins}승 ${s.draws}무 ${s.losses}패) 자신감이 붙어 있습니다.`,
  ],
  bad: [
    (n, s) => `${n} 최근 ${s.letters.length}경기 ${s.wins}승 ${s.draws}무 ${s.losses}패(득실 ${s.goalsFor}-${s.goalsAgainst})로 좀처럼 반등하지 못하고 있습니다.`,
    (n, s) => `${n}는 최근 ${s.losses}패를 포함해 부진한 흐름 속에 있습니다(최근 ${s.letters.length}경기 ${s.wins}승 ${s.draws}무 ${s.losses}패).`,
    (n, s) => `최근 ${s.letters.length}경기에서 ${s.goalsAgainst}골이나 내주며 ${n}의 수비가 흔들리고 있습니다.`,
    (n, s) => `${n}는 최근 경기력이 좋지 않아(${s.wins}승 ${s.draws}무 ${s.losses}패) 반등이 필요한 시점입니다.`,
    (n, s) => `${n}는 최근 ${s.letters.length}경기에서 ${s.goalsFor}골에 그치며 공격력이 무뎌진 모습입니다.`,
    (n, s) => `침체에 빠진 ${n}, 최근 ${s.letters.length}경기 ${s.losses}패로 좀처럼 승리를 챙기지 못하고 있습니다.`,
  ],
  mixed: [
    (n, s) => `${n} 최근 ${s.letters.length}경기 ${s.wins}승 ${s.draws}무 ${s.losses}패로 다소 기복 있는 경기력을 보이고 있습니다.`,
    (n, s) => `${n}는 최근 ${s.letters.length}경기 성적(${s.wins}승 ${s.draws}무 ${s.losses}패)이 들쭉날쭉해 예측이 쉽지 않습니다.`,
    (n, s) => `승패를 오가는 최근 폼(${s.wins}승 ${s.draws}무 ${s.losses}패) 속에서 ${n}는 안정감을 찾는 중입니다.`,
    (n, s) => `${n}는 최근 ${s.letters.length}경기 득실(${s.goalsFor}-${s.goalsAgainst})은 나쁘지 않지만 경기력 기복이 있습니다.`,
    (n, s) => `이기고 지는 패턴이 반복되는 ${n}(${s.wins}승 ${s.draws}무 ${s.losses}패), 이번 경기가 흐름을 바꿀 분기점이 될 수 있습니다.`,
  ],
};

// 예전엔 "3승 이상"처럼 절대 횟수로 어조를 갈랐는데, 표본을 5경기 -> 10경기로 늘리면서 그 기준이
// 안 맞게 됐다(10경기 중 3승은 사실 부진에 가까움) - 표본 크기와 무관하게 항상 같은 의미이도록
// 비율(승률/패율) 기준으로 바꾼다.
function formPhrase(name, summary, seed) {
  if (!summary.letters.length) return pick(FORM_TEMPLATES.none, seed)(name);
  const n = summary.letters.length;
  const winRate = summary.wins / n;
  const lossRate = summary.losses / n;
  const tone = winRate >= 0.5 ? "good" : lossRate >= 0.5 ? "bad" : "mixed";
  return pick(FORM_TEMPLATES[tone], seed)(name, summary);
}

// API-Football의 최근 10경기 조회가 비어서(신생 팀 id 매핑, 시즌 초반 등) "최근 경기 기록이
// 확인되지 않습니다"로만 나오던 K리그 팀들을 위한 대체 경로 - kleague.com 공식 순위표의 최근 6경기
// 승/무/패(routes/analysis.js가 만들어 넘겨줌)로 어조(good/bad/mixed)를 판정한다. 다만 이 소스는
// 경기별 득점/실점을 안 줘서(팀 순위표엔 시즌 누적 득실차만 있음), goalsFor/goalsAgainst를 문장에
// 담는 일반 FORM_TEMPLATES를 그대로 못 쓰고 전적(W/D/L)만으로 말하는 별도 템플릿을 쓴다.
const KLEAGUE_FORM_TEMPLATES = {
  none: [(n) => `${n}은(는) 최근 경기 기록이 확인되지 않습니다.`],
  good: [
    (n, s) => `${n}(K리그 공식 기록 기준) 최근 ${s.letters.length}경기 ${s.wins}승 ${s.draws}무 ${s.losses}패로 좋은 흐름을 이어가고 있습니다.`,
    (n, s) => `K리그 공식 기록으로 보면 ${n}는 최근 ${s.letters.length}경기에서 ${s.wins}승을 챙기며 상승세입니다.`,
  ],
  bad: [
    (n, s) => `${n}(K리그 공식 기록 기준) 최근 ${s.letters.length}경기 ${s.wins}승 ${s.draws}무 ${s.losses}패로 부진한 흐름입니다.`,
    (n, s) => `K리그 공식 기록으로 보면 ${n}는 최근 ${s.letters.length}경기 ${s.losses}패로 반등이 필요합니다.`,
  ],
  mixed: [
    (n, s) => `${n}(K리그 공식 기록 기준) 최근 ${s.letters.length}경기 ${s.wins}승 ${s.draws}무 ${s.losses}패로 기복이 있습니다.`,
  ],
};

export function kleagueFormPhrase(name, summary, seed) {
  if (!summary?.letters?.length) return pick(KLEAGUE_FORM_TEMPLATES.none, seed)(name);
  const n = summary.letters.length;
  const winRate = summary.wins / n;
  const lossRate = summary.losses / n;
  const tone = winRate >= 0.5 ? "good" : lossRate >= 0.5 ? "bad" : "mixed";
  return pick(KLEAGUE_FORM_TEMPLATES[tone], seed)(name, summary);
}

// 연승/연패는 승률(득실) 못지않게 구체적이고 눈에 잘 들어오는 정보라 따로 짚어준다 - 2연승 정도는
// 흔해서 굳이 언급할 정보값이 적으니 3연속부터만 문장으로 만든다. letters는 과거->최근 순이라
// 배열 끝에서부터 거슬러 올라가며 같은 결과가 몇 번 이어지는지 센다.
const STREAK_TEMPLATES = {
  W: [(n, c) => `${n}는 최근 ${c}연승을 달리고 있습니다.`, (n, c) => `${n}는 ${c}연승 행진 중입니다.`],
  L: [(n, c) => `${n}는 최근 ${c}연패에 빠져 있습니다.`, (n, c) => `${n}는 ${c}연패로 흔들리고 있습니다.`],
  D: [(n, c) => `${n}는 최근 ${c}경기 연속 무승부를 기록하고 있습니다.`],
};

function streakPhrase(name, summary, seed) {
  const letters = summary.letters;
  if (letters.length < 3) return null;
  const last = letters[letters.length - 1];
  let count = 0;
  for (let i = letters.length - 1; i >= 0 && letters[i] === last; i--) count++;
  if (count < 3) return null;
  return pick(STREAK_TEMPLATES[last], seed)(name, count);
}

// 상대전적(H2H) - 과거 두 팀이 실제로 붙었을 때 결과. 두 팀 중 누가 홈/원정이었는지는 경기마다
// 다를 수 있어, "이번 경기의 홈팀 기준으로 이겼는지"가 아니라 팀 id 기준으로 승/무/패를 센다.
function summarizeHeadToHead(matches, homeTeamId, awayTeamId) {
  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  let lastMeeting = null;
  for (const m of matches || []) {
    const home = m.score.fullTime.home;
    const away = m.score.fullTime.away;
    if (home === null || home === undefined || away === null || away === undefined) continue;
    const homeTeamWasHome = m.homeTeam.id === homeTeamId;
    const homeTeamGoals = homeTeamWasHome ? home : away;
    const awayTeamGoals = homeTeamWasHome ? away : home;
    if (homeTeamGoals > awayTeamGoals) homeWins++;
    else if (homeTeamGoals < awayTeamGoals) awayWins++;
    else draws++;
    // 이번 두 팀 기준(홈팀/원정팀) 골로 통일해서 담아두면, 그 옛날 경기에서 실제로 누가 홈/원정이었는지와
    // 무관하게 "이번 매치업의 홈팀 관점" 스코어로 바로 문장에 쓸 수 있다.
    if (!lastMeeting || new Date(m.utcDate) > new Date(lastMeeting.utcDate)) {
      lastMeeting = { utcDate: m.utcDate, homeTeamGoals, awayTeamGoals };
    }
  }
  return { meetings: homeWins + awayWins + draws, homeWins, awayWins, draws, lastMeeting };
}

const H2H_LAST_MEETING_TEMPLATES = [
  (h, a, s) => `가장 최근 맞대결(${s.lastMeeting.utcDate.slice(0, 10)})에서는 ${h} ${s.lastMeeting.homeTeamGoals} - ${s.lastMeeting.awayTeamGoals} ${a}로 끝났습니다.`,
  (h, a, s) => `지난 맞대결 결과는 ${h} ${s.lastMeeting.homeTeamGoals} - ${s.lastMeeting.awayTeamGoals} ${a}였습니다.`,
];

function lastMeetingPhrase(homeName, awayName, summary, seed) {
  if (!summary?.lastMeeting) return null;
  return pick(H2H_LAST_MEETING_TEMPLATES, seed)(homeName, awayName, summary);
}

const H2H_HOME_LEAD_TEMPLATES = [
  (h, a, s) => `최근 맞대결 ${s.meetings}경기에서는 ${h}가 ${s.homeWins}승 ${s.draws}무 ${s.awayWins}패로 ${a}에 강한 모습을 보였습니다.`,
  (h, a, s) => `상대전적상 ${h}가 최근 ${s.meetings}번의 맞대결 중 ${s.homeWins}승을 챙기며 ${a}를 상대로 강세를 보이고 있습니다.`,
];
const H2H_AWAY_LEAD_TEMPLATES = [
  (h, a, s) => `최근 맞대결 ${s.meetings}경기에서는 ${a}가 ${s.awayWins}승 ${s.draws}무 ${s.homeWins}패로 ${h}에 강한 모습을 보였습니다.`,
  (h, a, s) => `상대전적상 ${a}가 최근 ${s.meetings}번의 맞대결 중 ${s.awayWins}승을 챙기며 ${h}를 상대로 강세를 보이고 있습니다.`,
];
const H2H_EVEN_TEMPLATES = [
  (h, a, s) => `최근 맞대결 ${s.meetings}경기는 ${s.homeWins}승 ${s.draws}무 ${s.awayWins}패로 팽팽했습니다.`,
  (h, a, s) => `${h}와(과) ${a}의 최근 상대전적은 ${s.homeWins}승 ${s.draws}무 ${s.awayWins}패로 우열을 가리기 어렵습니다.`,
];

function headToHeadPhrase(homeName, awayName, summary, seed) {
  if (!summary || summary.meetings === 0) return null;
  if (summary.homeWins - summary.awayWins >= 2) return pick(H2H_HOME_LEAD_TEMPLATES, seed)(homeName, awayName, summary);
  if (summary.awayWins - summary.homeWins >= 2) return pick(H2H_AWAY_LEAD_TEMPLATES, seed)(homeName, awayName, summary);
  return pick(H2H_EVEN_TEMPLATES, seed)(homeName, awayName, summary);
}

const STANDING_TOP_TEMPLATES = [
  (n, p) => `${n}은(는) 현재 ${p}위로 상위권에 자리하고 있습니다.`,
  (n, p) => `순위표상 ${n}는 ${p}위로 좋은 위치를 지키고 있습니다.`,
  (n, p) => `${p}위 ${n}는 상위권 경쟁을 이어가고 있습니다.`,
  (n, p) => `${n}는 ${p}위에 올라 있어 이번 경기로 순위를 더 끌어올리려 합니다.`,
];
const STANDING_BOTTOM_TEMPLATES = [
  (n, p) => `${n}은(는) 현재 ${p}위로 강등권에 근접해 있어 승점이 절실합니다.`,
  (n, p) => `${p}위에 머물러 있는 ${n}에게는 이번 경기가 중요한 승점 싸움입니다.`,
  (n, p) => `순위표 하위권(${p}위)의 ${n}는 이번 경기 결과가 중요합니다.`,
  (n, p) => `${p}위로 처져 있는 ${n}는 반등을 위한 승점이 급합니다.`,
];
const STANDING_MID_TEMPLATES = [
  (n, p) => `${n}은(는) 현재 ${p}위입니다.`,
  (n, p) => `순위표상 ${n}는 ${p}위에 자리하고 있습니다.`,
  (n, p) => `${n}는 ${p}위로 중위권에서 순위 경쟁 중입니다.`,
];

function standingsPhrase(name, position, total, seed) {
  if (!position) return null;
  if (position <= 4) return pick(STANDING_TOP_TEMPLATES, seed)(name, position);
  if (position > total - 3) return pick(STANDING_BOTTOM_TEMPLATES, seed)(name, position);
  return pick(STANDING_MID_TEMPLATES, seed)(name, position);
}

function findPosition(standingsTable, teamId) {
  const table = standingsTable?.table || [];
  const row = table.find((r) => r.team.id === teamId);
  return row ? { position: row.position, total: table.length } : null;
}

const INJURY_TEMPLATES = [
  (n, names) => `⚕ ${n}은(는) ${names} 결장이 예상됩니다.`,
  (n, names) => `⚕ ${n} 측에서는 ${names}가 이번 경기에 나서지 못할 가능성이 있습니다.`,
  (n, names) => `⚕ 부상 이슈로 ${n}는 ${names} 없이 경기를 치를 수 있습니다.`,
];

// API-Football이 결장 사유(부상 종류/출전정지 등)도 같이 주는데 예전엔 이름만 쓰고 버렸다 - 추가
// API 호출 없이 이미 받아온 필드라 사유까지 괄호로 붙이면 "그냥 결장"보다 훨씬 구체적인 정보가 된다.
function injuryPhrase(name, injuries, seed) {
  if (!injuries || !injuries.length) return null;
  const names = injuries.map((i) => (i.reason ? `${i.name}(${i.reason})` : i.name)).join(", ");
  return pick(INJURY_TEMPLATES, seed)(name, names);
}

// 최근 폼(승/패/득실) + 순위 + 상대전적을 함께 반영한 추정치 — 통계적으로 정교한 확률이 아니라
// "참고용 승부예측"이라는 점을 프론트에서도 명확히 표기한다.
// 예전엔 최근 폼만 봐서(순위·상대전적 완전히 무시) 실제로는 격차가 큰 매치업도 "팽팽한 승부"로
// 뭉뚱그려지는 경우가 많았다 - 순위 차이가 크거나 상대전적에서 확실히 앞서면 그만큼 확실하게 기울게 한다.
function formScore(form) {
  return form.wins - form.losses + (form.goalsFor - form.goalsAgainst) * 0.15;
}

// 순위를 0(꼴찌)~1(1위) 사이로 정규화 - 리그마다 팀 수가 달라도(12팀 K리그1 vs 20팀 EPL) 영향력이 비슷해진다.
function rankScore(pos) {
  if (!pos || pos.total <= 1) return 0.5;
  return 1 - (pos.position - 1) / (pos.total - 1);
}

function computePrediction(homeForm, awayForm, homePos, awayPos, h2h) {
  let homeScore = formScore(homeForm);
  let awayScore = formScore(awayForm);

  // 순위 차이는 시즌 전체 실력 차를 담고 있어 최근 5~10경기 폼보다 오히려 더 신뢰도 높은 지표라, 가중치를 크게 둔다.
  homeScore += rankScore(homePos) * 4;
  awayScore += rankScore(awayPos) * 4;

  // 상대전적은 다른 시즌·다른 스쿼드일 수 있어 가중치를 낮게(폼/순위 대비 보조 지표로만) 반영한다.
  if (h2h && h2h.meetings > 0) {
    homeScore += (h2h.homeWins - h2h.awayWins) * 0.4;
    awayScore += (h2h.awayWins - h2h.homeWins) * 0.4;
  }

  const diff = homeScore - awayScore;

  const homeStrength = Math.exp((diff + 0.35) / 3); // 약한 홈 이점 반영
  const awayStrength = Math.exp(-diff / 3);
  const drawStrength = 1.15;
  const total = homeStrength + awayStrength + drawStrength;

  let home = Math.round((homeStrength / total) * 100);
  let draw = Math.round((drawStrength / total) * 100);
  let away = 100 - home - draw;
  if (away < 0) {
    away = 0;
    draw = 100 - home;
  }

  let favor = "even";
  if (home - away >= 12) favor = "home";
  else if (away - home >= 12) favor = "away";

  return { home, draw, away, favor };
}

const PREDICTION_LEAN_TEMPLATES = [
  (winner) => `종합적으로 보면 ${winner} 쪽으로 무게가 실리는 경기입니다.`,
  (winner) => `여러 지표를 종합하면 이번 경기는 ${winner}의 우세가 예상됩니다.`,
  (winner) => `전력상 ${winner}가 조금 더 유리한 고지에 있는 매치업입니다.`,
  (winner) => `최근 흐름만 놓고 보면 ${winner}의 승리 쪽에 조금 더 무게가 실립니다.`,
];
const PREDICTION_EVEN_TEMPLATES = [
  () => `양 팀의 최근 흐름과 순위를 종합하면 우열을 가리기 힘든 팽팽한 승부가 예상됩니다.`,
  () => `여러 지표가 비슷해 이번 경기는 그야말로 박빙의 승부가 될 것으로 보입니다.`,
  () => `양 팀 모두 확실한 우위를 점치기 어려운, 예측이 쉽지 않은 경기입니다.`,
];

function predictionNote(prediction, homeName, awayName, seed) {
  if (prediction.favor === "home") return pick(PREDICTION_LEAN_TEMPLATES, seed)(homeName);
  if (prediction.favor === "away") return pick(PREDICTION_LEAN_TEMPLATES, seed)(awayName);
  return pick(PREDICTION_EVEN_TEMPLATES, seed)();
}

// match: canonical match object
// teamRecents: {[teamId]: recentMatches[]}
// standingsTables: {home: {table:[...]}|null, away: {table:[...]}|null} - MLS 동/서부 컨퍼런스처럼
//   리그가 그룹으로 나뉜 경우 두 팀이 서로 다른 그룹 표에 속할 수 있어 팀별로 따로 받는다.
// teamInjuries: {[teamId]: [{name, reason}]} (선택)
// h2hMatches: 이번 두 팀의 과거 맞대결 fixture 목록(선택) - 없으면 상대전적 없이 폼/순위만으로 예측한다.
// kleagueForms: {home, away} - API-Football 최근 폼이 비었을 때 대신 쓸 K리그 공식 최근 6경기
// 전적(routes/analysis.js가 kleague.com에서 만들어 넘겨줌, K리그 매치가 아니면 비어있음).
export function buildMatchAnalysis(match, teamRecents, standingsTables, teamInjuries = {}, h2hMatches = [], kleagueForms = {}) {
  const homeName = match.homeTeam.shortName || match.homeTeam.name;
  const awayName = match.awayTeam.shortName || match.awayTeam.name;

  let homeForm = summarizeForm(teamForm(teamRecents[match.homeTeam.id] || [], match.homeTeam.id));
  let homeFormFromKleague = false;
  if (!homeForm.letters.length && kleagueForms.home?.letters?.length) {
    homeForm = kleagueForms.home;
    homeFormFromKleague = true;
  }
  let awayForm = summarizeForm(teamForm(teamRecents[match.awayTeam.id] || [], match.awayTeam.id));
  let awayFormFromKleague = false;
  if (!awayForm.letters.length && kleagueForms.away?.letters?.length) {
    awayForm = kleagueForms.away;
    awayFormFromKleague = true;
  }

  const formNotes = [
    (homeFormFromKleague ? kleagueFormPhrase : formPhrase)(homeName, homeForm, `${match.id}:home-form`),
    (awayFormFromKleague ? kleagueFormPhrase : formPhrase)(awayName, awayForm, `${match.id}:away-form`),
    streakPhrase(homeName, homeForm, `${match.id}:home-streak`),
    streakPhrase(awayName, awayForm, `${match.id}:away-streak`),
  ].filter(Boolean);

  const homePos = findPosition(standingsTables?.home, match.homeTeam.id);
  const awayPos = findPosition(standingsTables?.away, match.awayTeam.id);
  const standingsNotes = [
    homePos && standingsPhrase(homeName, homePos.position, homePos.total, `${match.id}:home-standing`),
    awayPos && standingsPhrase(awayName, awayPos.position, awayPos.total, `${match.id}:away-standing`),
  ].filter(Boolean);

  const injuryNotes = [
    injuryPhrase(homeName, teamInjuries[match.homeTeam.id], `${match.id}:home-injury`),
    injuryPhrase(awayName, teamInjuries[match.awayTeam.id], `${match.id}:away-injury`),
  ].filter(Boolean);

  const h2h = summarizeHeadToHead(h2hMatches, match.homeTeam.id, match.awayTeam.id);
  const h2hNotes = [
    headToHeadPhrase(homeName, awayName, h2h, `${match.id}:h2h`),
    lastMeetingPhrase(homeName, awayName, h2h, `${match.id}:h2h-last`),
  ].filter(Boolean);

  const prediction = computePrediction(homeForm, awayForm, homePos, awayPos, h2h);
  prediction.note = predictionNote(prediction, homeName, awayName, `${match.id}:conclusion`);

  return {
    matchId: match.id,
    competition: match.competition,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    utcDate: match.utcDate,
    formNotes,
    standingsNotes,
    injuryNotes,
    h2hNotes,
    prediction,
  };
}
