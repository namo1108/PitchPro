import { json } from "../lib/http.js";
import { getJSON } from "../lib/kv.js";
import { KV_KEYS, findCompetition } from "../lib/config.js";
import { applyLiveDeltas } from "../lib/liveStandings.js";

export async function handleStandings(request, env, code) {
  const comp = findCompetition(code);
  if (!comp) return json({ detail: "알 수 없는 대회 코드" }, 404);

  const [standingsBlob, matchesBlob] = await Promise.all([getJSON(env, KV_KEYS.standings), getJSON(env, KV_KEYS.matches)]);
  const data = standingsBlob?.byCode?.[code];
  if (!data) return json({ standings: [] });

  const withLive = {
    ...data,
    standings: (data.standings || []).map((t) => applyLiveDeltas(t, matchesBlob?.matches, code)),
  };
  return json(withLive);
}
