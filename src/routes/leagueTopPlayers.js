import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import { findCompetition } from "../lib/config.js";
import * as apiFootball from "../sources/apiFootball.js";
import { normalizeTopPlayers } from "../adapters/apiFootballAdapter.js";
import { getManualTopPlayers } from "../lib/manualTopPlayers.js";

const TOP_PLAYERS_CACHE_TTL_SECONDS = 3600;

// 득점왕/도움왕은 대회 화면에서 클릭했을 때만 필요해서(크론이 아니라) 온디맨드로 불러와 1시간 캐싱한다.
export async function handleLeagueTopPlayers(request, env, code) {
  const comp = findCompetition(code);
  if (!comp) return json({ detail: "알 수 없는 대회 코드" }, 404);

  // K3/K4는 API-Football에 득점/도움 통계가 없어(K4는 0건) KFA 사이트 주간 스크랩 결과를 대신 쓴다.
  // 매주 갱신되는 데이터라 별도 캐시 없이 KV에서 바로 읽어(최신 스크랩 결과가 즉시 반영되도록).
  const manual = await getManualTopPlayers(env, code);
  if (manual) return json(manual);

  const cacheKey = `topplayers:${code}`;
  const cached = await getJSON(env, cacheKey);
  if (cached) return json(cached);

  const [scorersRaw, assistsRaw] = await Promise.all([
    apiFootball.getTopScorers(env, comp.apiFootballLeagueId, comp.apiFootballSeason).catch(() => null),
    apiFootball.getTopAssists(env, comp.apiFootballLeagueId, comp.apiFootballSeason).catch(() => null),
  ]);

  const result = {
    topScorers: normalizeTopPlayers(scorersRaw?.response, "total").slice(0, 10),
    topAssists: normalizeTopPlayers(assistsRaw?.response, "assists").slice(0, 10),
  };

  await putJSON(env, cacheKey, result, { expirationTtl: TOP_PLAYERS_CACHE_TTL_SECONDS });
  return json(result);
}
