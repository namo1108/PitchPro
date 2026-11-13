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
// K리그1/2·5대리그·UEFA 클럽대항전 + 국가대표 경기(A매치/네이션스리그 등) 한정(골 득점자 표시,
// 캘린더 우선순위와 같은 기준) - 범위를 넓히면 하루에도 경기가 너무 많아 의미 없는 하위리그/친선경기
// 까지 다 뜬다. 국가대표를 포함한 건(2026-11-12), 빼놓으면 지금 같은 A매치 기간엔 클럽 경기가 거의
// 없어서 섹션이 통째로 비어 보였기 때문("하이라이트 영상은?" 제보).
// 대회 코드 -> 카테고리. 쌓일수록 한눈에 안 들어온다는 제보(2026-11-13)로 탭을 나눴다 - 전체 하이라이트
// 범위(HIGHLIGHT_CODES)는 그대로 두고, 탭은 그 안에서만 다시 나누는 필터라 서버 호출은 안 늘어난다.
const HIGHLIGHT_CATEGORY = {
  INTFRIENDLY: "national", UNL: "national", CNL: "national", EC: "national", WC: "national", ACUP: "national", AG: "national",
  KL1: "kleague", KL2: "kleague",
  PL: "overseas", PD: "overseas", BL1: "overseas", SA: "overseas", FL1: "overseas", CL: "overseas", EL: "overseas", ECL: "overseas",
};
const HIGHLIGHT_CODES = new Set(Object.keys(HIGHLIGHT_CATEGORY));
// 국가대표 친선경기는 전 세계 거의 모든 나라가 A매치 기간에 한꺼번에 뛰어서(우즈베키스탄 vs 러시아,
// 몰타 vs 에스와티니처럼), 코드만으로 거르면 축구 비인기국 경기까지 다 쏟아진다는 제보(2026-11-13 -
// "이게 너무 지저분하잖아"). 대한민국은 무조건 포함하고, 그 외엔 월드컵 단골/주요 축구 강국일 때만
// 보여준다 - 완벽한 목록은 아니지만 "낯선 나라끼리 경기"는 걸러진다. U20/U23 등 연령별 대표팀도 뺀다.
const NOTABLE_NATIONS = new Set([
  "대한민국", "south korea", "korea republic",
  "일본", "japan", "브라질", "brazil", "아르헨티나", "argentina", "프랑스", "france", "잉글랜드", "england",
  "스페인", "spain", "독일", "germany", "이탈리아", "italy", "포르투갈", "portugal", "네덜란드", "netherlands",
  "벨기에", "belgium", "크로아티아", "croatia", "우루과이", "uruguay", "콜롬비아", "colombia", "멕시코", "mexico",
  "미국", "usa", "united states", "모로코", "morocco", "세네갈", "senegal", "나이지리아", "nigeria", "가나", "ghana",
  "사우디아라비아", "saudi arabia", "이란", "iran", "호주", "australia", "카타르", "qatar", "덴마크", "denmark",
  "스위스", "switzerland", "폴란드", "poland", "세르비아", "serbia", "오스트리아", "austria", "스웨덴", "sweden",
  "노르웨이", "norway", "웨일스", "wales", "스코틀랜드", "scotland", "우크라이나", "ukraine", "튀르키예", "turkey",
  "그리스", "greece", "체코", "czech republic", "러시아", "russia", "캐나다", "canada", "에콰도르", "ecuador",
  "칠레", "chile", "페루", "peru", "파라과이", "paraguay", "튀니지", "tunisia", "알제리", "algeria",
  "카메룬", "cameroon", "코트디부아르", "ivory coast", "남아프리카공화국", "south africa", "중국", "china",
  "이라크", "iraq", "우즈베키스탄", "uzbekistan", "태국", "thailand", "베트남", "vietnam", "인도네시아", "indonesia",
]);

function isNotableNationalMatch(m) {
  const home = (m.homeTeam.name || "").toLowerCase();
  const away = (m.awayTeam.name || "").toLowerCase();
  if (/\bu-?1[5-9]\b|\bu-?2[0-3]\b/i.test(home) || /\bu-?1[5-9]\b|\bu-?2[0-3]\b/i.test(away)) return false;
  return NOTABLE_NATIONS.has(home) || NOTABLE_NATIONS.has(away);
}
const HIGHLIGHT_TABS = [
  { id: "all", label: "전체" },
  { id: "national", label: "국가대표" },
  { id: "kleague", label: "K리그" },
  { id: "overseas", label: "해외리그" },
];
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

let allHighlights = [];
let activeHighlightTab = "all";

function youtubeHighlightUrl(home, away) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${home} ${away} 하이라이트`)}`;
}

async function loadHighlights() {
  if (!el.highlights) return;
  try {
    const todayKst = new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
    const data = await fetchJSON(`/matches?date=${todayKst}`);
    allHighlights = (data.matches || [])
      .filter((m) => m.status === "FINISHED" && HIGHLIGHT_CODES.has(m.competition.code))
      .filter((m) => HIGHLIGHT_CATEGORY[m.competition.code] !== "national" || isNotableNationalMatch(m));
    renderHighlights();
  } catch {
    el.highlights.innerHTML = "";
  }
}

function filteredHighlights() {
  return activeHighlightTab === "all" ? allHighlights : allHighlights.filter((m) => HIGHLIGHT_CATEGORY[m.competition.code] === activeHighlightTab);
}

function renderHighlights() {
  if (!allHighlights.length) {
    el.highlights.innerHTML = "";
    return;
  }

  const matches = filteredHighlights();
  const tabsHtml = HIGHLIGHT_TABS
    // 경기가 하나도 없는 탭은 눌러도 빈 화면이라 아예 숨긴다("전체"는 항상 보여준다).
    .filter((t) => t.id === "all" || allHighlights.some((m) => HIGHLIGHT_CATEGORY[m.competition.code] === t.id))
    .map((t) => `<button type="button" class="highlight-tab ${t.id === activeHighlightTab ? "active" : ""}" data-highlight-tab="${t.id}">${t.label}</button>`)
    .join("");

  el.highlights.innerHTML = `
    <h2 class="section-title">🎬 오늘의 하이라이트</h2>
    <div class="highlight-tabs">${tabsHtml}</div>
    <div class="highlights-list">
      ${matches.length ? matches.map(highlightCardHtml).join("") : '<div class="empty-state">해당하는 경기가 없습니다.</div>'}
    </div>
  `;
  el.highlights.querySelectorAll("[data-highlight-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeHighlightTab = btn.dataset.highlightTab;
      renderHighlights();
    });
  });
  el.highlights.querySelectorAll("[data-match-id]").forEach((card) => {
    card.addEventListener("click", () => loadMatchDetail(card.dataset.matchId));
  });
}

function highlightCardHtml(m) {
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
}

onTabChange("news", loadNews);
onTabChange("news", loadHighlights);
