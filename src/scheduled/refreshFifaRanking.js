import { putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";

// FIFA 남자 국가대표팀 랭킹(211개국 전체 + 전월 대비 변동) - API-Football엔 이 데이터가 아예 없어서
// (2026-09-25 확인) FIFA 공식 사이트(inside.fifa.com)가 내부적으로 쓰는 비공개 API를 직접 부른다.
// 이 엔드포인트는 문서화된 공개 API가 아니라 언제든 바뀌거나 막힐 수 있다 - 그럴 땐 이 함수가 조용히
// 실패하고(KV에 이미 있던 예전 값을 그대로 유지) 관리자 알림 없이 넘어간다(월 1회만 갱신되는 데이터라
// 하루이틀 못 갱겨도 사용자 체감 영향이 작음). 실제 접근 방식은 오픈소스 스크립트
// (github.com/romainfjgaspard/pronostics_wc2026, fetch_fifa_ranking.py)에서 참고함 - 같은 방식으로
// FIFA 랭킹 페이지의 __NEXT_DATA__에서 최신 랭킹 날짜 id를 얻은 뒤, 그 id로 실제 랭킹 API를 부른다.
const RANKING_PAGE_URL = "https://inside.fifa.com/fifa-world-ranking/men";
const RANKING_API_BASE = "https://api.fifa.com/api/v3/fifarankings/rankings/rankingsbyschedule";
const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://inside.fifa.com/fifa-world-ranking/men",
  Origin: "https://inside.fifa.com",
};

// API-Football가 쓰는 국가명이 FIFA 공식 표기와 다른 경우가 꽤 있어서(전체 211개국을 하나하나
// 대조할 순 없어 자주 조회될 만한 나라 위주로) 양쪽 다 같은 랭킹을 찾을 수 있게 별칭을 매핑한다.
// 어떤 나라가 "안 나온다"는 제보가 오면 API-Football이 그 나라를 뭐라고 부르는지 확인해서 여기 추가.
const ALIASES = {
  "korea republic": "south korea",
  "ir iran": "iran",
  "côte d'ivoire": "ivory coast",
  "congo dr": "dr congo",
  "cabo verde": "cape verde",
  "china pr": "china",
  "dpr korea": "north korea",
  "the gambia": "gambia",
  "st. kitts and nevis": "saint kitts and nevis",
  "st. lucia": "saint lucia",
  "st. vincent / grenadines": "saint vincent and the grenadines",
  usa: "united states",
  türkiye: "turkey",
  "macau, china": "macau",
};

function normalizeName(name) {
  return (name || "").trim().toLowerCase();
}

async function getLatestScheduleId(env) {
  const res = await fetch(RANKING_PAGE_URL, { headers: { "User-Agent": FETCH_HEADERS["User-Agent"] } });
  if (!res.ok) throw new Error(`ranking page fetch failed: ${res.status}`);
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!match) throw new Error("__NEXT_DATA__ not found");
  const data = JSON.parse(match[1]);
  const dateGroups = data?.props?.pageProps?.pageData?.ranking?.dates;
  const latest = dateGroups?.[0]?.dates?.[0];
  if (!latest?.id) throw new Error("최신 랭킹 날짜 id를 못 찾음");
  return latest.id;
}

export async function refreshFifaRanking(env) {
  try {
    const scheduleId = await getLatestScheduleId(env);
    const url = `${RANKING_API_BASE}?rankingScheduleId=${scheduleId}&count=211&language=en`;
    const res = await fetch(url, { headers: FETCH_HEADERS });
    if (!res.ok) throw new Error(`ranking api fetch failed: ${res.status}`);
    const data = await res.json();
    const results = data.Results || [];
    if (results.length < 100) throw new Error(`응답이 너무 적음(${results.length}개) - 페이지 구조가 바뀌었을 수 있음`);

    const byName = {};
    for (const item of results) {
      const nameEntry = (item.TeamName || []).find((n) => n.Description);
      const name = nameEntry?.Description;
      if (!name) continue;
      const rank = Number(item.Rank);
      const prevRank = Number(item.PrevRank ?? item.Rank);
      if (!rank) continue;
      const key = normalizeName(name);
      const entry = { rank, change: prevRank - rank };
      byName[key] = entry;
      if (ALIASES[key]) byName[ALIASES[key]] = entry;
    }

    await putJSON(env, KV_KEYS.fifaRanking, { byName, updatedAt: new Date().toISOString() });
    console.log(`FIFA 랭킹 갱신 완료: ${results.length}개국`);
  } catch (err) {
    console.error("FIFA 랭킹 갱신 실패:", err);
  }
}
