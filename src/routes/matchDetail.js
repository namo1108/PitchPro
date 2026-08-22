import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS, DETAIL_CACHE_TTL_SECONDS, LIVE_DETAIL_CACHE_TTL_SECONDS, findBroadcastLink } from "../lib/config.js";
import { findKLeagueVenue } from "../lib/kleagueVenues.js";
import * as apiFootball from "../sources/apiFootball.js";
import {
  normalizeFixture,
  normalizeGoalEvents,
  normalizeCardEvents,
  normalizeSubstitutionEvents,
  normalizeLineups,
  normalizeStatistics,
  normalizePlayerRatings,
  buildTacticalNote,
  applyPlayerPhotoOverride,
  koreanizeTeam,
} from "../adapters/apiFootballAdapter.js";
import { getKLeaguePlayerPhotoMap, lookupKLeaguePlayerPhoto } from "../lib/kleaguePlayerPhotos.js";
import {
  findKLeagueGameRef,
  fetchKLeagueMatchInfo,
  fetchKLeagueMatchRecord,
  fetchKLeagueMatchPageHtml,
  parseKLeagueLineups,
  normalizeKLeagueGoalEvents,
  normalizeKLeagueSubstitutions,
  normalizeKLeagueStatistics,
} from "../lib/kleagueMatchCenter.js";
import { findKfaGameRef, fetchKfaMatchDetail, parseKfaMatchDetail } from "../lib/kfaMatchCenter.js";

const LIVE_STATUSES = new Set(["IN_PLAY", "PAUSED"]);
const SQUAD_PHOTO_CACHE_TTL_SECONDS = 6 * 60 * 60; // 스쿼드 사진은 자주 안 바뀌어 넉넉히 캐싱
const KLEAGUE_CODES = new Set(["KL1", "KL2"]);
const KFA_CODES = new Set(["K3", "K4", "KFA"]); // KFA = 코리아컵(config.js 코드) - K3/K4와 같은 KFA 공식 사이트 폴백 대상

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

// API-Football이 실패하면(쿼터 소진 등) 경기 자체를 못 찾아 상세 페이지 전체가 죽는다 - 이미 목록
// 크론이 캐싱해둔 KV_KEYS.matches에서 같은 경기를 찾아 그걸로 대신한다(K리그는 kleague.com 폴백으로
// 이미 스코어/상태가 보정돼 있을 수 있음). 그래도 못 찾으면 그제서야 404를 낸다.
async function findFallbackMatch(env, id) {
  const blob = await getJSON(env, KV_KEYS.matches);
  const found = (blob?.matches || []).find((m) => String(m.id) === String(id));
  if (!found) return null;
  return { ...found, homeTeam: koreanizeTeam(found.homeTeam), awayTeam: koreanizeTeam(found.awayTeam) };
}

// kleague.com 사진 URL이 기본 플레이스홀더 파싱 중 도메인만 남고 끊기는 경우가 있어(사진 미보유
// 선수), 경로가 없는 값은 조용히 null로 처리한다(깨진 이미지 아이콘 노출 방지).
function safeKLeaguePhoto(url) {
  return url && url.length > "https://d2tfp74nsbbrkr.cloudfront.net".length ? url : null;
}

// K리그 매치센터(kleague.com) 폴백 - API-Football이 비어있는 부분만 채운다(이미 값이 있으면 손대지 않음).
async function fillFromKLeague(env, match) {
  if (!KLEAGUE_CODES.has(match.competition.code)) return;

  const ref = await findKLeagueGameRef(env, match.id);
  if (!ref) return;

  if (!match.goalEvents.length || !match.substitutions.length) {
    try {
      const matchInfo = await fetchKLeagueMatchInfo(ref);
      if (!match.goalEvents.length) match.goalEvents = normalizeKLeagueGoalEvents(matchInfo);
      if (!match.substitutions.length) match.substitutions = normalizeKLeagueSubstitutions(matchInfo);
    } catch (err) {
      console.error("kleague matchInfo fetch failed:", err);
    }
  }

  if (!match.statistics.length) {
    try {
      const matchRecord = await fetchKLeagueMatchRecord(ref);
      match.statistics = normalizeKLeagueStatistics(matchRecord, match.homeTeam.id, match.awayTeam.id);
    } catch (err) {
      console.error("kleague matchRecord fetch failed:", err);
    }
  }

  if (!match.lineups.length) {
    try {
      const html = await fetchKLeagueMatchPageHtml(ref);
      const lineups = parseKLeagueLineups(html, match.homeTeam.id, match.awayTeam.id);
      const subOffByPlayerName = new Map(match.substitutions.map((s) => [s.playerOut, s.minute]));
      lineups.forEach((lineup) => {
        [...lineup.startXI, ...lineup.substitutes].forEach((p) => {
          p.photo = safeKLeaguePhoto(p.photo);
          p.subbedOffMinute = subOffByPlayerName.get(p.name) || null;
        });
      });
      match.lineups = lineups;
      if (!match.tacticalNote) {
        match.tacticalNote = buildTacticalNote(lineups, match.homeTeam.id, match.homeTeam.name, match.awayTeam.name);
      }
    } catch (err) {
      console.error("kleague match.do lineup fetch failed:", err);
    }
  }
}

// KFA(대한축구협회) 공식 사이트 폴백 - K3/K4 전용(kleague.com과 무관한 별도 소스). API-Football은
// 이 리그들 라인업은 아예 안 주지만(config.js 주석 참고), 득점 이벤트는 가끔 채워져 있어도 선수명이
// 로마자로 깨져서 나온다(예: "지상욱"이 "Ji Sang-Wook"으로). KFA 쪽이 훨씬 정확한 공식 소스라서
// "비어있을 때만 채움"이 아니라 라인업/득점자/교체는 KFA 조회에 성공하면 항상 그걸로 덮어쓴다.
async function fillFromKfa(env, match) {
  if (!KFA_CODES.has(match.competition.code)) return;

  const ref = await findKfaGameRef(env, match.id);
  if (!ref) return;

  try {
    const html = await fetchKfaMatchDetail(ref);
    const parsed = parseKfaMatchDetail(html, match.homeTeam.id, match.awayTeam.id);
    if (parsed.lineups.length) match.lineups = parsed.lineups;
    if (parsed.goalEvents.length) match.goalEvents = parsed.goalEvents;
    if (parsed.substitutions.length) match.substitutions = parsed.substitutions;
  } catch (err) {
    console.error("kfa match detail fetch failed:", err);
  }
}

// 목록 크론 캐시에는 venue/득점자/라인업/스탯이 없으므로, 상세 조회는 클릭 시점에
// 업스트림을 직접 불러 짧은 TTL로 캐싱한다. 라이브·예정 경기는 캐싱하지 않고 매번 새로 불러온다
// (라인업은 킥오프 1시간 전쯤 API-Football에 올라오므로 그때그때 최신 상태를 봐야 한다).
export async function handleMatchDetail(request, env, id) {
  const cacheKey = `${KV_KEYS.detailPrefix}${id}`;
  const cached = await getJSON(env, cacheKey);
  if (cached) return json(cached);

  let match;
  try {
    const raw = await apiFootball.getFixture(env, id);
    const fixture = raw.response?.[0];
    if (!fixture) return json({ detail: "경기를 찾을 수 없습니다." }, 404);
    match = normalizeFixture(fixture);
  } catch (err) {
    console.error("fixture fetch failed, K리그 캐시 폴백으로 시도:", err);
    match = await findFallbackMatch(env, id);
    if (!match) return json({ detail: "경기를 찾을 수 없습니다." }, 404);
  }

  const isLive = LIVE_STATUSES.has(match.status);
  const isFinished = match.status === "FINISHED";

  match.goalEvents = [];
  match.substitutions = [];
  match.statistics = [];
  match.lineups = [];
  match.tacticalNote = null;

  // 예전엔 이벤트/통계/평점/라인업을 하나씩 순서대로(각각 API-Football 왕복 1회) 기다려서, 상세
  // 화면을 여는 데 그 개수만큼 지연이 누적됐다("라인업이 유독 늦게 뜬다"는 제보 - 사실 이 넷 중
  // 마지막 순서라 그랬을 뿐, 서로 결과를 필요로 하지 않는 독립적인 조회라 병렬로 불러도 된다).
  // 동시에 불러서 가장 느린 호출 하나만큼만 기다리면 되게 바꿨다.
  let ratingsMap = {};
  let hadFetchError = false;

  const fetchTasks = [
    apiFootball
      .getFixtureLineups(env, id)
      .then((lineupsRaw) => {
        match.lineups = normalizeLineups(lineupsRaw.response);
        match.tacticalNote = buildTacticalNote(match.lineups, match.homeTeam.id, match.homeTeam.name, match.awayTeam.name);
      })
      .catch((err) => {
        console.error("fixture lineups fetch failed:", err);
        hadFetchError = true;
      }),
  ];

  if (isLive || isFinished) {
    fetchTasks.push(
      apiFootball
        .getFixtureEvents(env, id)
        .then((eventsRaw) => {
          match.goalEvents = normalizeGoalEvents(eventsRaw.response);
          match.cardEvents = normalizeCardEvents(eventsRaw.response);
          match.substitutions = normalizeSubstitutionEvents(eventsRaw.response);
        })
        .catch((err) => {
          console.error("fixture events fetch failed:", err);
          hadFetchError = true;
        }),
      apiFootball
        .getFixtureStatistics(env, id)
        .then((statsRaw) => {
          match.statistics = normalizeStatistics(statsRaw.response);
        })
        .catch((err) => {
          console.error("fixture statistics fetch failed:", err);
          hadFetchError = true;
        }),
      apiFootball
        .getFixturePlayers(env, id)
        .then((playersRaw) => {
          ratingsMap = normalizePlayerRatings(playersRaw.response);
        })
        .catch((err) => {
          console.error("fixture player ratings fetch failed:", err);
          hadFetchError = true;
        })
    );
  }

  await Promise.all(fetchTasks);

  // 라인업은 킥오프 전(발표된 경우)/라이브/종료 모두에서 의미가 있어 상태와 무관하게 위에서 항상 시도했다.
  if (match.lineups.length >= 2) {
    try {
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
    } catch (err) {
      console.error("lineup player photo/rating enrichment failed:", err);
    }
  }

  // API-Football 쪽이 쿼터 소진 등으로 비어있는 항목(득점/교체/통계/라인업)만, K리그에 한해
  // kleague.com 매치센터로 채운다 - 이미 값이 있으면 건드리지 않는다.
  await fillFromKLeague(env, match);
  // K3/K4는 API-Football이 애초에 득점자/라인업을 안 주므로 KFA 공식 사이트로 채운다.
  await fillFromKfa(env, match);

  // 목록(routes/matches.js)에서만 붙이고 여기선 빠뜨려서, 목록에서 받은 캐시로 먼저 그린 상세 화면엔
  // 중계/티켓 버튼이 보였다가 이 상세 응답으로 다시 그려지는 순간 사라지는 버그가 있었다 - 목록과
  // 똑같은 방식으로 여기서도 붙여준다.
  const venue = findKLeagueVenue(match.homeTeam.id);
  const broadcast = findBroadcastLink(match.competition.code, match.matchday);
  if (venue) match.ticketUrl = venue.ticketUrl;
  if (broadcast) {
    match.broadcastUrl = broadcast.url;
    match.broadcastProvider = broadcast.provider;
  }

  if (isFinished) {
    await putJSON(env, cacheKey, match, { expirationTtl: DETAIL_CACHE_TTL_SECONDS });
  } else if (isLive && !hadFetchError) {
    await putJSON(env, cacheKey, match, { expirationTtl: LIVE_DETAIL_CACHE_TTL_SECONDS });
  }
  return json(match);
}
