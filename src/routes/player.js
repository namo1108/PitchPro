import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import * as apiFootball from "../sources/apiFootball.js";
import { normalizePlayerDetail, normalizeTransfer, normalizePlayerSeasonStats } from "../adapters/apiFootballAdapter.js";

const PLAYER_CACHE_TTL_SECONDS = 3600;
const STATS_SEASONS = [2026, 2025];

export async function handlePlayerDetail(request, env, id) {
  const cacheKey = `player:${id}`;
  const cached = await getJSON(env, cacheKey);
  if (cached) return json(cached);

  const [profileRes, transfersRes, ...statsRes] = await Promise.all([
    apiFootball.getPlayerProfile(env, id),
    apiFootball.getPlayerTransfers(env, id).catch(() => null),
    ...STATS_SEASONS.map((season) => apiFootball.getPlayerStats(env, id, season).catch(() => null)),
  ]);

  const raw = profileRes.response?.[0]?.player;
  if (!raw) return json({ detail: "선수 정보를 찾을 수 없습니다" }, 404);

  const player = normalizePlayerDetail(raw);
  const allStatistics = statsRes.flatMap((r) => r?.response?.[0]?.statistics || []);
  player.team = allStatistics[0]?.team?.name || null;

  const result = {
    player,
    formerTeams: (transfersRes?.response?.[0]?.transfers || []).map(normalizeTransfer),
    seasonStats: normalizePlayerSeasonStats(allStatistics),
  };

  await putJSON(env, cacheKey, result, { expirationTtl: PLAYER_CACHE_TTL_SECONDS });
  return json(result);
}
