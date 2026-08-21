import { json } from "../lib/http.js";
import { KV_KEYS } from "../lib/config.js";
import { getAuthedUser } from "../lib/auth.js";

// 토스 미니앱은 브라우저 구독 객체가 없어 anonKey(User.getAnonymousKey 해시값)로 수신자를 구분한다 -
// 이미 해시라 push.js의 hashEndpoint 같은 별도 해싱 없이 그대로 키에 쓴다.
export async function handleTossSubscribe(request, env) {
  const body = await request.json();
  if (!body?.anonKey) return json({ detail: "anonKey가 필요합니다." }, 400);

  const key = `${KV_KEYS.tossSubscriptionPrefix}${body.anonKey}`;
  const existingRaw = await env.CACHE.get(key);
  const existing = existingRaw ? JSON.parse(existingRaw) : null;

  const user = await getAuthedUser(request, env);

  try {
    await env.CACHE.put(
      key,
      JSON.stringify({
        anonKey: body.anonKey,
        teamIds: body.teamIds || existing?.teamIds || [],
        matchIds: existing?.matchIds || [],
        username: user?.username || existing?.username || null,
        updatedAt: new Date().toISOString(),
      })
    );
    if (user) await env.CACHE.put(`${KV_KEYS.tossUsernameIndexPrefix}${user.username}`, key);
  } catch (err) {
    console.error("toss subscribe write failed:", err);
    return json({ detail: "일시적으로 알림 설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요." }, 503);
  }
  return json({ status: "ok" });
}

// 즐겨찾기 팀과 무관하게 특정 경기 하나만 알림 대상으로 켜거나 끈다(push.js handleWatchMatch와 동일한 역할).
export async function handleTossWatchMatch(request, env) {
  const body = await request.json();
  if (!body?.anonKey || !body?.matchId) return json({ detail: "anonKey, matchId가 필요합니다." }, 400);

  const key = `${KV_KEYS.tossSubscriptionPrefix}${body.anonKey}`;
  const raw = await env.CACHE.get(key);
  if (!raw) return json({ detail: "구독 정보가 없습니다." }, 404);

  const record = JSON.parse(raw);
  const matchIds = new Set(record.matchIds || []);
  if (body.watch) matchIds.add(body.matchId);
  else matchIds.delete(body.matchId);

  record.matchIds = [...matchIds];
  record.updatedAt = new Date().toISOString();

  try {
    await env.CACHE.put(key, JSON.stringify(record));
  } catch (err) {
    console.error("toss watch-match write failed:", err);
    return json({ detail: "일시적으로 알림 설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요." }, 503);
  }
  return json({ status: "ok", matchIds: record.matchIds });
}
