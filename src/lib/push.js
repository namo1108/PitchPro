import { sendPushNotification, deserializeVapidKeys } from "web-push-browser";

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
