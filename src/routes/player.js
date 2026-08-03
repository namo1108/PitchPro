import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import * as apiFootball from "../sources/apiFootball.js";
import { normalizePlayerDetail, normalizeTransfer, normalizePlayerSeasonStats, koreanizeTeamNameOnly } from "../adapters/apiFootballAdapter.js";

const PLAYER_CACHE_TTL_SECONDS = 3600;
const STATS_SEASONS = [2026, 2025];

// K리그 팀 한글명 매핑을 나중에 추가/수정해도, 이미 캐시된(최대 1시간) 응답이 예전 이름을 들고 있지
// 않도록 응답 직전에 한 번 더 보정한다(팀 id가 없는 이름 문자열이라 이름 기준 매칭만 가능).
function reKoreanize(result) {
  if (result.player) result.player.team = koreanizeTeamNameOnly(result.player.team);
  if (result.formerTeams) result.formerTeams = result.formerTeams.map((t) => ({ ...t, team: koreanizeTeamNameOnly(t.team) }));
  return result;
}

export async function handlePlayerDetail(request, env, id) {
  const cacheKey = `player:${id}`;
  const cached = await getJSON(env, cacheKey);
  if (cached) return json(reKoreanize(cached));

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

