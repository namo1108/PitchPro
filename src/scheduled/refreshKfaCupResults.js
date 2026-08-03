import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import { fetchKfaCupBracket } from "../lib/kfaMatchCenter.js";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const CODE = "KFA"; // config.js COMPETITIONS의 코리아컵 코드

function toKstMonthDay(utcIso) {
  const d = new Date(new Date(utcIso).getTime() + KST_OFFSET_MS);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// 코리아컵은 중립 경기(단판 토너먼트)라 KFA 대진표에 홈/원정 구분이 없다 - 우리 쪽 매치도 팀
// "집합"(순서 무관)으로 맞춰야 한다(K3/K4는 항상 홈이 먼저 나와 순서 그대로 맞췄지만 여긴 다름).
function teamSetKey(a, b) {
  return [a, b].sort().join("|");
}

// K3/K4(refreshKfaResults.js)와 달리 라운드 페이지네이션이 없다 - 대진표 전체를 한 번에 받아서
// idx가 붙은(이미 열린) 경기만 우리 캐시와 이어붙인다. 승부차기 스코어(pso)도 여기서 같이 얻지만,
// 최종 판정은 API-Football 쪽 score.penalty(더 신뢰도 높은 실시간 소스)를 우선 신뢰한다 - 이건
// 라인업 조회용 idx 매핑과, API-Football이 아직 최종 스코어를 안 반영했을 때의 폴백 정정용이다.
export async function refreshKfaCupResults(env) {
  const blob = await getJSON(env, KV_KEYS.matches);
  if (!blob?.matches?.length) return;

  const pendingByKey = new Map();
  const allByKey = new Map();
  for (const m of blob.matches) {
    if (m.competition.code !== CODE) continue;
    const key = `${toKstMonthDay(m.utcDate)}:${teamSetKey(m.homeTeam.name, m.awayTeam.name)}`;
    allByKey.set(key, m);
    if (m.status !== "FINISHED") pendingByKey.set(key, m);
  }
  if (!allByKey.size) return;

  let rows;
  try {
    rows = await fetchKfaCupBracket();
  } catch (err) {
    console.error("kfa cup bracket fetch failed:", err);
    return;
  }

  const gameRefs = (await getJSON(env, KV_KEYS.kfaGameRefs)) || {};
  let refsChanged = false;
  let scoresChanged = false;

  for (const row of rows) {
    const key = `${row.date}:${teamSetKey(row.teamA.name, row.teamB.name)}`;
    const matched = allByKey.get(key);
    if (matched) {
      const ref = { idx: row.idx, sIdx: row.sIdx, div: row.div };
      if (JSON.stringify(gameRefs[matched.id]) !== JSON.stringify(ref)) {
        gameRefs[matched.id] = ref;
        refsChanged = true;
      }
    }

    if (row.teamA.goals == null || row.teamB.goals == null) continue;
    const cached = pendingByKey.get(key);
    if (!cached) continue;

    // KFA 쪽 팀 순서가 우리 homeTeam/awayTeam 순서와 같은지 확인해서 스코어를 올바른 쪽에 매긴다.
    const aIsHome = cached.homeTeam.name === row.teamA.name;
    const homeScore = aIsHome ? row.teamA.goals : row.teamB.goals;
    const awayScore = aIsHome ? row.teamB.goals : row.teamA.goals;
    const homePso = aIsHome ? row.teamA.pso : row.teamB.pso;
    const awayPso = aIsHome ? row.teamB.pso : row.teamA.pso;

    cached.status = "FINISHED";
    cached.score = {
      ...cached.score,
      fullTime: { home: homeScore, away: awayScore },
      penalty: { home: homePso ?? cached.score?.penalty?.home ?? null, away: awayPso ?? cached.score?.penalty?.away ?? null },
    };
    scoresChanged = true;
    console.log(`kfa 코리아컵 fallback 반영: ${cached.homeTeam.name} ${homeScore}-${awayScore} ${cached.awayTeam.name}`);
  }

  if (refsChanged) {
    await putJSON(env, KV_KEYS.kfaGameRefs, gameRefs);
  }
  if (scoresChanged) {
    await putJSON(env, KV_KEYS.matches, { matches: blob.matches, lastUpdated: new Date().toISOString() });
  }
}
