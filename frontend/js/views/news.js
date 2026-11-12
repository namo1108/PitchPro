import { fetchJSON } from "../api.js";
import { onTabChange } from "../router.js";
import { KST_TIME_ZONE, fadeIn, skeletonList, crestImg } from "../format.js";
import { loadMatchDetail } from "./matches.js";

const el = {
  list: document.getElementById("news-list"),
  filterTabs: document.getElementById("news-filter-tabs"),
  highlights: document.getElementById("highlights-section"),
};

// 전체 받아온 뉴스를 들고 있다가 필터 탭 클릭 시 다시 서버에 안 물어보고 바로 걸러서 다시 그린다.
let allItems = [];
let activeFilter = "all";

function formatPubDate(pubDate) {
  if (!pubDate) return "";
  const d = new Date(pubDate);
  return d.toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: KST_TIME_ZONE });
}

// 이번 세션에 한 번 그려본 뒤로는 탭을 다시 눌러도 스켈레톤으로 비우지 않고 화면에 남겨둔 채
// 조용히 새로 받아와서 갈아끼운다 - 매번 탭 전환마다 깜빡이며 로딩되는 느낌을 없앤다.
let loadedOnce = false;

async function loadNews() {
  if (!loadedOnce) el.list.innerHTML = skeletonList(5);
  try {
    const data = await fetchJSON("/news");
    allItems = data.items || [];
    renderNews(filteredItems(), !loadedOnce);
    loadedOnce = true;
  } catch (err) {
    if (!loadedOnce) el.list.innerHTML = `<div class="error-state">뉴스를 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

function filteredItems() {
  return activeFilter === "all" ? allItems : allItems.filter((n) => n.source === activeFilter);
}

el.filterTabs?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-news-filter]");
  if (!btn) return;
  activeFilter = btn.dataset.newsFilter;
  el.filterTabs.querySelectorAll(".news-filter-tab").forEach((t) => t.classList.toggle("active", t === btn));
  renderNews(filteredItems(), false);
});

const SOURCE_LABEL = { bbc: "해외", donga: "국내" };

function renderNews(items, animate) {
  if (!items.length) {
    el.list.innerHTML = '<div class="empty-state">해당하는 뉴스가 없습니다.</div>';
    return;
  }

  el.list.innerHTML = items
    .map((n) => {
      const sourceLabel = SOURCE_LABEL[n.source] || "";
      return `
    <a class="news-card" href="${n.link}" target="_blank" rel="noopener">
      <div class="news-thumb">
        ${n.image ? `<img src="${n.image}" alt="" loading="lazy" onerror="this.parentElement.classList.add('news-thumb-empty');this.remove()" />` : ""}
      </div>
      <div class="news-body">
        <div class="news-title">${n.title}</div>
        <div class="news-meta">${sourceLabel ? `<span class="news-source-badge ${n.source}">${sourceLabel}</span>` : ""}<span class="news-date">${formatPubDate(n.pubDate)}</span></div>
      </div>
    </a>
  `;
    })
    .join("");

  // 재방문 시 조용히 갱신할 때는 이미 화면에 떠 있는 걸 다시 페이드인시키지 않는다(안 그러면 매번
  // 잠깐 사라졌다 나타나는 것처럼 보임) - 이번 세션 첫 로딩일 때만 페이드인한다.
  if (animate) fadeIn(el.list);
}

// ---------- 오늘의 하이라이트 (2026-11-12 사용자 요청) ----------
// "최신뉴스에서 그날 주요 경기 하이라이트를 유튜브/쿠팡플레이 등으로 볼 수 있게 해줘" - 공식 하이라이트
// API는 따로 없어서(저작권상 API-Football도 영상을 안 줌), 유튜브 검색 링크(팀명만 맞으면 거의 항상
// 뭔가는 나옴)를 기본으로 달고, 이미 중계 링크로 쓰고 있던 쿠팡플레이 허브 URL(config.js의
// findBroadcastLink, match.broadcastUrl로 이미 내려옴)이 있으면 "다시보기"로 같이 보여준다.
// K리그1/2·5대리그·UEFA 클럽대항전 한정(골 득점자 표시와 같은 기준) - 범위를 넓히면 하루에도 경기가
// 너무 많아 의미 없는 하위리그/친선경기까지 다 뜬다.
const HIGHLIGHT_CODES = new Set(["KL1", "KL2", "PL", "PD", "BL1", "SA", "FL1", "CL", "EL", "ECL"]);
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function youtubeHighlightUrl(home, away) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${home} ${away} 하이라이트`)}`;
}

async function loadHighlights() {
  if (!el.highlights) return;
  try {
    const todayKst = new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
    const data = await fetchJSON(`/matches?date=${todayKst}`);
    const matches = (data.matches || []).filter((m) => m.status === "FINISHED" && HIGHLIGHT_CODES.has(m.competition.code));
    renderHighlights(matches);
  } catch {
    el.highlights.innerHTML = "";
  }
}

function renderHighlights(matches) {
  if (!matches.length) {
    el.highlights.innerHTML = "";
    return;
  }

  el.highlights.innerHTML = `
    <h2 class="section-title">🎬 오늘의 하이라이트</h2>
    <div class="highlights-list">
      ${matches
        .map((m) => {
          const home = m.homeTeam.shortName || m.homeTeam.name;
          const away = m.awayTeam.shortName || m.awayTeam.name;
          const score = `${m.score.fullTime.home} - ${m.score.fullTime.away}`;
          return `
        <div class="highlight-card" data-match-id="${m.id}">
          <div class="highlight-teams">
            ${crestImg(m.homeTeam, "highlight-crest")}<span class="highlight-score">${home} ${score} ${away}</span>${crestImg(m.awayTeam, "highlight-crest")}
          </div>
          <div class="highlight-links">
            <a href="${youtubeHighlightUrl(home, away)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">▶ 유튜브에서 하이라이트</a>
            ${m.broadcastUrl ? `<a href="${m.broadcastUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${m.broadcastProvider}에서 다시보기</a>` : ""}
          </div>
        </div>
      `;
        })
        .join("")}
    </div>
  `;
  el.highlights.querySelectorAll("[data-match-id]").forEach((card) => {
    card.addEventListener("click", () => loadMatchDetail(card.dataset.matchId));
  });
}

onTabChange("news", loadNews);
onTabChange("news", loadHighlights);
