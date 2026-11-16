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
    finalOvr: save.ovr,
    totalApps: totals.apps,
    totalGoals: totals.goals,
    totalAssists: totals.assists,
    trophies: totals.trophies,
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
