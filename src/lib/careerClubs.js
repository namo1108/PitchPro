// 커리어 시뮬레이터용 "실제 구단" 소스 - 가짜 팀을 지어내는 대신 이미 캐싱돼있는 실제 리그
// 순위표(KV_KEYS.standings, analysis.js가 쓰는 것과 같은 shape)를 재사용한다. 등급(1=최상위
// ~4=최하위)은 실제 리그 코드를 수동으로 매핑한다 - 전부 config.js COMPETITIONS에 실존하는 코드만 사용.
import { getJSON } from "./kv.js";
import { KV_KEYS } from "./config.js";

const CLUB_TIER_BY_CODE = {
  PL: 1, PD: 1, BL1: 1, SA: 1, FL1: 1,
  DED: 2, PPL: 2, ELC: 2, MLS: 2, KL1: 2, KSA: 2, NOR: 2, DEN: 2, SCO: 2, BSA: 2, J1: 2,
  KL2: 3, J2: 3, J3: 3, CHN: 3, AUS: 3,
  K3: 4, K4: 4,
};
const DOMESTIC_CODES = new Set(["KL1", "KL2", "K3", "K4"]);

export const CAREER_CLUB_DISCLAIMER =
  "이 시뮬레이션에 등장하는 구단명과 엠블럼은 재미를 위한 식별 목적으로만 사용되며, 실제 구단과 제휴·후원·공식적인 관계가 없습니다.";

function tierForOvr(ovr) {
  if (ovr >= 85) return 1;
  if (ovr >= 72) return 2;
  if (ovr >= 58) return 3;
  return 4;
}

function shuffle(arr) {
  return arr
    .map((v) => [Math.random(), v])
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
}

async function clubPoolForTier(env, tier) {
  const standingsBlob = await getJSON(env, KV_KEYS.standings);
  const codes = Object.entries(CLUB_TIER_BY_CODE)
    .filter(([, t]) => t === tier)
    .map(([code]) => code);

  const clubs = [];
  for (const code of codes) {
    const groups = standingsBlob?.byCode?.[code]?.standings || [];
    for (const group of groups) {
      for (const row of group.table || []) {
        clubs.push({ id: row.team.id, name: row.team.shortName || row.team.name, crest: row.team.crest, competitionCode: code });
      }
    }
  }
  // 같은 팀이 여러 대회(예: K리그1 + ACL)에 중복으로 안 잡히게 id 기준으로 한 번씩만.
  return [...new Map(clubs.map((c) => [c.id, c])).values()];
}

// 16세 유스팀 오퍼는 항상 최하위 등급(K3/K4)에서만 3곳을 뽑는다 - "좋지 않은 팀에서 시작"하는
// 서사를 보장한다.
export async function pickYouthAcademyOffers(env) {
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
