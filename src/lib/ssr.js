import { handleMatches } from "../routes/matches.js";
import { handleNews } from "../routes/news.js";

// 2026-11-12 - 애드센스 심사가 "게시자 콘텐츠가 없는 화면"으로 반려됐다. 원인은 이 앱이 완전히
// SPA(index.html은 뼈대만 있고 실제 경기/뉴스는 전부 JS가 /api로 따로 받아와서 채움)라서,
// JS를 끝까지 실행하지 않거나 타이밍이 안 맞는 크롤러한테는 "불러오는 중..." 로딩 문구만 있는
// 빈 페이지로 보였기 때문으로 추정된다. 루트(/) 요청만 가로채서, 오늘 경기 몇 개/최신 뉴스
// 몇 개를 서버에서 미리 간단한 HTML로 렌더링해 스켈레톤 자리에 꽂아넣는다 - 실제 사용자 경험은
// 그대로(어차피 JS가 로드되자마자 이 자리를 다시 자기 걸로 덮어씀), 크롤러/첫 페인트 기준으로만
// "콘텐츠 있는 페이지"가 되게 하는 목적이다.
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STATUS_KO = { IN_PLAY: "LIVE", PAUSED: "HT", FINISHED: "종료" };
const KST_TIME_ZONE = "Asia/Seoul";

// 2026-11-13 수정 - 실사용자도 JS가 뜨기 전 아주 잠깐 이 SSR 버전을 그대로 보게 된다는 제보("새로고침
// 하면 이상한 경기 목록이 떴다 사라진다") - 클럽 친선경기(FRIENDLY, 세계 각지 하부/유스팀 수십 개가
// 동시에 몰림)가 섞여 들어가면 눈에 확 띄게 어색해 보여서, SSR 미리보기에서는 아예 뺀다. 실제 앱의
// .match-row/.competition-group과 같은 CSS 클래스를 그대로 써서, 교체되는 순간에도 "다른 화면"처럼
// 안 보이고 자연스럽게 이어지게 한다.
function ssrStatusHtml(m) {
  if (m.status === "IN_PLAY" || m.status === "PAUSED") {
    return `<div class="match-status live">${escapeHtml(STATUS_KO[m.status] || "LIVE")}</div>`;
  }
  if (m.status === "FINISHED") return `<div class="match-status finished">종료</div>`;
  return `<div class="match-status scheduled">${escapeHtml(
    new Date(m.utcDate).toLocaleTimeString("ko-KR", { timeZone: KST_TIME_ZONE, hour: "2-digit", minute: "2-digit" })
  )}</div>`;
}

function ssrScoreHtml(m) {
  const home = m.score?.fullTime?.home;
  const away = m.score?.fullTime?.away;
  if (home === null || home === undefined) return `<div class="score-box">vs</div>`;
  const isLive = m.status === "IN_PLAY" || m.status === "PAUSED";
  return `<div class="score-box ${isLive ? "live-score" : ""}">${home}<span class="score-dash">:</span>${away}</div>`;
}

// frontend/js/format.js의 crestImg와 같은 폴백(깨진 이미지 아이콘 대신 ⚽ SVG) - 그쪽을 여기서
// import할 수 없어(프론트 전용 모듈) 같은 data URI를 그대로 복제해둔다.
const FALLBACK_CREST =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ctext y='18' font-size='18'%3E%E2%9A%BD%3C/text%3E%3C/svg%3E";

function ssrTeamHtml(team, side) {
  const src = team?.crest || FALLBACK_CREST;
  return `<div class="team ${side}">
    <img class="team-crest" src="${escapeHtml(src)}" onerror="this.src='${FALLBACK_CREST}'" alt="" />
    <span class="team-name">${escapeHtml(team?.shortName || team?.name || "")}</span>
  </div>`;
}

function matchRowHtml(m) {
  return `<div class="match-row">
    ${ssrStatusHtml(m)}
    ${ssrTeamHtml(m.homeTeam, "home")}
    ${ssrScoreHtml(m)}
    ${ssrTeamHtml(m.awayTeam, "away")}
  </div>`;
}

// 친선경기(FRIENDLY)는 제외하고, 대회별로 묶어서 실제 화면과 비슷한 순서로 보여준다 - 완벽히 같은
// 정렬일 필요는 없다(어차피 JS가 바로 이어받아 다시 그림), "친선경기 수십 개가 뒤죽박죽" 상태만 피하면 된다.
function matchesSectionHtml(matches) {
  const curated = matches.filter((m) => m.competition?.code !== "FRIENDLY");
  if (!curated.length) return "";

  const groups = new Map();
  for (const m of curated) {
    const key = m.competition?.code || m.competition?.name || "";
    if (!groups.has(key)) groups.set(key, { info: m.competition, matches: [] });
    groups.get(key).matches.push(m);
  }

  const FALLBACK_EMBLEM =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ctext y='18' font-size='18'%3E%F0%9F%8F%86%3C/text%3E%3C/svg%3E";

  return [...groups.values()]
    .map(
      (g) => `
    <div class="competition-group">
      <div class="competition-header">
        <span class="competition-header-link">
          <img class="competition-emblem" src="${escapeHtml(g.info?.emblem || FALLBACK_EMBLEM)}" onerror="this.src='${FALLBACK_EMBLEM}'" alt="" />
          <span class="competition-header-name">${escapeHtml(g.info?.name)}</span>
        </span>
        <span class="competition-header-count">${g.matches.length}</span>
      </div>
      ${g.matches.map(matchRowHtml).join("")}
    </div>
  `
    )
    .join("");
}

function newsRowHtml(n) {
  return `<a class="ssr-news-row" href="${escapeHtml(n.link)}" target="_blank" rel="noopener">${escapeHtml(n.title)}</a>`;
}

const SSR_CACHE_TTL_SECONDS = 60;

export async function renderServerShell(request, env) {
  const cache = caches.default;
  // 날짜가 바뀌면 자동으로 다른 캐시 키가 돼서 전날 경기가 안 남는다 - 시간대는 KST 기준(사용자 대부분).
  const kstDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const cacheKey = new Request(`https://ssr-shell.internal/${kstDate}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const indexRes = await env.ASSETS.fetch(new Request("http://assets.local/index.html"));
  let html = await indexRes.text();

  try {
    const [matchesRes, newsRes] = await Promise.all([
      handleMatches(request, env, new URL(request.url)),
      handleNews(request, env),
    ]);
    const { matches = [] } = await matchesRes.json();
    const { items: news = [] } = await newsRes.json();

    const matchesHtml = matchesSectionHtml(matches);
    if (matchesHtml) {
      html = html.replace('<div class="loading">경기 정보를 불러오는 중...</div>', matchesHtml);
    }
    if (news.length) {
      const newsHtml = news.slice(0, 10).map(newsRowHtml).join("");
      html = html.replace(
        '<div class="loading">뉴스를 불러오는 중...</div>',
        newsHtml
      );
    }
  } catch (err) {
    // 렌더링 실패해도 원본 index.html(로딩 문구뿐인 버전)이라도 그대로 나가게 한다 -
    // SSR은 어디까지나 보너스고, 이것 때문에 실제 사용자한테 빈 페이지가 나가면 안 된다.
    console.error("SSR shell render failed:", err);
  }

  const res = new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": `public, max-age=${SSR_CACHE_TTL_SECONDS}` },
  });
  await cache.put(cacheKey, res.clone());
  return res;
}
