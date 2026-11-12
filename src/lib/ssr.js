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

function matchRowHtml(m) {
  const home = m.score?.fullTime?.home;
  const away = m.score?.fullTime?.away;
  const hasScore = home !== null && home !== undefined;
  const statusLabel =
    STATUS_KO[m.status] ||
    (m.status === "SCHEDULED" || m.status === "TIMED"
      ? new Date(m.utcDate).toLocaleTimeString("ko-KR", { timeZone: KST_TIME_ZONE, hour: "2-digit", minute: "2-digit" })
      : "");
  return `<div class="ssr-match-row">
    <span class="ssr-match-comp">${escapeHtml(m.competition?.name)}</span>
    <span class="ssr-match-teams">${escapeHtml(m.homeTeam?.shortName || m.homeTeam?.name)} ${hasScore ? home : ""} - ${hasScore ? away : ""} ${escapeHtml(m.awayTeam?.shortName || m.awayTeam?.name)}</span>
    <span class="ssr-match-status">${escapeHtml(statusLabel)}</span>
  </div>`;
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

    if (matches.length) {
      const matchesHtml = matches.slice(0, 30).map(matchRowHtml).join("");
      html = html.replace(
        '<div class="loading">경기 정보를 불러오는 중...</div>',
        matchesHtml
      );
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
