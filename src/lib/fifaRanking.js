import { getJSON } from "./kv.js";
import { KV_KEYS } from "./config.js";

// FIFA 남자 국가대표팀 랭킹 조회 - scheduled/refreshFifaRanking.js가 채워둔 KV 캐시(211개국 전체 +
// 전월 대비 변동)에서 찾는다. 실제 수집/별칭 처리는 그 파일 참고.
export async function findFifaRanking(env, teamName) {
  if (!teamName) return null;
  const blob = await getJSON(env, KV_KEYS.fifaRanking);
  if (!blob?.byName) return null;
  return blob.byName[teamName.trim().toLowerCase()] || null;
}
