import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import * as apiFootball from "../sources/apiFootball.js";
import {
  normalizeFixture,
  normalizeTeam,
  normalizeSquadPlayer,
  normalizeCoach,
  selectCurrentCoach,
  applyCoachOverride,
  applyManualCoachFallback,
  applySquadRemovals,
  koreanizeTeam,
} from "../adapters/apiFootballAdapter.js";
import {
  getKLeaguePlayerPhotoMap,
  lookupKLeaguePlayerPhoto,
  getKLeagueCoachPhotoMap,
  lookupKLeagueCoachPhoto,
} from "../lib/kleaguePlayerPhotos.js";
import { findKLeagueVenue } from "../lib/kleagueVenues.js";
import { lookupManualK3K4Squad } from "../lib/manualK3K4Squads.js";
import { lookupK3PhotoByNumber } from "../lib/k3PhotoOverrides.js";

const TEAM_CACHE_TTL_SECONDS = 600;
const TEAM_STALE_KEY_PREFIX = "team:stale:";

// 팀 한글명 매핑을 나중에 추가/수정해도, 캐시(10분)나 업스트림 장애 시 대체용 stale 캐시(TTL 없음)에
// 남아있는 예전 이름이 그대로 나가지 않도록 응답 직전에 한 번 더 보정한다.
function reKoreanize(result) {
  return {
    ...result,
    team: koreanizeTeam(result.team),
    recentMatches: (result.recentMatches || []).map((m) => ({ ...m, homeTeam: koreanizeTeam(m.homeTeam), awayTeam: koreanizeTeam(m.awayTeam) })),
    upcomingMatches: (result.upcomingMatches || []).map((m) => ({ ...m, homeTeam: koreanizeTeam(m.homeTeam), awayTeam: koreanizeTeam(m.awayTeam) })),
  };
}

async function buildTeam(env, teamId) {
  // teamId 자체가 유효한지 보여주는 teamRaw만 필수로 취급한다 - 나머지(최근/예정 경기, 스쿼드, 감독)는
  // 레이트리밋 등으로 하나만 실패해도 팀 상세 전체가 죽지 않도록 개별로 잡아서 빈 값으로 대체한다
  // (2026-08-08, API-Football 분당 한도에 걸려 팀 상세가 통째로 502 나던 문제 - 사용자 확인).
  const [teamRaw, recentRaw, upcomingRaw, squadRaw, coachRaw] = await Promise.all([
    apiFootball.getTeam(env, teamId),
    apiFootball.getTeamRecentFixtures(env, teamId, 10).catch(() => ({ response: [] })),
    apiFootball.getTeamUpcomingFixtures(env, teamId, 20).catch(() => ({ response: [] })),
    apiFootball.getSquad(env, teamId).catch(() => ({ response: [] })),
    apiFootball.getCoach(env, teamId).catch(() => null),
  ]);

  const teamInfo = teamRaw.response?.[0];
  if (!teamInfo) throw new Error("팀 정보를 찾을 수 없습니다.");

  const rawSquad = applySquadRemovals((squadRaw.response?.[0]?.players || []).map(normalizeSquadPlayer), teamId);
  const kleaguePhotos = await getKLeaguePlayerPhotoMap(env);
  const apiSquad = rawSquad.map((p) => {
    const kleagueOverride = lookupKLeaguePlayerPhoto(kleaguePhotos, teamId, p.number);
    if (kleagueOverride) return { ...p, photo: kleagueOverride };
    // 일부 K3 구단은 API-Football 스쿼드 자체는 정상인데 사진만 전부 비어있어서(시흥/창원/목포 확인,
    // 2026-08-08), 구단 공식 사이트에서 받은 사진을 등번호로 대조해 붙인다.
    const k3Override = lookupK3PhotoByNumber(teamId, p.number);
    return k3Override ? { ...p, photo: k3Override } : p;
  });
  // API-Football이 K3/K4는 스쿼드를 거의 안 줘서(팀 정보/일정만 있음), 비어있을 때 나무위키 기반
  // 수동 명단(manualK3K4Squads.js)으로 대체한다 - 사용자 요청, 2026-08-08.
  const squad = lookupManualK3K4Squad(teamId, apiSquad.length) || apiSquad;
  // API-Football의 K리그2 감독 사진은 깨진 방패 아이콘인 경우가 많아서(null이 아니라 URL 자체가
  // 플레이스홀더라 "없음" 판정으로는 못 거름), kleague 스크랩 사진을 먼저 깔고 그 위에 수동 보정을 얹는다.
  let baseCoach = normalizeCoach(selectCurrentCoach(coachRaw?.response, teamId));
  const kleagueCoachPhotos = await getKLeagueCoachPhotoMap(env);
  const coachPhotoOverride = lookupKLeagueCoachPhoto(kleagueCoachPhotos, teamId);
  if (baseCoach && coachPhotoOverride) baseCoach = { ...baseCoach, photo: coachPhotoOverride };
  // K3/K4는 API-Football이 감독 정보 자체가 없는 구단이 많아서, 비어있을 때만 나무위키 기반 이름으로
  // 채운다(있는 데이터는 절대 안 건드림 - applyManualCoachFallback 참고).
  const coach = applyManualCoachFallback(applyCoachOverride(baseCoach, teamId), teamId);

  return {
    team: normalizeTeam(teamInfo),
    recentMatches: (recentRaw.response || []).map(normalizeFixture),
    upcomingMatches: (upcomingRaw.response || []).map(normalizeFixture),
    squad,
    coach,
  };
}

export async function handleTeamDetail(request, env, id) {
  const cacheKey = `team:${id}`;
  const staleKey = `${TEAM_STALE_KEY_PREFIX}${id}`;
  // 경기장/티켓 정보는 API-Football 응답이 아니라 정적 설정(kleagueVenues.js)이라, 캐시된 팀 데이터에
  // 얼려 넣지 않고 응답 직전에 항상 최신 값을 덧붙인다(K리그가 아닌 팀은 그냥 null).
  const venue = findKLeagueVenue(id);

  const cached = await getJSON(env, cacheKey);
  if (cached) return json({ ...reKoreanize(cached), venue });

  try {
    const result = await buildTeam(env, id);
    await putJSON(env, cacheKey, result, { expirationTtl: TEAM_CACHE_TTL_SECONDS });
    await putJSON(env, staleKey, result); // TTL 없이 마지막 성공 응답을 보관 -> 업스트림 장애/레이트리밋 시 대체용
    return json({ ...reKoreanize(result), venue });
  } catch (err) {
    const stale = await getJSON(env, staleKey);
    if (stale) return json({ ...reKoreanize(stale), venue, stale: true });
    return json({ detail: String(err.message || err) }, 502);
  }
}
