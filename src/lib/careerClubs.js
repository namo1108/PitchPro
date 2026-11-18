// 커리어 시뮬레이터용 "실제 구단" 소스 - 가짜 팀을 지어내는 대신 이미 캐싱돼있는 실제 리그
// 순위표(KV_KEYS.standings, analysis.js가 쓰는 것과 같은 shape)를 재사용한다. 등급(1=최상위
// ~4=최하위)은 실제 리그 코드를 수동으로 매핑한다 - 전부 config.js COMPETITIONS에 실존하는 코드만 사용.
import { getJSON } from "./kv.js";
import { KV_KEYS, findCompetition } from "./config.js";

const CLUB_TIER_BY_CODE = {
  PL: 1, PD: 1, BL1: 1, SA: 1, FL1: 1,
  DED: 2, PPL: 2, ELC: 2, MLS: 2, KL1: 2, KSA: 2, NOR: 2, DEN: 2, SCO: 2, BSA: 2, J1: 2,
  KL2: 3, J2: 3, J3: 3, CHN: 3, AUS: 3,
  K3: 4, K4: 4,
};
const DOMESTIC_CODES = new Set(["KL1", "KL2", "K3", "K4"]);

// 트로피/수상 이름(2026-11-16 사용자 요청 - "트로피랑 리그는 api 데이터에서 따오면 좋을 것 같아")에
// 쓸 실제 리그/컵 이름. 국내컵은 config.js COMPETITIONS에 실제로 등록돼있는 나라만(한국=코리아컵,
// 잉글랜드=FA컵) 쓰고, 그 외 리그는 국내컵 데이터가 없어 지역+등급에 맞는 대륙대항전으로 대신한다
// (유럽은 챔피언스/유로파/컨퍼런스리그, 아시아는 AFC챔피언스리그 엘리트/투 - CLUB_TIER_BY_CODE의
// 등급을 그대로 재사용). 둘 다 해당 안 되는 리그(MLS/브라질/호주 등)는 컵 트로피 없이 리그 우승/
// 준우승만 돈다 - 없는 대회를 지어내지 않는다.
const DOMESTIC_CUP_CODE = { KL1: "KFA", KL2: "KFA", K3: "KFA", K4: "KFA", PL: "FA", ELC: "FA" };
const EUROPE_CODES = new Set(["PL", "PD", "BL1", "SA", "FL1", "DED", "PPL", "ELC", "NOR", "DEN", "SCO"]);
const ASIA_CODES = new Set(["KL1", "KL2", "K3", "K4", "KSA", "CHN", "J1", "J2", "J3"]);

export function trophyNamesForClub(club) {
  const code = club?.competitionCode;
  const leagueName = findCompetition(code)?.name || "리그";
  const tier = CLUB_TIER_BY_CODE[code] || 3;

  let cupCode = DOMESTIC_CUP_CODE[code];
  let isContinentalCup = false;
  if (!cupCode) {
    if (EUROPE_CODES.has(code)) cupCode = tier === 1 ? "CL" : tier === 2 ? "EL" : "ECL";
    else if (ASIA_CODES.has(code)) cupCode = tier <= 2 ? "ACL" : "ACL2";
    isContinentalCup = !!cupCode;
  }
  const cupName = cupCode ? findCompetition(cupCode)?.name || null : null;
  return { leagueName, cupName, isContinentalCup };
}

export const CAREER_CLUB_DISCLAIMER =
  "이 시뮬레이션에 등장하는 구단명과 엠블럼은 재미를 위한 식별 목적으로만 사용되며, 실제 구단과 제휴·후원·공식적인 관계가 없습니다.";

// 예전엔 OVR 85는 돼야 5대리그(1등급) 이적 후보가 나왔는데, 성장 밸런스를 올린 뒤(careerEngine.js
// 참고)에도 체감상 top5 노출이 적다는 피드백(2026-11-18 - "프리미어리그, 라리가... 비중을 좀더
// 늘려줘")이 있어 기준선을 낮춘다 - tier 1(PL/PD/BL1/SA/FL1)은 여전히 이 다섯 리그뿐이라, 기준을
// 낮출수록 이 다섯 리그로 가는 이적 제안이 더 자주 뜬다.
function tierForOvr(ovr) {
  if (ovr >= 82) return 1;
  if (ovr >= 68) return 2;
  if (ovr >= 55) return 3;
  return 4;
}

function shuffle(arr) {
  return arr
    .map((v) => [Math.random(), v])
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
}

async function clubPoolForCode(env, code) {
  const standingsBlob = await getJSON(env, KV_KEYS.standings);
  const groups = standingsBlob?.byCode?.[code]?.standings || [];
  const clubs = [];
  for (const group of groups) {
    for (const row of group.table || []) {
      clubs.push({ id: row.team.id, name: row.team.shortName || row.team.name, crest: row.team.crest, competitionCode: code });
    }
  }
  return clubs;
}

async function clubPoolForTier(env, tier) {
  const codes = Object.entries(CLUB_TIER_BY_CODE)
    .filter(([, t]) => t === tier)
    .map(([code]) => code);
  const pools = await Promise.all(codes.map((code) => clubPoolForCode(env, code)));
  // 같은 팀이 여러 대회(예: K리그1 + ACL)에 중복으로 안 잡히게 id 기준으로 한 번씩만.
  return [...new Map(pools.flat().map((c) => [c.id, c])).values()];
}

// 국적 선택에 따라 시작 리그를 다르게 한다(2026-11-18 사용자 요청 - "팀이 처음에는 무조건 K4인데
// 나라 선택하면 그 리그에서 시작할 수 있게 해줘"). 우리가 실제로 추적하는 리그가 있는 나라만
// 매핑하고(국가별로 여러 디비전을 가진 데이터는 한국(K3/K4)뿐이라, 다른 나라는 우리가 가진 유일한
// 리그에서 시작한다 - 없는 하부리그를 지어내지 않는다), 나머지 대다수 나라는 데이터가 없어 기존처럼
// K4(우리가 가진 유일한 "유스팀다운" 최하위 데이터)로 시작한다. 국적 데이터(KV_KEYS.nationalTeams)는
// 이름이 영문이라 소문자로 매칭한다.
const STARTING_LEAGUE_BY_NATIONALITY = {
  "south korea": "K4",
  "korea republic": "K4",
  england: "ELC",
  spain: "PD",
  germany: "BL1",
  italy: "SA",
  france: "FL1",
  netherlands: "DED",
  portugal: "PPL",
  brazil: "BSA",
  usa: "MLS",
  japan: "J3",
  china: "CHN",
  australia: "AUS",
  "saudi arabia": "KSA",
  norway: "NOR",
  denmark: "DEN",
  scotland: "SCO",
};

export async function pickYouthAcademyOffers(env, nationalityName) {
  const code = STARTING_LEAGUE_BY_NATIONALITY[String(nationalityName || "").toLowerCase()];
  if (code) {
    const pool = shuffle(await clubPoolForCode(env, code));
    if (pool.length >= 3) return pool.slice(0, 3);
  }
  // 매핑이 없거나(대부분의 나라) 그 리그 캐시가 아직 비어있으면 기존처럼 K3/K4(4등급)에서 뽑는다.
  const pool = shuffle(await clubPoolForTier(env, 4));
  return pool.slice(0, 3);
}

export async function pickTransferCandidates(
  env,
  save,
  { count = 1, preferLowerTier = false, preferHigherTier = false, excludeDomestic = false } = {}
) {
  let tier = tierForOvr(save.ovr);
  if (preferLowerTier) tier = Math.min(4, tier + 1);
  if (preferHigherTier) tier = Math.max(1, tier - 1);

  let pool = await clubPoolForTier(env, tier);
  if (excludeDomestic) pool = pool.filter((c) => !DOMESTIC_CODES.has(c.competitionCode));
  pool = pool.filter((c) => c.id !== save.club?.id);

  const picked = shuffle(pool).slice(0, count);
  // 해당 등급/조건에 맞는 후보가 하나도 없으면(캐시가 비었거나 너무 좁은 필터) 조건을 풀어서 재시도.
  if (!picked.length && excludeDomestic) {
    return shuffle(await clubPoolForTier(env, tier))
      .filter((c) => c.id !== save.club?.id)
      .slice(0, count);
  }
  return picked;
}
