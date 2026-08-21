import { json } from "../lib/http.js";
import { KV_KEYS, NOTIFICATION_TYPES } from "../lib/config.js";
import { getAuthedUser } from "../lib/auth.js";
import { sendPushToUsername } from "../lib/push.js";
import { sendTossPushToUsername } from "../lib/tossPush.js";

async function hashEndpoint(endpoint) {
  const data = new TextEncoder().encode(endpoint);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 이 설정 이전에 만들어진 구독(record.prefs 없음)이든, 새로 만드는 구독이든 항상 이 기본값(전부 켜짐)
// 에서 시작한다 - 사용자가 명시적으로 끈 항목만 false로 남는다.
function defaultPrefs() {
  return { sound: true, types: Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t.id, true])) };
}

function mergePrefs(existing, incoming) {
  const base = defaultPrefs();
  return {
    sound: incoming?.sound ?? existing?.sound ?? base.sound,
    types: { ...base.types, ...existing?.types, ...incoming?.types },
  };
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
        prefs: mergePrefs(existing?.prefs, null),
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

// 설정 탭에서 "이 기기"의 알림 소리/종류별 켜고 끄기를 조회한다. 구독 자체가 없으면(알림을 아직
// 한 번도 켠 적 없음) 기본값(전부 켜짐)을 그대로 돌려줘서, 프론트가 매번 null 체크를 안 해도 되게 한다.
export async function handleGetPreferences(request, env, url) {
  const endpoint = url.searchParams.get("endpoint");
  if (!endpoint) return json({ detail: "endpoint가 필요합니다." }, 400);

  const id = await hashEndpoint(endpoint);
  const raw = await env.CACHE.get(`${KV_KEYS.pushSubscriptionPrefix}${id}`);
  const record = raw ? JSON.parse(raw) : null;
  return json({ prefs: mergePrefs(record?.prefs, null) });
}

export async function handleSetPreferences(request, env) {
  const body = await request.json();
  if (!body?.endpoint) return json({ detail: "endpoint가 필요합니다." }, 400);

  const id = await hashEndpoint(body.endpoint);
  const key = `${KV_KEYS.pushSubscriptionPrefix}${id}`;
  const raw = await env.CACHE.get(key);
  if (!raw) return json({ detail: "구독 정보가 없습니다." }, 404);

  const record = JSON.parse(raw);
  record.prefs = mergePrefs(record.prefs, body.prefs);
  record.updatedAt = new Date().toISOString();

  try {
    await env.CACHE.put(key, JSON.stringify(record));
  } catch (err) {
    console.error("push preferences write failed:", err);
    return json({ detail: "일시적으로 알림 설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요." }, 503);
  }
  return json({ status: "ok", prefs: record.prefs });
}

// 실제 골/이벤트가 날 때까지 기다리지 않고도 특정 계정 기기로 알림이 실제로(백그라운드에서도) 오는지
// 바로 확인해보고 싶을 때 쓰는 관리자용 테스트 발송 - username 하나만 지정해서 그 계정에만 간다
// (전체 구독자 브로드캐스트가 아님 - 실사용자에게 테스트 알림이 잘못 가는 일이 없게).
export async function handleTestPush(request, env) {
  const body = await request.json();
  if (!body?.username) return json({ detail: "username이 필요합니다." }, 400);

  const payload = {
    type: body.type || "goal",
    title: body.title || "🔔 테스트 알림",
    body: body.body || "이 알림이 보이면 백그라운드 푸시가 정상 동작하는 거예요.",
    ...(body.image ? { image: body.image } : {}),
  };

  // 같은 계정이 웹 푸시/토스 미니앱 양쪽 다 구독해뒀을 수 있어서 둘 다 시도하고, 둘 중 하나라도
  // 성공하면 성공으로 본다 - 어느 쪽으로 갔는지는 응답에 같이 실어서 관리자 화면에서 구분할 수 있게 한다.
  const [webPushSent, tossSent] = await Promise.all([
    sendPushToUsername(env, body.username, payload),
    sendTossPushToUsername(env, body.username, payload),
  ]);

  if (!webPushSent && !tossSent) {
    return json({ detail: "구독을 찾을 수 없거나 발송에 실패했습니다 (자세한 사유는 wrangler tail 로그 참고)." }, 404);
  }
  return json({ status: "ok", webPushSent, tossSent });
}
