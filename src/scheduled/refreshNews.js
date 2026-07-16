import { fetchAllNewsFeeds } from "../sources/newsRss.js";
import { normalizeNewsItem } from "../adapters/newsAdapter.js";
import { putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";

// BBC 피드 자체가 같은 기사를 카테고리 중복 등의 이유로 두 번씩 내려줄 때가 있어(link 기준 실제 확인됨),
// 링크 기준으로 한 번만 남긴다 - 안 그러면 목록에 똑같은 카드가 겹쳐 보인다.
function dedupeByLink(items) {
  const seen = new Set();
  return items.filter((n) => {
    if (seen.has(n.link)) return false;
    seen.add(n.link);
    return true;
  });
}

export async function refreshNews(env) {
  const raw = await fetchAllNewsFeeds();
  const news = dedupeByLink(
    raw
      .map(normalizeNewsItem)
      .filter((n) => n.title && n.link)
      .sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0))
  ).slice(0, 40);

  if (news.length > 0) {
    await putJSON(env, KV_KEYS.news, { items: news, lastUpdated: new Date().toISOString() });
  }
}
