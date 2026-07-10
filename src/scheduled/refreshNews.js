import { fetchNewsFeed } from "../sources/newsRss.js";
import { normalizeNewsItem } from "../adapters/newsAdapter.js";
import { putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";

export async function refreshNews(env) {
  const items = await fetchNewsFeed();
  const news = items.map(normalizeNewsItem).filter((n) => n.title && n.link).slice(0, 30);
  if (news.length > 0) {
    await putJSON(env, KV_KEYS.news, { items: news, lastUpdated: new Date().toISOString() });
  }
}
