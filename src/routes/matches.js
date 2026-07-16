import { json } from "../lib/http.js";
import { getJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// UTC 새벽 시간대(한국 기준 오전) 경기가 하루 전 날짜로 새는 것을 막기 위해,
// 경기 시각을 KST로 환산한 달력 날짜로 비교한다(단순 UTC 문자열 slice는 사용하지 않음).
function toKstDateString(utcIso) {
  return new Date(new Date(utcIso).getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export async function handleMatches(request, env, url) {
  const date = url.searchParams.get("date") || toKstDateString(new Date().toISOString());

  const blob = await getJSON(env, KV_KEYS.matches);
  const matches = (blob?.matches || []).filter((m) => toKstDateString(m.utcDate) === date);

  return json({ matches });
}
