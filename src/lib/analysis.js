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

function teamForm(recentMatches, teamId) {
  return recentMatches
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

function formPhrase(name, summary, seed) {
  if (!summary.letters.length) return pick(FORM_TEMPLATES.none, seed)(name);
  const tone = summary.wins >= 3 ? "good" : summary.losses >= 3 ? "bad" : "mixed";
  return pick(FORM_TEMPLATES[tone], seed)(name, summary);
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

function injuryPhrase(name, injuries, seed) {
  if (!injuries || !injuries.length) return null;
  const names = injuries.map((i) => i.name).join(", ");
  return pick(INJURY_TEMPLATES, seed)(name, names);
}

// 최근 폼(승/패/득실)만 가지고 만드는 아주 단순한 추정치 — 통계적으로 정교한 확률이 아니라
// "참고용 승부예측"이라는 점을 프론트에서도 명확히 표기한다.
function computePrediction(homeForm, awayForm) {
  const homeScore = homeForm.wins - homeForm.losses + (homeForm.goalsFor - homeForm.goalsAgainst) * 0.2;
  const awayScore = awayForm.wins - awayForm.losses + (awayForm.goalsFor - awayForm.goalsAgainst) * 0.2;
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
  if (home - away >= 15) favor = "home";
  else if (away - home >= 15) favor = "away";

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
// 참고: 배당률(odds)은 비동기 API 호출이 필요해서 이 함수(순수 함수) 밖, 라우트 레이어에서 결과에 합쳐 넣는다.
export function buildMatchAnalysis(match, teamRecents, standingsTables, teamInjuries = {}) {
  const homeName = match.homeTeam.shortName || match.homeTeam.name;
  const awayName = match.awayTeam.shortName || match.awayTeam.name;

  const homeForm = summarizeForm(teamForm(teamRecents[match.homeTeam.id] || [], match.homeTeam.id));
  const awayForm = summarizeForm(teamForm(teamRecents[match.awayTeam.id] || [], match.awayTeam.id));

  const formNotes = [
    formPhrase(homeName, homeForm, `${match.id}:home-form`),
    formPhrase(awayName, awayForm, `${match.id}:away-form`),
  ];

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

  const prediction = computePrediction(homeForm, awayForm);
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
    prediction,
    odds: null,
  };
}
