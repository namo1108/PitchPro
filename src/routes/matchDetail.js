import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS, DETAIL_CACHE_TTL_SECONDS, K_LEAGUE_COMPETITIONS } from "../lib/config.js";
import * as footballData from "../sources/footballData.js";
import * as theSportsDb from "../sources/theSportsDb.js";
import { normalizeMatch } from "../adapters/footballDataAdapter.js";
import { normalizeEvent } from "../adapters/theSportsDbAdapter.js";

// 목록 크론 캐시에는 venue가 없으므로(벌크 응답이 필드를 안 줌), 상세 조회는
// 클릭 시점에 업스트림을 직접 불러 짧은 TTL로 캐싱한다(기존 Python 앱의 60초 캐시와 같은 패턴).
export async function handleMatchDetail(request, env, id) {
  const cacheKey = `${KV_KEYS.detailPrefix}${id}`;
  const cached = await getJSON(env, cacheKey);
  if (cached) return json(cached);

  const [source, rawId] = id.split(":");

  let normalized;
  if (source === "fd") {
    const raw = await footballData.getMatch(env, rawId);
    normalized = normalizeMatch(raw);
  } else if (source === "kl") {
    const raw = await theSportsDb.getEvent(env, rawId);
    const event = raw.events?.[0];
    if (!event) return json({ detail: "경기를 찾을 수 없습니다." }, 404);
    const comp = K_LEAGUE_COMPETITIONS.find((c) => String(c.theSportsDbLeagueId) === String(event.idLeague));
    normalized = normalizeEvent(event, comp || { code: "KL", name: event.strLeague });
  } else {
    return json({ detail: "알 수 없는 경기 id" }, 404);
  }

  await putJSON(env, cacheKey, normalized, { expirationTtl: DETAIL_CACHE_TTL_SECONDS });
  return json(normalized);
}
