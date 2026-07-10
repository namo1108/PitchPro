import { fetchJSON } from "../api.js";
import { onTabChange } from "../router.js";

const el = { list: document.getElementById("news-list") };

function formatPubDate(pubDate) {
  if (!pubDate) return "";
  const d = new Date(pubDate);
  return d.toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function loadNews() {
  el.list.innerHTML = '<div class="loading">뉴스를 불러오는 중...</div>';
  try {
    const data = await fetchJSON("/news");
    renderNews(data.items || []);
  } catch (err) {
    el.list.innerHTML = `<div class="error-state">뉴스를 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

function renderNews(items) {
  if (!items.length) {
    el.list.innerHTML = '<div class="empty-state">아직 뉴스가 없습니다.</div>';
    return;
  }

  el.list.innerHTML = items
    .map(
      (n) => `
    <a class="news-card" href="${n.link}" target="_blank" rel="noopener">
      <div class="news-title">${n.title}</div>
      ${n.description ? `<div class="news-desc">${n.description}</div>` : ""}
      <div class="news-date">${formatPubDate(n.pubDate)}</div>
    </a>
  `
    )
    .join("");
}

onTabChange("news", loadNews);
