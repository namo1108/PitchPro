import { json } from "../lib/http.js";
import { getJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";

export async function handleMatches(request, env, url) {
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);

  const [footballData, kLeague] = await Promise.all([
    getJSON(env, KV_KEYS.matchesFootballData),
    getJSON(env, KV_KEYS.matchesKLeague),
  ]);

  const all = [...(footballData?.matches || []), ...(kLeague?.matches || [])];
  const matches = all.filter((m) => m.utcDate.slice(0, 10) === date);

  return json({ matches });
}
