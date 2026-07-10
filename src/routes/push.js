import { json } from "../lib/http.js";
import { KV_KEYS } from "../lib/config.js";

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
  await env.CACHE.put(
    `${KV_KEYS.pushSubscriptionPrefix}${id}`,
    JSON.stringify({ subscription: body.subscription, teamIds: body.teamIds || [], updatedAt: new Date().toISOString() })
  );
  return json({ status: "ok" });
}

export async function handleUnsubscribe(request, env) {
  const body = await request.json();
  if (!body?.endpoint) return json({ detail: "endpoint가 필요합니다." }, 400);

  const id = await hashEndpoint(body.endpoint);
  await env.CACHE.delete(`${KV_KEYS.pushSubscriptionPrefix}${id}`);
  return json({ status: "ok" });
}
