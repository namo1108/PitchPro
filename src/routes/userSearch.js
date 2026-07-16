import { json } from "../lib/http.js";
import { getJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import { getAuthedUser, userKey, levelProgress } from "../lib/auth.js";

const MAX_RESULTS = 8;

// 친구 추가 검색창용 - 닉네임 인덱스(nickname:<소문자>)를 접두사로 리스트한 뒤 부분 일치로 추린다.
// 로그인한 사용자만 다른 사람 닉네임을 검색할 수 있게 해서(무차별 스캔 방지), me.friends와 대조해
// 이미 추가한 친구는 표시로 구분해준다.
export async function handleUserSearch(request, env, url) {
  const me = await getAuthedUser(request, env);
  if (!me) return json({ detail: "로그인이 필요합니다." }, 401);

  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  if (q.length < 1) return json({ users: [] });

  const list = await env.CACHE.list({ prefix: KV_KEYS.nicknameIndexPrefix });
  const matchingKeys = list.keys.filter((k) => k.name.slice(KV_KEYS.nicknameIndexPrefix.length).includes(q));

  const usernames = await Promise.all(matchingKeys.map((k) => env.CACHE.get(k.name)));
  const users = await Promise.all(usernames.filter(Boolean).map((u) => getJSON(env, userKey(u))));

  const friendSet = new Set(me.friends || []);
  const outgoingSet = new Set(me.friendRequestsOutgoing || []);
  const incomingSet = new Set(me.friendRequestsIncoming || []);
  const results = users
    .filter(Boolean)
    .filter((u) => u.username !== me.username)
    .slice(0, MAX_RESULTS)
    .map((u) => ({
      nickname: u.nickname,
      level: levelProgress(u.points || 0, u.username).level,
      points: u.points || 0,
      isFriend: friendSet.has(u.username),
      requestSent: outgoingSet.has(u.username),
      requestReceived: incomingSet.has(u.username),
    }));

  return json({ users: results });
}
