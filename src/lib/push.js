import { sendPushNotification, deserializeVapidKeys } from "web-push-browser";
import { getJSON } from "./kv.js";
import { KV_KEYS } from "./config.js";

let cachedKeyPair = null;

async function getKeyPair(env) {
  if (cachedKeyPair) return cachedKeyPair;
  cachedKeyPair = await deserializeVapidKeys({
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  });
  return cachedKeyPair;
}

export async function sendGoalPush(env, subscription, payload) {
  const keyPair = await getKeyPair(env);
  return sendPushNotification(
    keyPair,
    { endpoint: subscription.endpoint, keys: subscription.keys },
    env.VAPID_SUBJECT || "mailto:admin@example.com",
    JSON.stringify(payload)
  );
}

// 친구 요청/수락처럼 "이 계정에게" 보내야 하는 알림용 - 로그인 시 등록해둔 username -> 구독 색인을 통해 찾는다.
// 그 계정이 그 기기에서 알림을 켜둔 적이 없으면(구독 없음) 조용히 아무 일도 하지 않는다.
export async function sendPushToUsername(env, username, payload) {
  const subKey = await env.CACHE.get(`${KV_KEYS.pushUsernameIndexPrefix}${username}`);
  if (!subKey) return false;
  const record = await getJSON(env, subKey);
  if (!record?.subscription) return false;
  try {
    await sendGoalPush(env, record.subscription, payload);
    return true;
  } catch (err) {
    console.error(`push to username ${username} failed:`, err);
    return false;
  }
}
