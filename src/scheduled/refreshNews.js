import { fetchAllNewsFeeds } from "../sources/newsRss.js";
import { normalizeNewsItem } from "../adapters/newsAdapter.js";
import { putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";

export async function refreshNews(env) {
  const raw = await fetchAllNewsFeeds();
  const news = raw
    .map(normalizeNewsItem)
    .filter((n) => n.title && n.link)
    .sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0))
    .slice(0, 40);

  if (news.length > 0) {
    await putJSON(env, KV_KEYS.news, { items: news, lastUpdated: new Date().toISOString() });
  }
}
