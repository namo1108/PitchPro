import { fetchJSON } from "../api.js";
import { onTabChange } from "../router.js";
import { KST_TIME_ZONE, fadeIn, skeletonList } from "../format.js";

const el = { list: document.getElementById("news-list") };

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
    renderNews(data.items || [], !loadedOnce);
    loadedOnce = true;
  } catch (err) {
    if (!loadedOnce) el.list.innerHTML = `<div class="error-state">뉴스를 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

const SOURCE_LABEL = { bbc: "해외", donga: "국내" };

function renderNews(items, animate) {
  if (!items.length) {
    el.list.innerHTML = '<div class="empty-state">아직 뉴스가 없습니다.</div>';
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

onTabChange("news", loadNews);
