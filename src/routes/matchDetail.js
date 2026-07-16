import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS, DETAIL_CACHE_TTL_SECONDS } from "../lib/config.js";
import * as apiFootball from "../sources/apiFootball.js";
import {
  normalizeFixture,
  normalizeGoalEvents,
  normalizeSubstitutionEvents,
  normalizeLineups,
  normalizeStatistics,
  normalizePlayerRatings,
  buildTacticalNote,
  applyPlayerPhotoOverride,
} from "../adapters/apiFootballAdapter.js";
import { getKLeaguePlayerPhotoMap, lookupKLeaguePlayerPhoto } from "../lib/kleaguePlayerPhotos.js";

const LIVE_STATUSES = new Set(["IN_PLAY", "PAUSED"]);
const SQUAD_PHOTO_CACHE_TTL_SECONDS = 6 * 60 * 60; // 스쿼드 사진은 자주 안 바뀌어 넉넉히 캐싱

// 라인업(fixtures/lineups)에는 선수 사진/나이가 없어서, 팀 스쿼드 목록에서 id로 대조해 붙인다.
// 스쿼드 자체를 매번 새로 부르면 낭비라 별도 키로 6시간 캐싱한다.
async function getSquadInfoMap(env, teamId) {
  const cacheKey = `squadinfo:${teamId}`;
  const cached = await getJSON(env, cacheKey);
  if (cached) return cached;

  try {
    const raw = await apiFootball.getSquad(env, teamId);
    const map = {};
    for (const p of raw.response?.[0]?.players || []) {
      map[String(p.id)] = { photo: applyPlayerPhotoOverride(p.photo || null, p.id), age: p.age ?? null, number: p.number ?? null };
    }
    await putJSON(env, cacheKey, map, { expirationTtl: SQUAD_PHOTO_CACHE_TTL_SECONDS });
    return map;
  } catch {
    return {};
  }
}

// 목록 크론 캐시에는 venue/득점자/라인업/스탯이 없으므로, 상세 조회는 클릭 시점에
// 업스트림을 직접 불러 짧은 TTL로 캐싱한다. 라이브·예정 경기는 캐싱하지 않고 매번 새로 불러온다
// (라인업은 킥오프 1시간 전쯤 API-Football에 올라오므로 그때그때 최신 상태를 봐야 한다).
export async function handleMatchDetail(request, env, id) {
  const cacheKey = `${KV_KEYS.detailPrefix}${id}`;
  const cached = await getJSON(env, cacheKey);
  if (cached) return json(cached);

  const raw = await apiFootball.getFixture(env, id);
  const fixture = raw.response?.[0];
  if (!fixture) return json({ detail: "경기를 찾을 수 없습니다." }, 404);

  const match = normalizeFixture(fixture);
  const isLive = LIVE_STATUSES.has(match.status);
  const isFinished = match.status === "FINISHED";

  match.goalEvents = [];
  match.substitutions = [];
  match.statistics = [];
  match.lineups = [];
  match.tacticalNote = null;

  let ratingsMap = {};

  if (isLive || isFinished) {
    try {
      const eventsRaw = await apiFootball.getFixtureEvents(env, id);
      match.goalEvents = normalizeGoalEvents(eventsRaw.response);
      match.substitutions = normalizeSubstitutionEvents(eventsRaw.response);
    } catch (err) {
      console.error("fixture events fetch failed:", err);
    }

    try {
      const statsRaw = await apiFootball.getFixtureStatistics(env, id);
      match.statistics = normalizeStatistics(statsRaw.response);
    } catch (err) {
      console.error("fixture statistics fetch failed:", err);
    }

    try {
      const playersRaw = await apiFootball.getFixturePlayers(env, id);
      ratingsMap = normalizePlayerRatings(playersRaw.response);
    } catch (err) {
      console.error("fixture player ratings fetch failed:", err);
    }
  }

  // 라인업은 킥오프 전(발표된 경우)/라이브/종료 모두에서 의미가 있어 상태와 무관하게 시도한다.
  try {
    const lineupsRaw = await apiFootball.getFixtureLineups(env, id);
    match.lineups = normalizeLineups(lineupsRaw.response);
    match.tacticalNote = buildTacticalNote(match.lineups, match.homeTeam.id, match.homeTeam.name, match.awayTeam.name);

    if (match.lineups.length >= 2) {
      const [homeMap, awayMap] = await Promise.all([
        getSquadInfoMap(env, match.homeTeam.id),
        getSquadInfoMap(env, match.awayTeam.id),
      ]);
      const infoMap = { ...awayMap, ...homeMap };
      const subOffByPlayerName = new Map(match.substitutions.map((s) => [s.playerOut, s.minute]));
      const kleaguePhotos = await getKLeaguePlayerPhotoMap(env);

      match.lineups.forEach((lineup) => {
        [...lineup.startXI, ...lineup.substitutes].forEach((p) => {
          const info = infoMap[p.id];
          const kleagueOverride = lookupKLeaguePlayerPhoto(kleaguePhotos, lineup.teamId, p.number);
          p.photo = kleagueOverride || info?.photo || null;
          p.age = info?.age ?? null;
          p.rating = ratingsMap[p.id]?.rating ?? null;
          p.subbedOffMinute = subOffByPlayerName.get(p.name) || null;
        });
      });
    }
  } catch (err) {
    console.error("fixture lineups fetch failed:", err);
  }

  if (isFinished) {
    await putJSON(env, cacheKey, match, { expirationTtl: DETAIL_CACHE_TTL_SECONDS });
  }
  return json(match);
}
