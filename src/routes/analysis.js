import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS, COMPETITIONS, findCompetition } from "../lib/config.js";
import * as apiFootball from "../sources/apiFootball.js";
import { normalizeFixture, normalizeInjuries, normalizeOdds } from "../adapters/apiFootballAdapter.js";
import { buildMatchAnalysis } from "../lib/analysis.js";
import { getAdidasPointsByCode, findTeamAdidasPoint } from "../lib/kleagueAdidasPoints.js";

const ANALYSIS_CACHE_KEY = "analysis:v8";
const ANALYSIS_CACHE_TTL_SECONDS = 1200; // 20분
const MAX_CARDS = 8;
const MAX_LINK_ONLY = 12;
const CONCURRENCY = 6;

// AI 분석은 스포츠토토(베트맨) 승무패 대상으로 알려진 대회(config.js의 bettable: true)만 만든다.
// 그 외 리그/컵대회/친선경기는 문구를 억지로 만들지 않고 경기 목록에만 링크로 노출한다(handleAnalysis 하단 참고).
// 노출 슬롯이 8개뿐이라, 시간순으로만 뽑으면 그날 하필 빨리 킥오프하는 리그가 슬롯을 차지하고
// 정작 K리그나 유럽 빅리그가 밀려날 수 있어 "중요도 티어" 순으로 먼저 정렬한 뒤 같은 티어 안에서만 시간순으로 줄을 세운다.
// 0티어: K리그는 사용자 요청상 항상 최우선. 1티어: 월드컵/대륙간컵대회. 2티어: 유럽 5대리그.
const AI_ANALYSIS_TIERS = [
  ["KL1", "KL2"],
  ["WC", "CL", "EC"],
  ["PL", "PD", "BL1", "SA", "FL1"],
];
const BETTABLE_CODES = new Set(COMPETITIONS.filter((c) => c.bettable).map((c) => c.code));

function analysisTierRank(code) {
  const idx = AI_ANALYSIS_TIERS.findIndex((tier) => tier.includes(code));
  return idx === -1 ? AI_ANALYSIS_TIERS.length : idx;
}

// items를 동시에 CONCURRENCY개씩만 처리해서, 레이트리밋/서브리퀘스트 한도에 안전하게 API를 호출한다.
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function fetchTeamContext(env, teamId, season) {
  const [recentRaw, injuriesRaw] = await Promise.all([
    apiFootball.getTeamRecentFixtures(env, teamId, 5).catch(() => null),
    apiFootball.getTeamInjuries(env, teamId, season).catch(() => null),
  ]);
  return {
    recent: (recentRaw?.response || []).map(normalizeFixture),
    injuries: normalizeInjuries(injuriesRaw?.response),
  };
}

export async function handleAnalysis(request, env) {
  const cached = await getJSON(env, ANALYSIS_CACHE_KEY);
  if (cached) return json(cached);

  const [matchesBlob, standingsBlob] = await Promise.all([
    getJSON(env, KV_KEYS.matches),
    getJSON(env, KV_KEYS.standings),
  ]);
  const all = matchesBlob?.matches || [];
  const now = new Date();
  const horizon = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

  const withinHorizon = all
    .filter((m) => ["SCHEDULED", "TIMED"].includes(m.status))
    .filter((m) => new Date(m.utcDate) <= horizon);

  const upcoming = withinHorizon
    .filter((m) => BETTABLE_CODES.has(m.competition.code))
    .sort((a, b) => {
      const rankDiff = analysisTierRank(a.competition.code) - analysisTierRank(b.competition.code);
      return rankDiff !== 0 ? rankDiff : new Date(a.utcDate) - new Date(b.utcDate);
    })
    .slice(0, MAX_CARDS);

  // 베트맨 승무패 대상이 아닌 리그/컵대회/친선경기는 분석 문구 없이, 경기 상세로 넘어가는 링크 목록으로만 보여준다.
  const linkOnly = withinHorizon
    .filter((m) => !BETTABLE_CODES.has(m.competition.code))
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
    .slice(0, MAX_LINK_ONLY)
    .map((m) => ({
      matchId: m.id,
      competition: m.competition,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      utcDate: m.utcDate,
    }));

  // 카드별로 팀이 2개씩 나오므로, 중복 팀은 한 번만 조회하도록 모은다.
  const teamSeasons = new Map();
  for (const match of upcoming) {
    const season = findCompetition(match.competition.code)?.apiFootballSeason || now.getUTCFullYear();
    teamSeasons.set(match.homeTeam.id, season);
    teamSeasons.set(match.awayTeam.id, season);
  }
  const teamIds = Array.from(teamSeasons.keys());

  const contexts = await mapLimit(teamIds, CONCURRENCY, (teamId) => fetchTeamContext(env, teamId, teamSeasons.get(teamId)));

  const teamRecents = {};
  const teamInjuries = {};
  teamIds.forEach((teamId, i) => {
    teamRecents[teamId] = contexts[i].recent;
    teamInjuries[teamId] = contexts[i].injuries;
  });

  const cards = upcoming.map((match) => {
    const tables = standingsBlob?.byCode?.[match.competition.code]?.standings || [];
    // MLS(동/서부 컨퍼런스)처럼 그룹이 나뉜 리그는 두 팀이 서로 다른 그룹 표에 있을 수 있어
    // "TOTAL" 하나를 가정하지 않고, 팀별로 실제 그 팀이 들어있는 그룹 표를 찾는다.
    const findTeamTable = (teamId) => tables.find((t) => t.table?.some((r) => r.team.id === teamId)) || null;
    const standingsTables = { home: findTeamTable(match.homeTeam.id), away: findTeamTable(match.awayTeam.id) };
    return buildMatchAnalysis(match, teamRecents, standingsTables, teamInjuries);
  });

  // 배당률은 경기당 1회 호출이라 카드 목록과 별도로 동시성 제한을 걸어 조회한다(북메이커 미제공 시 조용히 null).
  const oddsList = await mapLimit(upcoming, CONCURRENCY, (match) =>
    apiFootball
      .getOdds(env, match.id)
      .then((raw) => normalizeOdds(raw.response))
      .catch(() => null)
  );
  cards.forEach((card, i) => {
    card.odds = oddsList[i];
  });

  // K리그 매치는 kleague.com 공식 파워랭킹(ADIDAS Point)을 곁들여서, 순위/최근폼 같은 범용 지표보다
  // 한 단계 더 정밀한(리그 공식) 근거를 하나 더 얹는다. 스크랩 데이터가 아직 없으면 조용히 생략.
  const adidasPointCache = new Map();
  for (const card of cards) {
    const code = card.competition.code;
    if (code !== "KL1" && code !== "KL2") continue;
    if (!adidasPointCache.has(code)) adidasPointCache.set(code, await getAdidasPointsByCode(env, code));
    const players = adidasPointCache.get(code);
    if (!players) continue;

    const homeTop = findTeamAdidasPoint(players, card.homeTeam);
    const awayTop = findTeamAdidasPoint(players, card.awayTeam);
    const officialNotes = [homeTop, awayTop]
      .filter(Boolean)
      .map(
        (p) =>
          `⚡ ${p.club} ${p.player}(${p.positionLabel})이(가) K리그 공식 파워랭킹(ADIDAS Point) ${p.point.toLocaleString()}점으로 최근 폼이 좋은 편입니다.`
      );
    if (officialNotes.length) card.officialNotes = officialNotes;
  }

  const result = { analysis: cards, linkOnly };
  await putJSON(env, ANALYSIS_CACHE_KEY, result, { expirationTtl: ANALYSIS_CACHE_TTL_SECONDS });
  return json(result);
}