import { json } from "../lib/http.js";
import { getJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";

export async function handleHealth(request, env) {
  const [matches, standings] = await Promise.all([getJSON(env, KV_KEYS.matches), getJSON(env, KV_KEYS.standings)]);

  return json({
    status: "ok",
    cache: {
      matches: matches?.lastUpdated ?? null,
      standings: standings?.lastUpdated ?? null,
    },
  });
}
