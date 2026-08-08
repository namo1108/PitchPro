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

const PLAYER_STALE_KEY_PREFIX = "player:stale:";

// 프로필 조회(getPlayerProfile)만 필수로 취급한다 - 이적/시즌별 스탯은 원래도 개별로 잡아 null
// 처리했지만, 정작 프로필 호출 하나가 실패하면(레이트리밋 등) try/catch가 아예 없어 이 라우트
// 전체가 처리되지 않은 예외로 죽었다(2026-08-08, team.js와 같은 원인으로 발견).
export async function handlePlayerDetail(request, env, id) {
  const cacheKey = `player:${id}`;
  const staleKey = `${PLAYER_STALE_KEY_PREFIX}${id}`;
  const cached = await getJSON(env, cacheKey);
  if (cached) return json(reKoreanize(cached));

  try {
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
    await putJSON(env, staleKey, result); // TTL 없이 마지막 성공 응답 보관 -> 업스트림 장애/레이트리밋 시 대체용
    return json(result);
  } catch (err) {
    const stale = await getJSON(env, staleKey);
    if (stale) return json({ ...reKoreanize(stale), stale: true });
    return json({ detail: String(err.message || err) }, 502);
  }
}

