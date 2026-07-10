import { json } from "../lib/http.js";
import { getJSON } from "../lib/kv.js";
import { KV_KEYS, findCompetition } from "../lib/config.js";

export async function handleStandings(request, env, code) {
  const comp = findCompetition(code);
  if (!comp) return json({ detail: "알 수 없는 대회 코드" }, 404);

  const kvKey = comp.source === "thesportsdb" ? KV_KEYS.standingsKLeague : KV_KEYS.standingsFootballData;
  const blob = await getJSON(env, kvKey);
  const table = blob?.byCode?.[code];

  if (!table) return json({ standings: [] });
  return json(table);
}
