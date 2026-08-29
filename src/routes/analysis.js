import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS, COMPETITIONS, findCompetition } from "../lib/config.js";
import * as apiFootball from "../sources/apiFootball.js";
import { normalizeFixture, normalizeInjuries } from "../adapters/apiFootballAdapter.js";
import { buildMatchAnalysis } from "../lib/analysis.js";
import { getAdidasPointsByCode, findTeamAdidasPoint } from "../lib/kleagueAdidasPoints.js";
import { fetchTeamRank, KLEAGUE_SITE_TEAM_ID_TO_APIFOOTBALL_ID } from "../scheduled/refreshKLeagueResults.js";

// v12: featured 대회 목록이 바뀌면(2026-08-29, K3/K4 제외 + 5대리그/FA컵 등 추가) 예전 필터로
// 만들어둔 캐시가 TTL(3시간) 동안 그대로 남아있으니, 버전을 올려서 즉시 새로 만들어지게 한다.
const ANALYSIS_CACHE_KEY = "analysis:v12";
// 사전 갱신 크론 주기(scheduled/index.js)의 2배로 넉넉하게 잡아서, 쿼터가 빡빡해 사전 갱신 틱이
// 한 번 건너뛰어져도(isQuotaTight) 다음 틱 전에 캐시가 만료되지 않게 한다(사용자 제보: "AI 분석
// 열 때 딜레이가 있다" - 콜드캐시로 직접 계산을 떠맡는 순간이 그 지연이다).
// 2026-08-11 카드 수를 6 -> 20으로 대폭 늘리면서(사용자 요청, "심화 분석이 승부처") 갱신 1회당
// 비용도 그만큼 커져서 - 사전 갱신 주기를 1시간 -> 90분으로 늘려 하루 총 호출량을 상쇄했다
// (기존 60분 주기/120분 TTL과 같은 "TTL = 주기 x 2" 비율 유지).
const ANALYSIS_CACHE_TTL_SECONDS = 10800; // 180분
// 2026-08-11 사용자 요청으로 6 -> 20 (카드당 최대 6콜 x 20장 = 120콜/갱신 + 링크 전용 최대 12콜
// ≈ 132콜/갱신, 90분 주기면 하루 최대 약 2,100콜 - Pro 플랜 일일 한도 7,500의 30% 미만으로 억제).
// 프론트(aiAnalysis.js)는 카드가 많아진 만큼 기본은 접어두고 눌러서 펼치는 방식으로 바꿨다.
const MAX_CARDS = 20;
const MAX_LINK_ONLY = 12;
const CONCURRENCY = 6;

// AI 분석은 주요 대회(config.js의 featured: true)만 만든다 - 팀당 조회 비용이 커서 전체 대회를
// 다 계산할 수 없다. 그 외 리그/컵대회/친선경기는 문구를 억지로 만들지 않고 경기 목록에만 링크로
// 노출한다(handleAnalysis 하단 참고).
// 2026-08-29 사용자 요청 - 스포츠토토가 실제로 다루는 대회 위주로 좁혔다(5대리그/챔스/유로파/
// 컨퍼런스/AFC챔스1·2/코리아컵/FA컵/카라바오컵 + K리그1·2). K3/K4/J리그/월드컵/유로/아시안컵은
// featured에서 뺐다(config.js 참고) - 몇 년에 한 번뿐인 국가대표 대회거나 토토 대상이 아님.
// 노출 슬롯이 몇 개뿐이라, 시간순으로만 뽑으면 그날 하필 빨리 킥오프하는 대회가 슬롯을 차지하고
// 정작 K리그가 밀려날 수 있어 "중요도 티어" 순으로 먼저 정렬한 뒤 같은 티어 안에서만 시간순으로 줄을 세운다.
// 0티어: K리그. 1티어: 챔피언스리그/AFC챔스 엘리트/5대리그. 2티어: 유로파(컨퍼런스)리그/코리아컵/FA컵/카라바오컵.
const AI_ANALYSIS_TIERS = [
  ["KL1", "KL2"],
  ["CL", "ACL", "PL", "PD", "BL1", "SA", "FL1"],
  ["EL", "ECL", "KFA", "FA", "EFL"],
];
const FEATURED_CODES = new Set(COMPETITIONS.filter((c) => c.featured).map((c) => c.code));

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

// 예전엔 최근 5경기만 봐서 표본이 얕았다("최근 폼 좋음"이 사실 2연승 우연일 수 있음) - 10경기로 늘려
// 훨씬 안정적인 폼 판단이 되게 한다(lib/analysis.js의 어조 판정도 절대 횟수가 아니라 승률 기준으로 맞춰둠).
async function fetchTeamContext(env, teamId, season) {
  const [recentRaw, injuriesRaw] = await Promise.all([
    apiFootball.getTeamRecentFixtures(env, teamId, 10).catch(() => null),
    apiFootball.getTeamInjuries(env, teamId, season).catch(() => null),
  ]);
  return {
    recent: (recentRaw?.response || []).map(normalizeFixture),
    injuries: normalizeInjuries(injuriesRaw?.response),
  };
}

async function fetchH2H(env, homeTeamId, awayTeamId) {
  const raw = await apiFootball.getHeadToHead(env, homeTeamId, awayTeamId, 5).catch(() => null);
  return (raw?.response || []).map(normalizeFixture);
}

// K리그 공식 사이트(kleague.com)의 팀 순위 데이터에는 최근 6경기 승/무/패(game01=최근)가 그대로
// 들어있다 - API-Football 표본(최근 10경기)과 별개로, 사용자가 실제 홈페이지에서 보는 것과 동일한
// "공식" 최근 폼을 한 번 더 보여줘서 신뢰도를 높인다. 코드/원문은 refreshKLeagueResults.js와 공유.
const KLEAGUE_RESULT_LETTER = { 승: "W", 무: "D", 패: "L" };

// K리그 매치(KL1/KL2)가 하나라도 있으면 그 대회들의 kleague.com 팀 순위표를 한 번씩만 받아
// {code -> {apiFootballId -> row}} 형태로 캐싱한다 - 아래 두 용도(보조 문구용 아이콘 노트, 폼 데이터가
// 아예 비었을 때의 대체 어조 판정)가 같은 fetch 결과를 나눠 쓰게 해서 중복 호출을 없앤다.
async function fetchKleagueRankMaps(codes) {
  const now = new Date();
  const rankByCode = new Map();
  for (const code of codes) {
    const leagueId = code === "KL1" ? 1 : 2;
    try {
      const teamRank = await fetchTeamRank(leagueId, now.getUTCFullYear());
      const byApiFootballId = new Map();
      for (const r of teamRank) {
        const apiFootballId = KLEAGUE_SITE_TEAM_ID_TO_APIFOOTBALL_ID[r.teamId];
        if (apiFootballId) byApiFootballId.set(apiFootballId, r);
      }
      rankByCode.set(code, byApiFootballId);
    } catch (err) {
      console.error(`kleague teamRank fetch failed for ${code}(분석용):`, err);
    }
  }
  return rankByCode;
}

// API-Football의 최근 10경기 조회가 신생 팀 id 매핑/시즌 초반 등의 이유로 비어서 "최근 경기 기록이
// 확인되지 않습니다"만 나오던 걸, kleague.com 공식 최근 6경기 승/무/패로 대신 판단하게 한다. 이
// 소스는 경기별 득점 정보가 없어(팀 순위표엔 시즌 누적 득실차만 있음) goalsFor/goalsAgainst는 0으로
// 채워둔다 - lib/analysis.js의 kleagueFormPhrase 템플릿은 애초에 그 값을 문장에 안 쓴다.
function kleagueFormFromRankRow(row) {
  if (!row) return null;
  const letters = ["game01", "game02", "game03", "game04", "game05", "game06"]
    .map((k) => row[k])
    .filter(Boolean)
    .map((g) => KLEAGUE_RESULT_LETTER[g])
    .filter(Boolean)
    .reverse(); // game01이 최근이라, teamForm()과 같은 "과거 -> 최근" 순서로 맞춘다(배열 끝이 최근).
  if (!letters.length) return null;
  return {
    wins: letters.filter((l) => l === "W").length,
    draws: letters.filter((l) => l === "D").length,
    losses: letters.filter((l) => l === "L").length,
    letters,
    goalsFor: 0,
    goalsAgainst: 0,
  };
}

function buildKleagueOfficialFormNotes(cards, rankByCode) {
  const kleagueCards = cards.filter((c) => c.competition.code === "KL1" || c.competition.code === "KL2");
  if (!kleagueCards.length) return;

  // 동그라미 아이콘(🟢⚪🔴)은 한눈에 승/무/패가 구분되지 않는다는 피드백으로, "승승무무패패"처럼
  // 결과를 그대로 텍스트로 이어 붙이는 방식으로 바꿨다(사용자 요청, 2026-08-08).
  const formNoteFor = (team, byApiFootballId) => {
    const r = byApiFootballId?.get(String(team.id));
    const games = ["game01", "game02", "game03", "game04", "game05", "game06"].map((k) => r?.[k]).filter(Boolean);
    if (!games.length) return null;
    return `${team.shortName || team.name} K리그 공식 최근 ${games.length}경기(최근순): ${games.join("")}`;
  };

  for (const card of kleagueCards) {
    const byApiFootballId = rankByCode.get(card.competition.code);
    if (!byApiFootballId) continue;
    const notes = [formNoteFor(card.homeTeam, byApiFootballId), formNoteFor(card.awayTeam, byApiFootballId)].filter(Boolean);
    if (notes.length) card.kleagueOfficialNotes = notes;
  }
}

// 실제 사용자 요청이 이 무거운 계산(팀당 2콜 + 카드당 H2H/배당 각 1콜 + K리그면 kleague.com 스크랩까지)을
// 직접 기다리지 않도록, scheduled/refreshAnalysis.js가 캐시 만료 전에 미리 이 함수를 불러 채워둔다.
// handleAnalysis는 캐시를 못 찾은 경우(배포 직후 등)에만 최후 수단으로 직접 계산한다.
export async function buildAnalysis(env) {
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
    .filter((m) => FEATURED_CODES.has(m.competition.code))
    .sort((a, b) => {
      const rankDiff = analysisTierRank(a.competition.code) - analysisTierRank(b.competition.code);
      return rankDiff !== 0 ? rankDiff : new Date(a.utcDate) - new Date(b.utcDate);
    })
    .slice(0, MAX_CARDS);

  // 주요 대회가 아닌 리그/컵대회/친선경기는 분석 문구 없이, 경기 상세로 넘어가는 링크 목록으로만 보여준다.
  const linkOnly = withinHorizon
    .filter((m) => !FEATURED_CODES.has(m.competition.code))
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

  // 팀 컨텍스트(최근폼/부상)·상대전적(H2H)은 서로 결과를 필요로 하지 않는 독립적인 조회라,
  // 예전엔 이걸 순서대로(하나 끝나면 다음 시작) 기다려서 냉캐시일 때 응답이 9초 가까이 걸렸다.
  // 둘 다 동시에 돌려서 가장 오래 걸리는 것 하나만큼만 기다리면 되게 바꿨다.
  const [contexts, h2hList] = await Promise.all([
    mapLimit(teamIds, CONCURRENCY, (teamId) => fetchTeamContext(env, teamId, teamSeasons.get(teamId))),
    // 상대전적(H2H)도 카드마다(팀 하나가 아니라 이번 매치업 자체가 기준) 조회해서 예측 근거에 포함시킨다.
    mapLimit(upcoming, CONCURRENCY, (match) => fetchH2H(env, match.homeTeam.id, match.awayTeam.id)),
  ]);

  const teamRecents = {};
  const teamInjuries = {};
  teamIds.forEach((teamId, i) => {
    teamRecents[teamId] = contexts[i].recent;
    teamInjuries[teamId] = contexts[i].injuries;
  });

  // K리그 매치가 있으면 kleague.com 팀 순위표를 먼저 받아둔다 - API-Football 최근폼이 비어있는 팀의
  // 대체 어조 판정(buildMatchAnalysis)과, 아래 보조 "공식 최근 6경기" 노트가 이 결과를 같이 쓴다.
  const kleagueCodes = new Set(upcoming.filter((m) => m.competition.code === "KL1" || m.competition.code === "KL2").map((m) => m.competition.code));
  const kleagueRankByCode = kleagueCodes.size ? await fetchKleagueRankMaps(kleagueCodes) : new Map();

  const cards = upcoming.map((match, i) => {
    const tables = standingsBlob?.byCode?.[match.competition.code]?.standings || [];
    // MLS(동/서부 컨퍼런스)처럼 그룹이 나뉜 리그는 두 팀이 서로 다른 그룹 표에 있을 수 있어
    // "TOTAL" 하나를 가정하지 않고, 팀별로 실제 그 팀이 들어있는 그룹 표를 찾는다.
    const findTeamTable = (teamId) => tables.find((t) => t.table?.some((r) => r.team.id === teamId)) || null;
    const standingsTables = { home: findTeamTable(match.homeTeam.id), away: findTeamTable(match.awayTeam.id) };
    const byApiFootballId = kleagueRankByCode.get(match.competition.code);
    const kleagueForms = byApiFootballId
      ? {
          home: kleagueFormFromRankRow(byApiFootballId.get(String(match.homeTeam.id))),
          away: kleagueFormFromRankRow(byApiFootballId.get(String(match.awayTeam.id))),
        }
      : {};
    return buildMatchAnalysis(match, teamRecents, standingsTables, teamInjuries, h2hList[i], kleagueForms);
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

  // K리그 카드에는 공식 사이트(kleague.com)의 최근 6경기 승/무/패 기록도 곁들인다(사용자가 실제
  // K리그 홈페이지에서 보는 것과 동일한 데이터라 신뢰도가 높다). 위에서 이미 받아둔 순위표를 그대로 쓴다.
  buildKleagueOfficialFormNotes(cards, kleagueRankByCode);

  const result = { analysis: cards, linkOnly };
  await putJSON(env, ANALYSIS_CACHE_KEY, result, { expirationTtl: ANALYSIS_CACHE_TTL_SECONDS });
  return result;
}

export async function handleAnalysis(request, env) {
  const cached = await getJSON(env, ANALYSIS_CACHE_KEY);
  if (cached) return json(cached);

  // 캐시가 없으면(배포 직후, 혹은 예정된 사전 갱신 크론이 아직 한 번도 안 돈 경우) 최후 수단으로
  // 지금 이 요청이 직접 계산한다 - 평소엔 scheduled/refreshAnalysis.js가 미리 채워둬서 여기까지 안 온다.
  const result = await buildAnalysis(env);
  return json(result);
}