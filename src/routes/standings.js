import { json } from "../lib/http.js";
import { getJSON } from "../lib/kv.js";
import { KV_KEYS, findCompetition } from "../lib/config.js";
import { applyLiveDeltas } from "../lib/liveStandings.js";
import { koreanizeTeam } from "../adapters/apiFootballAdapter.js";

// 팀 한글명 매핑을 나중에 추가/수정해도, 크론이 다시 갱신하기 전까지 KV에 예전 이름으로 남아있을 수
// 있는 순위표 캐시(API 한도 초과 등으로 특히 오래 걸릴 수 있음)를 응답 직전에 한 번 더 보정한다.
function reKoreanizeTable(table) {
  return (table || []).map((row) => ({ ...row, team: koreanizeTeam(row.team) }));
}

export async function handleStandings(request, env, code) {
  const comp = findCompetition(code);
  if (!comp) return json({ detail: "알 수 없는 대회 코드" }, 404);

  const [standingsBlob, matchesBlob] = await Promise.all([getJSON(env, KV_KEYS.standings), getJSON(env, KV_KEYS.matches)]);
  const data = standingsBlob?.byCode?.[code];
  if (!data) return json({ standings: [] });

  const withLive = {
    ...data,
    standings: (data.standings || []).map((t) => applyLiveDeltas({ ...t, table: reKoreanizeTable(t.table) }, matchesBlob?.matches, code)),
  };
  return json(withLive);
}
