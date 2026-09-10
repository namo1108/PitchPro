import { sendPushNotification, deserializeVapidKeys } from "web-push-browser";
import { getJSON } from "./kv.js";
import { KV_KEYS } from "./config.js";
import { getUsernameIndexKeys } from "./subscriptions.js";

let cachedKeyPair = null;

async function getKeyPair(env) {
  if (cachedKeyPair) return cachedKeyPair;
  cachedKeyPair = await deserializeVapidKeys({
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  });
  return cachedKeyPair;
}

// web-push-browser의 sendPushNotification은 email 인자 앞에 자기가 "mailto:"를 붙인다. 근데
// VAPID_SUBJECT는 관례상(.dev.vars도 그렇고) 이미 "mailto:"가 붙은 값으로 넣어두는 경우가 많아서,
// 그대로 넘기면 sub 클레임이 "mailto:mailto:..."로 두 번 붙어 나간다 - FCM(크롬/안드로이드)은 이런
// 손상된 값도 대충 받아주지만 Apple의 web.push.apple.com은 RFC 8292를 엄격히 검사해서 조용히
// 거부한다(아이폰에서만 알림이 안 오던 원인). 여기서 접두사를 벗겨 항상 순수 이메일만 넘긴다.
function vapidEmail(subject) {
  return (subject || "admin@example.com").replace(/^mailto:/i, "");
}

export async function sendGoalPush(env, subscription, payload) {
  const keyPair = await getKeyPair(env);
  return sendPushNotification(
    keyPair,
    { endpoint: subscription.endpoint, keys: subscription.keys },
    vapidEmail(env.VAPID_SUBJECT),
    JSON.stringify(payload)
  );
}

// 친구 요청/수락처럼 "이 계정에게" 보내야 하는 알림용 - 로그인 시 등록해둔 username -> 구독 색인을 통해 찾는다.
// 한 계정이 여러 기기(아이폰+갤럭시 등)에서 로그인해뒀을 수 있어 색인에 담긴 기기 전부에 보낸다
// (2026-09-10 - 예전엔 기기 하나만 남는 색인이라 나중에 로그인한 기기에만 갔었다). 하나라도 성공하면
// true - 기존 호출부(community.js/friends.js)가 "성공/실패" 불리언만 확인해서 쓰는 걸 유지한다.
export async function sendPushToUsername(env, username, payload) {
  const subKeys = await getUsernameIndexKeys(env, KV_KEYS.pushUsernameIndexPrefix, username);
  if (!subKeys.length) return false;

  const results = await Promise.all(
    subKeys.map(async (subKey) => {
      const record = await getJSON(env, subKey);
      if (!record?.subscription) return false;
      try {
        const res = await sendGoalPush(env, record.subscription, payload);
        if (!res.ok) {
          console.error(`push to username ${username} (${subKey}) failed: ${res.status} ${await res.text().catch(() => "")}`);
          return false;
        }
        return true;
      } catch (err) {
        console.error(`push to username ${username} (${subKey}) failed:`, err);
        return false;
      }
    })
  );
  return results.some(Boolean);
}
