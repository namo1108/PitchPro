import { json } from "../lib/http.js";
import { getJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";

export async function handleNews(request, env) {
  const cached = await getJSON(env, KV_KEYS.news);
  return json({ items: cached?.items || [], lastUpdated: cached?.lastUpdated || null });
}
