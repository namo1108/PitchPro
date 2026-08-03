import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import { fetchKfaRound } from "../lib/kfaMatchCenter.js";
import { notifyMatchEvents } from "./notifyMatchEvents.js";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const CODES = ["K3", "K4"];
const MAX_ROUNDS = 40; // 국내 세미프로 리그 특성상 이 라운드 수를 넘는 시즌은 없음(안전장치)

function toKstMonthDay(utcIso) {
  const d = new Date(new Date(utcIso).getTime() + KST_OFFSET_MS);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// K3/K4는 kleague.com처럼 팀 코드가 있는 JSON API가 없어 KFA 공식 사이트의 서버 렌더링 표를 그대로
// 긁는다(kfaMatchCenter.js). 라운드 번호가 날짜순이 아니라서(2026시즌 K3 20라운드가 21라운드보다
// 늦은 날짜) "최근 라운드부터 몇 개만" 훑는 방식은 못 쓰고, 1라운드부터 순서대로 훑다가 빈 라운드를
// 만나면(시즌 끝) 멈춘다. 요청량 자체는 작은 HTML 조각이라(리그당 최대 40회) 부담이 크지 않다.
export async function refreshKfaResults(env) {
  const blob = await getJSON(env, KV_KEYS.matches);
  if (!blob?.matches?.length) return;

  const pendingByKey = new Map();
  const allByKey = new Map();
  for (const m of blob.matches) {
    if (m.competition.code !== "K3" && m.competition.code !== "K4") continue;
    const key = `${m.competition.code}:${toKstMonthDay(m.utcDate)}:${m.homeTeam.name}:${m.awayTeam.name}`;
    allByKey.set(key, m);
    if (m.status !== "FINISHED") pendingByKey.set(key, m);
  }
  if (!allByKey.size) return;

  const gameRefs = (await getJSON(env, KV_KEYS.kfaGameRefs)) || {};
  let refsChanged = false;
  let scoresChanged = false;

  function processRows(code, rows) {
    for (const row of rows) {
      const key = `${code}:${row.date}:${row.homeName}:${row.awayName}`;
      const matched = allByKey.get(key);
      if (matched && row.idx) {
        const ref = { idx: row.idx, sIdx: row.sIdx, div: row.div };
        if (JSON.stringify(gameRefs[matched.id]) !== JSON.stringify(ref)) {
          gameRefs[matched.id] = ref;
          refsChanged = true;
        }
      }

      if (row.homeScore == null || row.awayScore == null) continue;
      const cached = pendingByKey.get(key);
      if (!cached) continue;

      cached.status = "FINISHED";
      cached.score = { ...cached.score, fullTime: { home: row.homeScore, away: row.awayScore } };
      scoresChanged = true;
      console.log(`kfa fallback 반영: ${code} ${row.homeName} ${row.homeScore}-${row.awayScore} ${row.awayName}`);
    }
  }

  for (const code of CODES) {
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      let rows;
      try {
        rows = await fetchKfaRound(code, round);
      } catch (err) {
        console.error(`kfa ${code} ${round}라운드 조회 실패:`, err);
        continue;
      }
      if (!rows.length) break; // 존재하지 않는 라운드 - 시즌 끝
      processRows(code, rows);
    }
  }

  if (refsChanged) {
    await putJSON(env, KV_KEYS.kfaGameRefs, gameRefs);
  }

  if (scoresChanged) {
    await putJSON(env, KV_KEYS.matches, { matches: blob.matches, lastUpdated: new Date().toISOString() });
    await notifyMatchEvents(env);
  }
}
