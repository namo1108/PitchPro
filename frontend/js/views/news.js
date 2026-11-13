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
// 2026-11-13: "국대도 친선경기/네이션스리그/월드컵/아시안컵/유로/프리미어리그 이런식으로 카테고리
// 나눠서 날짜별로 보여줘" - 국가대표 대회도 뭉뚱그리지 않고 대회별로 탭을 쪼개고, 하루치만 보면
// 탭이 거의 다 비어 보이니 최근 며칠(HIGHLIGHT_LOOKBACK_DAYS)치를 모아 날짜별로 묶어서 보여준다.
// 이 배열 하나로 탭 종류/순서/묶음을 관리한다 - codes가 여러 개면 그 코드들을 한 탭으로 합친다
// (UEFA/CONCACAF 네이션스리그처럼 사용자한테는 "네이션스리그" 하나로 보이면 충분한 경우).
const CATEGORY_DEFS = [
  { id: "wc", label: "월드컵", codes: ["WC"] },
  { id: "euro", label: "유로", codes: ["EC"] },
  { id: "acup", label: "아시안컵", codes: ["ACUP"] },
  { id: "ag", label: "아시안게임", codes: ["AG"] },
  { id: "nations", label: "네이션스리그", codes: ["UNL", "CNL"] },
  { id: "intfriendly", label: "국가대표 친선경기", codes: ["INTFRIENDLY"] },
  { id: "kleague", label: "K리그", codes: ["KL1", "KL2"] },
  { id: "pl", label: "프리미어리그", codes: ["PL"] },
  { id: "pd", label: "라리가", codes: ["PD"] },
  { id: "bl1", label: "분데스리가", codes: ["BL1"] },
  { id: "sa", label: "세리에A", codes: ["SA"] },
  { id: "fl1", label: "리그1", codes: ["FL1"] },
  { id: "cl", label: "챔피언스리그", codes: ["CL"] },
  { id: "el", label: "유로파리그", codes: ["EL"] },
  { id: "ecl", label: "컨퍼런스리그", codes: ["ECL"] },
];
const HIGHLIGHT_CODES = new Set(CATEGORY_DEFS.flatMap((c) => c.codes));
const CODE_TO_CATEGORY = new Map(CATEGORY_DEFS.flatMap((c) => c.codes.map((code) => [code, c.id])));
// 국가대표 "친선성" 대회(정식 친선경기·네이션스리그)만 비인기국 필터를 적용한다 - 월드컵/유로/
// 아시안컵/아시안게임은 이미 본선에 오른 팀들끼리만 붙어서 코드만으로도 거를 이유가 없다.
const FRIENDLY_LIKE_CODES = new Set(["INTFRIENDLY", "UNL", "CNL"]);
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
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
// 하루치만 보면 대부분의 탭이 비어 보여서(그날 경기가 몰린 2~3개 대회 외엔 전부 0경기), 최근
// 며칠을 모아 날짜별로 묶어서 보여준다. 너무 길게 가면 오히려 지저분해지니 3일로 제한.
const HIGHLIGHT_LOOKBACK_DAYS = 3;

let allHighlights = [];
let activeHighlightTab = "all";

function kstDateString(offsetDays = 0) {
  return new Date(Date.now() + KST_OFFSET_MS - offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function youtubeHighlightUrl(home, away) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${home} ${away} 하이라이트`)}`;
}

async function loadHighlights() {
  if (!el.highlights) return;
  try {
    const dates = Array.from({ length: HIGHLIGHT_LOOKBACK_DAYS }, (_, i) => kstDateString(i));
    const byDate = await Promise.all(
      dates.map((date) =>
        fetchJSON(`/matches?date=${date}`).then((data) => (data.matches || []).map((m) => ({ ...m, _highlightDate: date })))
      )
    );
    allHighlights = byDate
      .flat()
      .filter((m) => m.status === "FINISHED" && HIGHLIGHT_CODES.has(m.competition.code))
      .filter((m) => !FRIENDLY_LIKE_CODES.has(m.competition.code) || isNotableNationalMatch(m));
    renderHighlights();
  } catch {
    el.highlights.innerHTML = "";
  }
}

function filteredHighlights() {
  return activeHighlightTab === "all" ? allHighlights : allHighlights.filter((m) => CODE_TO_CATEGORY.get(m.competition.code) === activeHighlightTab);
}

function highlightDateLabel(dateStr, todayStr) {
  const label = new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short", timeZone: "UTC" });
  return dateStr === todayStr ? `오늘 · ${label}` : label;
}

function renderHighlights() {
  if (!allHighlights.length) {
    el.highlights.innerHTML = "";
    return;
  }

  const matches = filteredHighlights();
  const tabsHtml = [{ id: "all", label: "전체" }, ...CATEGORY_DEFS]
    // 경기가 하나도 없는 탭은 눌러도 빈 화면이라 아예 숨긴다("전체"는 항상 보여준다).
    .filter((t) => t.id === "all" || allHighlights.some((m) => CODE_TO_CATEGORY.get(m.competition.code) === t.id))
    .map((t) => `<button type="button" class="highlight-tab ${t.id === activeHighlightTab ? "active" : ""}" data-highlight-tab="${t.id}">${t.label}</button>`)
    .join("");

  const todayStr = kstDateString(0);
  const groups = new Map();
  for (const m of matches) {
    if (!groups.has(m._highlightDate)) groups.set(m._highlightDate, []);
    groups.get(m._highlightDate).push(m);
  }
  const groupsHtml = [...groups.keys()]
    .sort((a, b) => (a < b ? 1 : -1))
    .map(
      (date) => `
    <div class="highlight-date-group">
      <div class="highlight-date-label">${highlightDateLabel(date, todayStr)}</div>
      <div class="highlights-list">${groups.get(date).map(highlightCardHtml).join("")}</div>
    </div>
  `
    )
    .join("");

  el.highlights.innerHTML = `
    <h2 class="section-title">🎬 최근 하이라이트</h2>
    <div class="highlight-tabs">${tabsHtml}</div>
    ${matches.length ? groupsHtml : '<div class="empty-state">해당하는 경기가 없습니다.</div>'}
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
