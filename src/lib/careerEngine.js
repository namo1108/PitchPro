// 커리어 시뮬레이터(미니게임)의 핵심 계산 - "실제 통계적 리얼리즘"보다 "믿을만하면서 재밌는" 걸
// 목표로 한다. 레퍼런스(copero.com.ar simulador-carrera)처럼 능력치는 랜덤으로 오르내리고,
// 2시즌마다 선택지가 등장해 커리어 방향이 갈린다.

export const POSITIONS = ["GK", "CB", "LB", "RB", "CDM", "CM", "CAM", "LM", "RM", "LW", "RW", "ST"];

export const POSITION_GROUP = {
  GK: "GK",
  CB: "DEF",
  LB: "DEF",
  RB: "DEF",
  CDM: "DEF",
  CM: "MID",
  CAM: "MID",
  LM: "MID",
  RM: "MID",
  LW: "FWD",
  RW: "FWD",
  ST: "FWD",
};

const GOAL_RATE = { GK: 0, DEF: 0.05, MID: 0.18, FWD: 0.45 };
const ASSIST_RATE = { GK: 0, DEF: 0.08, MID: 0.22, FWD: 0.15 };

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// 나이대별 OVR 성장/하락 폭 - 20대 초반까지 급성장, 전성기(20대 후반)엔 완만, 33세부턴 급격히 하락.
function growthBracket(nextAge) {
  if (nextAge <= 20) return { min: 2, max: 5 };
  if (nextAge <= 23) return { min: 1, max: 3 };
  if (nextAge <= 29) return { min: -1, max: 2 };
  if (nextAge <= 32) return { min: -3, max: 0 };
  return { min: -6, max: -2 };
}

export function startingOvr() {
  return randInt(47, 53);
}

// potential(숨김 성장 상한)과 retirementAge(숨김 은퇴 나이)는 커리어 시작 시 한 번만 굴려서
// 세이브에 고정해둔다 - 화면엔 안 보여줘서, 매 시즌 "이번엔 얼마나 성장할까" 하는 긴장감을 유지한다.
export function rollPotential(startOvr) {
  return clamp(startOvr + randInt(20, 38), 65, 96);
}
export function rollRetirementAge() {
  return randInt(36, 40);
}

export function advanceOvr(save, nextAge) {
  const { min, max } = growthBracket(nextAge);
  let delta = randInt(min, max);
  if (save.nextSeasonModifier?.ovrDelta) delta += save.nextSeasonModifier.ovrDelta;
  const raw = save.ovr + delta;
  // 29세 이하일 때만 potential을 성장 상한으로 쓴다 - 하락기엔 potential과 무관하게 떨어진다.
  const next = nextAge <= 29 ? Math.min(raw, save.potential) : raw;
  return clamp(next, 40, 99);
}

function appsForOvr(ovr) {
  if (ovr < 55) return randInt(5, 20);
  if (ovr < 65) return randInt(15, 30);
  if (ovr < 75) return randInt(25, 35);
  if (ovr < 85) return randInt(28, 38);
  return randInt(30, 40);
}

export function statsForSeason(save) {
  let apps = appsForOvr(save.ovr);
  if (save.nextSeasonModifier?.appsMultiplier) apps = Math.round(apps * save.nextSeasonModifier.appsMultiplier);
  apps = clamp(apps, 0, 42);

  const group = POSITION_GROUP[save.identity.position] || "MID";
  const skill = save.ovr / 80;
  const goals = Math.max(0, Math.round(apps * GOAL_RATE[group] * skill * randFloat(0.6, 1.3)));
  const assists = Math.max(0, Math.round(apps * ASSIST_RATE[group] * skill * randFloat(0.6, 1.3)));
  return { apps, goals, assists };
}

const TROPHY_NAMES = ["리그 우승", "리그 준우승", "컵대회 우승", "시즌 베스트 11 선정"];

export function rollTrophies(ovr) {
  const chance = clamp(0.08 + (ovr - 50) * 0.004, 0.05, 0.35);
  if (Math.random() >= chance) return [];
  return [TROPHY_NAMES[randInt(0, TROPHY_NAMES.length - 1)]];
}

// 팀 트로피와 별개로, 개인 성적에 따른 "수상"도 추가한다(2026-11-16 사용자 요청 - "수상도 하고").
// 같은 trophies 배열에 그대로 합쳐서 저장한다 - 화면에서 트로피/수상을 구분해서 다룰 필요가 아직
// 없고(은퇴 요약 등 전부 "총 수상 내역"으로 뭉뚱그려 보여주면 충분), 스키마를 늘리지 않아도 된다.
export function rollPersonalAwards(save, stats) {
  const awards = [];
  if (stats.goals >= 20) awards.push("리그 득점왕");
  if (stats.assists >= 12) awards.push("리그 도움왕");
  if (save.ovr >= 85 && Math.random() < 0.25) awards.push("리그 MVP");
  if (save.age <= 21 && save.ovr >= 68 && Math.random() < 0.3) awards.push("올해의 영플레이어");
  return awards;
}

// 이적료(2026-11-16 사용자 요청 - "이적료도 나오고", 이어서 "K리그는 30억까지 안 간다"는 지적
// 반영) - 처음엔 OVR/나이만 봐서 리그 수준과 무관하게 똑같은 금액이 나왔다(K리그로 가는 이적도
// 5대리그급 금액이 나와 비현실적이었음). 리그별 실제 이적시장 체급 차이가 훨씬 크므로, K리그1을
// 기준값(1.0)으로 두고 리그마다 배율을 따로 둔다 - careerClubs.js의 CLUB_TIER_BY_CODE와는 별개
// 기준이다(그쪽은 "경기력 수준", 이쪽은 "이적료 체급"이라 겹치는 리그라도 배율이 다를 수 있음,
// 예: MLS/사우디는 실력 대비 이적료가 크고 J리그/스칸디나비아는 수수한 편).
const LEAGUE_FEE_MULTIPLIER = {
  PL: 14, PD: 11, BL1: 10, SA: 10, FL1: 7,
  KSA: 9, MLS: 5, CHN: 4, BSA: 3.5,
  DED: 4, PPL: 4, ELC: 2.5,
  J1: 1.8, SCO: 1.5, NOR: 1, DEN: 1, AUS: 1,
  KL1: 1, J2: 0.5, KL2: 0.3, J3: 0.15, K3: 0.08, K4: 0.04,
};

// 단위는 "억원"(한국 유저에게 익숙한 단위). valueIndex는 OVR 50을 0으로 두고 제곱으로 키워서
// 상위권 선수일수록 가파르게 뛰게 한 뒤, K리그1 기준으로 보정한 계수(0.011)를 곱한다 - K리그
// 역대 국내 이적료가 대개 수억~20억대, 아주 드물게 30억 안팎인 현실 체감에 맞춘 값(사용자 피드백,
// 2026-11-16). 다른 리그는 LEAGUE_FEE_MULTIPLIER로 그 기준에서 올리거나 내린다.
export function estimateTransferFee(ovr, age, competitionCode) {
  const valueIndex = clamp(ovr - 50, 0, 49);
  let fee = valueIndex * valueIndex * 0.011;
  if (age <= 23) fee *= 1.3; // 어린 유망주 프리미엄
  else if (age <= 29) fee *= 1.0;
  else if (age <= 33) fee *= 0.55;
  else fee *= 0.25;
  fee *= LEAGUE_FEE_MULTIPLIER[competitionCode] ?? 1;
  fee *= randFloat(0.85, 1.15);
  return Math.max(1, Math.round(fee));
}

// ---------- 시즌 스토리(짧은 서사 한 줄, 2026-11-16 사용자 요청 - "약간 스토리도 넣어주고") ----------
// 숫자(OVR/골/도움)만 나열하면 재미가 없어서, 그 시즌에 어울리는 짧은 문장을 하나 붙여준다.
// 결정론적일 필요가 없다(한 번 계산해서 history에 그대로 저장하고 다시 계산하지 않음).
function pick(templates, ...args) {
  return templates[randInt(0, templates.length - 1)](...args);
}

const STORY_TROPHY = [(n, s, t) => `${n}와(과) 동료들은 집중력을 잃지 않고 시즌 내내 달려, 마침내 ${t[0]}을(를) 들어올렸습니다.`];
const STORY_BREAKOUT = [
  (n, s) => `${n}, 이번 시즌 ${s.goals}골을 몰아넣으며 팀의 떠오르는 샛별로 주목받았습니다.`,
  (n, s) => `어린 나이에도 ${s.apps}경기를 소화한 ${n}, 구단의 미래로 평가받기 시작했습니다.`,
];
const STORY_MVP = [
  (n, s) => `${n}의 완벽한 활약(${s.goals}골 ${s.assists}도움) 속에 팀은 최고의 시즌을 보냈습니다.`,
  (n) => `리그를 지배한 ${n}, 상대 팀 감독들의 최우선 경계 대상이 됐습니다.`,
];
const STORY_DECLINE = [
  (n) => `노장이 된 ${n}, 체력 저하를 경험했지만 여전히 후배들에게 모범이 되고 있습니다.`,
  (n) => `전성기는 지났지만 ${n}의 경기 운영 능력만큼은 녹슬지 않았습니다.`,
];
const STORY_STRUGGLE = [
  (n) => `좀처럼 출전 기회를 잡지 못한 ${n}, 반등의 기회를 노리고 있습니다.`,
  (n) => `벤치를 지키는 날이 많았던 ${n}에게는 인내가 필요한 시즌이었습니다.`,
];
const STORY_INJURY = [
  (n) => `${n}, 시즌 중 잔부상에 시달렸지만 꾸준히 그라운드를 지켰습니다.`,
  (n) => `크고 작은 부상이 있었지만 ${n}는 묵묵히 버텨냈습니다.`,
];
const STORY_AVERAGE = [
  (n, s) => `${n}는 ${s.apps}경기에 나서며 묵묵히 제 몫을 다했습니다.`,
  (n, s) => `특별한 반전은 없었지만, ${n}는 꾸준히 팀에 보탬이 됐습니다.`,
];

export function buildSeasonStory(save, stats, trophies) {
  const name = save.identity.name || "선수";
  if (trophies.length && Math.random() < 0.6) return pick(STORY_TROPHY, name, stats, trophies);
  if (save.age <= 20 && stats.goals + stats.apps > 0 && Math.random() < 0.5) return pick(STORY_BREAKOUT, name, stats);
  if (save.ovr >= 85 && Math.random() < 0.4) return pick(STORY_MVP, name, stats);
  if (save.age >= 33) return pick(STORY_DECLINE, name, stats);
  if (stats.apps < 12) return pick(STORY_STRUGGLE, name, stats);
  if (Math.random() < 0.12) return pick(STORY_INJURY, name, stats);
  return pick(STORY_AVERAGE, name, stats);
}

function callUpChance(ovr) {
  if (ovr < 75) return 0;
  return clamp((ovr - 74) * 0.05, 0, 0.6);
}

// 국가대표 발탁 여부를 굴려서 save.nationalTeam을 직접 갱신한다(호출부가 매 시즌 한 번씩 부름).
export function rollNationalCallUp(save) {
  if (save.age < 18) return false;
  const base = callUpChance(save.ovr);
  const chance = save.nationalTeam.called ? clamp(base + 0.15, 0, 0.75) : base;
  if (Math.random() >= chance) return false;

  save.nationalTeam.called = true;
  const caps = randInt(1, 5);
  const group = POSITION_GROUP[save.identity.position] || "MID";
  save.nationalTeam.caps += caps;
  save.nationalTeam.goals += Math.round(caps * GOAL_RATE[group] * 0.5);
  save.nationalTeam.assists += Math.round(caps * ASSIST_RATE[group] * 0.5);
  return true;
}

export function shouldRetire(save) {
  return save.age >= save.retirementAge;
}

// 은퇴 시점 OVR(save.ovr)은 보통 30대 하락기를 거쳐 전성기보다 낮아져 있다 - "커리어를 대표하는
// 능력치"는 그 낮아진 마지막 값이 아니라 커리어 통틀어 가장 높았던 값이어야 한다는 사용자 피드백
// (2026-11-16, "오버롤은 가장 높은걸 반영해야지") 반영. 별도 필드를 추가/갱신하는 대신 이미 쌓여있는
// history의 시즌별 ovr 중 최댓값으로 그때그때 계산한다(세이브 구조를 안 건드려도 됨).
export function peakOvr(save) {
  return save.history.reduce((max, h) => Math.max(max, h.ovr), save.ovr);
}

export function buildRetirementSummary(save) {
  const totals = save.history.reduce(
    (acc, h) => ({
      apps: acc.apps + h.apps,
      goals: acc.goals + h.goals,
      assists: acc.assists + h.assists,
      trophies: acc.trophies.concat(h.trophies || []),
    }),
    { apps: 0, goals: 0, assists: 0, trophies: [] }
  );
  return {
    retiredAt: new Date().toISOString(),
    finalAge: save.age,
    finalOvr: peakOvr(save),
    totalApps: totals.apps,
    totalGoals: totals.goals,
    totalAssists: totals.assists,
    trophies: totals.trophies,
    maxTransferFee: save.maxTransferFee || 0,
  };
}

// ---------- 선택지(결정) 이벤트 ----------
// buildOptions는 (env, save)를 받아 pickTransferCandidates(careerClubs.js)로 상대 구단을 채워넣는다.
// career.js가 템플릿을 고른 뒤 buildOptions를 호출해서 최종 pendingEvent를 만든다.
export const DECISION_TEMPLATES = [
  {
    id: "rotation_vs_transfer",
    text: (save) => `${save.club?.name || "소속팀"}에서의 입지가 흔들리고 있습니다. 주전 경쟁을 이어갈까요, 이적을 노려볼까요?`,
    optionKinds: ["stay_rotation", "transfer"],
  },
  {
    id: "contract_vs_loan",
    text: () => "구단이 재계약을 제안했습니다. 하지만 출전 기회를 위해 임대를 고려해볼 수도 있습니다.",
    optionKinds: ["extend_contract", "loan"],
  },
  {
    id: "overseas_vs_stay",
    text: () => "해외 구단에서 오퍼가 도착했습니다. 해외 진출에 도전해볼까요, 국내에 남을까요?",
    optionKinds: ["overseas_transfer", "stay_domestic"],
  },
];

// 결정 옵션 하나를 골랐을 때 세이브에 반영한다. option.effect.type으로 분기.
export function applyDecisionEffect(save, effect) {
  switch (effect.type) {
    case "stay_rotation": {
      save.nextSeasonModifier =
        Math.random() < 0.5
          ? { ovrDelta: randInt(1, 2), appsMultiplier: 1.1 } // 주전 꿰참
          : { ovrDelta: -randInt(0, 1), appsMultiplier: 0.6 }; // 로테이션에 밀림
      break;
    }
    case "transfer":
    case "overseas_transfer": {
      save.club = effect.club;
      save.contractStatus = "계약중";
      save.seasonsAtClub = 0;
      save.loanParentClubId = null;
      if (effect.type === "overseas_transfer") {
        save.ovr = clamp(save.ovr + randInt(1, 3), 40, 99);
      }
      if (effect.fee) save.maxTransferFee = Math.max(save.maxTransferFee || 0, effect.fee);
      break;
    }
    case "loan": {
      save.loanParentClubId = save.club?.id || null;
      save.club = effect.club;
      save.contractStatus = "임대중";
      break;
    }
    case "extend_contract": {
      save.contractStatus = "계약중";
      break;
    }
    case "stay_domestic":
      break;
    default:
      break;
  }
}
