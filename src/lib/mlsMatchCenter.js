import { getJSON, putJSON } from "./kv.js";
import { KV_KEYS } from "./config.js";
import { describeFormation } from "../adapters/apiFootballAdapter.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// API-Football은 MLS 라인업/통계를 안 준다(2026-08-23 확인 - 종료된 경기까지도 골 이벤트는 정상,
// 라인업/통계만 항상 빈 배열). mlssoccer.com은 각 경기 페이지 URL이
// "/competitions/mls-regular-season/{season}/matches/{홈팀약어}vs{원정팀약어}-{MM}-{DD}-{YYYY}/"
// 형태라, 우리 팀 이름을 이 사이트가 쓰는 약어로만 바꿀 수 있으면 그 페이지의 HTML에 박혀있는
// sportecId(예: "MLS-MAT-0009JJ")를 뽑아서 stats-api.mlssoccer.com/matches/{sportecId}로 바로
// 조회할 수 있다(그 안에 라인업 전체가 들어있음, 2026-08-23 브라우저 네트워크 탭에서 확인).
//
// 여기 약어는 사이트에서 실제 확인된 4개(lafc/por/rbny/chi) 외엔 일반적으로 통용되는 표기를
// 추정해 넣은 것 - 팀마다 실제 URL과 다를 수 있어 틀린 팀은 그냥 조용히 못 찾고 넘어간다(에러
// 아님, K3/K4 KFA 매핑도 처음엔 이렇게 시작해서 제보 받으며 고쳤다). 틀린 게 확인되면 여기 값만
// 고치면 된다.
const MLS_TEAM_SLUGS = {
  1595: "sea", // Seattle Sounders
  1596: "sj", // San Jose Earthquakes
  1597: "dal", // FC Dallas
  1598: "orl", // Orlando City SC
  1599: "phi", // Philadelphia Union
  1600: "hou", // Houston Dynamo
  1601: "tor", // Toronto FC
  1602: "rbny", // New York Red Bulls (사이트에서 확인됨)
  1603: "van", // Vancouver Whitecaps
  1605: "la", // LA Galaxy (사이트에서 확인됨, "lag" 아님)
  1606: "rsl", // Real Salt Lake
  1607: "chi", // Chicago Fire (사이트에서 확인됨)
  1610: "col", // Colorado Rapids
  1612: "min", // Minnesota United FC
  1613: "clb", // Columbus Crew
  1614: "mtl", // CF Montreal
  1615: "dc", // DC United
  1616: "lafc", // Los Angeles FC (사이트에서 확인됨)
  1617: "por", // Portland Timbers (사이트에서 확인됨)
  2242: "cin", // FC Cincinnati
  9568: "mia", // Inter Miami
  9569: "nsh", // Nashville SC
  16489: "atx", // Austin FC
  18310: "clt", // Charlotte FC
  20787: "stl", // St. Louis City
  25484: "sd", // San Diego FC
};

// mlssoccer.com 경기 URL의 날짜는 UTC가 아니라 미국 동부시간(America/New_York) 기준이다 - 예를 들어
// 킥오프가 UTC로는 08-23 02:30이어도(미국 저녁 경기가 자정을 넘겨서), 사이트 URL은 "08-22"를 쓴다
// (2026-08-23 실측 확인). DST 여부를 직접 계산하지 않고 Intl로 항상 정확한 동부 로컬 날짜를 구한다.
function toMlsUrlDate(utcIso) {
  const d = new Date(utcIso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type).value;
  const yyyy = get("year");
  return { mm: get("month"), dd: get("day"), yyyy, season: yyyy };
}

function buildMatchUrl(match) {
  const homeSlug = MLS_TEAM_SLUGS[match.homeTeam.id];
  const awaySlug = MLS_TEAM_SLUGS[match.awayTeam.id];
  if (!homeSlug || !awaySlug) return null;
  const { mm, dd, yyyy, season } = toMlsUrlDate(match.utcDate);
  return `https://www.mlssoccer.com/competitions/mls-regular-season/${season}/matches/${homeSlug}vs${awaySlug}-${mm}-${dd}-${yyyy}/`;
}

export async function findMlsSportecId(env, match) {
  const refs = (await getJSON(env, KV_KEYS.mlsGameRefs)) || {};
  const cached = refs[match.id];
  if (cached) return cached;

  const url = buildMatchUrl(match);
  if (!url) return null;

  try {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (!res.ok) return null;
    const html = await res.text();
    const idMatch = html.match(/&quot;matchSportecId&quot;:\s*&quot;([^&]+)&quot;/);
    if (!idMatch) return null;

    refs[match.id] = idMatch[1];
    await putJSON(env, KV_KEYS.mlsGameRefs, refs);
    return idMatch[1];
  } catch (err) {
    console.error("mlssoccer.com match page fetch failed:", err);
    return null;
  }
}

export async function fetchMlsMatchDetail(sportecId) {
  const res = await fetch(`https://stats-api.mlssoccer.com/matches/${sportecId}`, {
    headers: { "user-agent": UA, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`mls stats-api ${res.status}`);
  return res.json();
}

function normalizeMlsSide(side, apiFootballTeamId) {
  if (!side?.players?.length) return null;
  const toPlayer = (p) => ({
    id: p.person_id,
    name: p.short_name || `${p.first_name} ${p.last_name}`,
    number: p.shirt_number ?? null,
    position: p.playing_position || null,
    grid: null,
  });
  return {
    teamId: String(apiFootballTeamId),
    formation: side.latest_line_up || side.initial_line_up || null,
    formationStyle: describeFormation(side.latest_line_up || side.initial_line_up),
    colors: { player: side.player_shirt_main_color || null, goalkeeper: null },
    startXI: side.players.filter((p) => p.starting === "true" || p.starting === true).map(toPlayer),
    substitutes: side.players.filter((p) => !(p.starting === "true" || p.starting === true)).map(toPlayer),
    coach: (side.trainer_staff || []).find((s) => s.role === "headcoach")?.short_name || null,
  };
}

export function normalizeMlsLineups(data, match) {
  const home = normalizeMlsSide(data.home, match.homeTeam.id);
  const away = normalizeMlsSide(data.away, match.awayTeam.id);
  return [home, away].filter(Boolean);
}

// key_events는 페이지당 20개씩 잘려 나온다(next_page_token으로 이어붙여야 함, 2026-08-23 확인 -
// 37분 진행된 경기에서 이미 1페이지를 넘김). 한 경기가 이 페이지 수를 넘길 일은 거의 없지만
// (연장전 포함해도), 혹시 응답이 이상해서 토큰이 끝없이 나오는 경우를 대비해 상한을 둔다.
const MAX_KEY_EVENTS_PAGES = 10;

export async function fetchMlsKeyEvents(sportecId) {
  const events = [];
  let pageToken;
  for (let page = 0; page < MAX_KEY_EVENTS_PAGES; page++) {
    const url = new URL(`https://stats-api.mlssoccer.com/matches/${sportecId}/key_events`);
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!res.ok) throw new Error(`mls key_events ${res.status}`);
    const data = await res.json();
    events.push(...(data.events || []));
    if (!data.next_page_token) break;
    pageToken = data.next_page_token;
  }
  return events;
}

export async function fetchMlsPossession(sportecId) {
  const res = await fetch(`https://stats-api.mlssoccer.com/statistics/clubs/matches/${sportecId}/possession?scope=all`, {
    headers: { "user-agent": UA, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`mls possession ${res.status}`);
  const data = await res.json();
  // scope: "match"인 항목이 경기 전체 누적 점유율 - 나머지는 5분 구간별 세부 값이라 필요 없다.
  const matchEntry = (data.match_statistics_list || []).find((e) => e.match_statistics.scope === "match");
  return matchEntry?.match_statistics.team_statistics || [];
}

// 온타깃(유효슈팅) 판정: SavedShot(막힘)/SuccessfulShot(득점)은 골키퍼가 막았거나 들어갔다는 뜻이라
// "온타깃"으로 치고, ShotWide(빗나감)/BlockedShot(수비에 막힘)/OtherShot(불명확)은 제외한다 -
// API-Football의 shotsOnGoal 정의(유효슈팅 = 막히지 않고 골대 안으로 갔던 슈팅)와 맞춘 근사치다.
const ON_TARGET_SHOT_RESULTS = new Set(["SavedShot", "SuccessfulShot"]);

function roleToTeamId(role, match) {
  return role === "home" ? String(match.homeTeam.id) : String(match.awayTeam.id);
}

export function normalizeMlsStatistics(events, possession, match) {
  const homeId = String(match.homeTeam.id);
  const awayId = String(match.awayTeam.id);
  const acc = {
    [homeId]: { shotsOnGoal: 0, shotsTotal: 0, corners: 0, fouls: 0, yellowCards: 0, redCards: 0, saves: 0, xg: 0 },
    [awayId]: { shotsOnGoal: 0, shotsTotal: 0, corners: 0, fouls: 0, yellowCards: 0, redCards: 0, saves: 0, xg: 0 },
  };

  for (const { type, event: e } of events) {
    if (type === "shot_at_goals") {
      const teamId = roleToTeamId(e.team_role, match);
      const oppId = teamId === homeId ? awayId : homeId;
      acc[teamId].shotsTotal += 1;
      acc[teamId].xg += Number(e.xG) || 0;
      if (ON_TARGET_SHOT_RESULTS.has(e.shot_result)) acc[teamId].shotsOnGoal += 1;
      if (e.shot_result === "SavedShot") acc[oppId].saves += 1;
    } else if (type === "corner_kicks") {
      acc[roleToTeamId(e.team_role, match)].corners += 1;
    } else if (type === "fouls") {
      acc[roleToTeamId(e.team_fouler_role, match)].fouls += 1;
    } else if (type === "cards") {
      const teamId = roleToTeamId(e.team_role, match);
      if (e.card_color === "red") acc[teamId].redCards += 1;
      else acc[teamId].yellowCards += 1;
    }
  }

  const possessionByTeam = {};
  for (const p of possession || []) {
    const teamId = roleToTeamId(p.team_role, match);
    possessionByTeam[teamId] = Math.round(p.possession_ratio);
  }

  return [homeId, awayId].map((teamId) => {
    const s = acc[teamId];
    return {
      teamId,
      stats: {
        shotsOnGoal: s.shotsTotal ? s.shotsOnGoal : null,
        shotsTotal: s.shotsTotal || null,
        possession: possessionByTeam[teamId] != null ? `${possessionByTeam[teamId]}%` : null,
        corners: s.corners,
        fouls: s.fouls,
        yellowCards: s.yellowCards,
        redCards: s.redCards,
        saves: s.saves,
        passAccuracy: null,
        xg: s.shotsTotal ? Number(s.xg.toFixed(2)) : null,
      },
    };
  });
}
