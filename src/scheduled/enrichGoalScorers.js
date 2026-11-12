import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import * as apiFootball from "../sources/apiFootball.js";
import { normalizeGoalEvents } from "../adapters/apiFootballAdapter.js";

// 2026-11-12 사용자 피드백("경기를 다 챙겨보진 않아서 결과+득점자 정도만 경기 목록에서 바로 보고
// 싶다") - 경기 목록(메인 화면) 카드에 득점자를 보여주려면 매치마다 별도 이벤트 조회가 필요해서
// (지금 matches 캐시엔 스코어만 있고 득점자는 없음) API 호출이 그만큼 늘어난다. 레드카드 배지 때와
// 같은 비용 고민이라 사용자에게 범위를 직접 물어봤고, "라이브 포함 + K리그·5대리그·UEFA 클럽대항전만"
// 으로 정했다 - 전 세계 모든 경기에 다 붙이면 비용이 너무 커진다.
const GOAL_SUMMARY_CODES = new Set(["KL1", "KL2", "PL", "PD", "BL1", "SA", "FL1", "CL", "EL", "ECL"]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function enrichGoalScorers(env) {
  const blob = await getJSON(env, KV_KEYS.matches);
  const matches = blob?.matches || [];

  // 라이브는 골이 더 들어갈 수 있어 매번 다시 조회하고, 끝난 경기는 한 번 채웠으면 더 안 바뀌니
  // (득점자 목록은) 다시 조회하지 않는다 - 안 그러면 지난 경기들까지 매 틱 쓸데없이 다시 불러온다.
  const targets = matches.filter(
    (m) =>
      GOAL_SUMMARY_CODES.has(m.competition.code) &&
      ((m.status === "IN_PLAY" || m.status === "PAUSED") || (m.status === "FINISHED" && !m.goalEvents))
  );
  if (!targets.length) return;

  let changed = false;
  for (let i = 0; i < targets.length; i++) {
    if (i > 0) await sleep(250);
    try {
      const raw = await apiFootball.getFixtureEvents(env, targets[i].id, { retries: 1 });
      targets[i].goalEvents = normalizeGoalEvents(raw.response);
      changed = true;
    } catch (err) {
      console.error(`goal scorer enrich failed for match ${targets[i].id}:`, err);
    }
  }

  if (changed) await putJSON(env, KV_KEYS.matches, { matches, lastUpdated: blob?.lastUpdated || new Date().toISOString() });
}
