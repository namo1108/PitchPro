import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS, LEADERBOARD_CACHE_TTL_SECONDS, LEADERBOARD_SIZE } from "../lib/config.js";
import { getAuthedUser, levelProgress } from "../lib/auth.js";

// 사용자 수가 많지 않은 개인 서비스 규모라, 매번 전체를 스캔하는 대신 5분 캐시로 부담을 줄인다.
// KV list는 한 번에 최대 1000개까지 나오는데, 명예의 전당 TOP 100 용도로는 충분하다.
async function computeLeaderboard(env) {
  const list = await env.CACHE.list({ prefix: KV_KEYS.userPrefix });
  const users = await Promise.all(list.keys.map((k) => getJSON(env, k.name)));
  return users
    .filter(Boolean)
    .sort((a, b) => (b.points || 0) - (a.points || 0))
    .slice(0, LEADERBOARD_SIZE)
    .map((u, i) => ({ rank: i + 1, nickname: u.nickname, points: u.points || 0, level: u.level || 1 }));
}

export async function handleLeaderboard(request, env) {
  const cached = await getJSON(env, KV_KEYS.leaderboardCache);
  let entries = cached?.entries;
  if (!entries) {
    entries = await computeLeaderboard(env);
    await putJSON(env, KV_KEYS.leaderboardCache, { entries }, { expirationTtl: LEADERBOARD_CACHE_TTL_SECONDS });
  }

  const user = await getAuthedUser(request, env);
  const me = user ? entries.find((e) => e.nickname === user.nickname) || { nickname: user.nickname, points: user.points || 0, level: user.level || 1, rank: null } : null;

  return json({ entries, me: me ? { ...me, progress: levelProgress(me.points) } : null });
}
