import { fetchJSON } from "../api.js";
import { onTabChange } from "../router.js";
import { KST_TIME_ZONE, fadeIn, skeletonList } from "../format.js";

const el = { list: document.getElementById("news-list") };

function formatPubDate(pubDate) {
  if (!pubDate) return "";
  const d = new Date(pubDate);
  return d.toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: KST_TIME_ZONE });
}

async function loadNews() {
  el.list.innerHTML = skeletonList(5);
  try {
    const data = await fetchJSON("/news");
    renderNews(data.items || []);
  } catch (err) {
    el.list.innerHTML = `<div class="error-state">뉴스를 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

const SOURCE_LABEL = { bbc: "해외", donga: "국내" };

function renderNews(items) {
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

  fadeIn(el.list);
}

onTabChange("news", loadNews);
