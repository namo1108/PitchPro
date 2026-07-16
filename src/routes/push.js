import { json } from "../lib/http.js";
import { KV_KEYS } from "../lib/config.js";
import { getAuthedUser } from "../lib/auth.js";

async function hashEndpoint(endpoint) {
  const data = new TextEncoder().encode(endpoint);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleVapidPublicKey(request, env) {
  return json({ publicKey: env.VAPID_PUBLIC_KEY || null });
}

export async function handleSubscribe(request, env) {
  const body = await request.json();
  if (!body?.subscription?.endpoint) return json({ detail: "subscription이 필요합니다." }, 400);

  const id = await hashEndpoint(body.subscription.endpoint);
  const key = `${KV_KEYS.pushSubscriptionPrefix}${id}`;
  // 즐겨찾기 변경 시 teamIds만 다시 보내오는 경우가 있어(마이팀 동기화),
  // 이미 등록된 경기별 알림(matchIds)을 덮어써서 지우지 않도록 기존 레코드와 합친다.
  const existingRaw = await env.CACHE.get(key);
  const existing = existingRaw ? JSON.parse(existingRaw) : null;

  // 로그인한 상태로 구독하면(Authorization 헤더 있음) username -> 구독 색인도 같이 남겨서,
  // 친구 요청/수락 등 "이 계정에게" 보내는 알림을 나중에 찾을 수 있게 한다.
  const user = await getAuthedUser(request, env);

  try {
    await env.CACHE.put(
      key,
      JSON.stringify({
        subscription: body.subscription,
        teamIds: body.teamIds || [],
        matchIds: existing?.matchIds || [],
        username: user?.username || existing?.username || null,
        updatedAt: new Date().toISOString(),
      })
    );
    if (user) await env.CACHE.put(`${KV_KEYS.pushUsernameIndexPrefix}${user.username}`, key);
  } catch (err) {
    console.error("push subscribe write failed:", err);
    return json({ detail: "일시적으로 알림 설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요." }, 503);
  }
  return json({ status: "ok" });
}

export async function handleUnsubscribe(request, env) {
  const body = await request.json();
  if (!body?.endpoint) return json({ detail: "endpoint가 필요합니다." }, 400);

  const id = await hashEndpoint(body.endpoint);
  const key = `${KV_KEYS.pushSubscriptionPrefix}${id}`;
  const raw = await env.CACHE.get(key);
  const existing = raw ? JSON.parse(raw) : null;
  if (existing?.username) await env.CACHE.delete(`${KV_KEYS.pushUsernameIndexPrefix}${existing.username}`);

  await env.CACHE.delete(key);
  return json({ status: "ok" });
}

// 즐겨찾기 팀과 무관하게 특정 경기 하나만 골 알림 대상으로 켜거나 끈다.
export async function handleWatchMatch(request, env) {
  const body = await request.json();
  if (!body?.endpoint || !body?.matchId) return json({ detail: "endpoint, matchId가 필요합니다." }, 400);

  const id = await hashEndpoint(body.endpoint);
  const key = `${KV_KEYS.pushSubscriptionPrefix}${id}`;
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
    console.error("watch-match write failed:", err);
    return json({ detail: "일시적으로 알림 설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요." }, 503);
  }
  return json({ status: "ok", matchIds: record.matchIds });
}
