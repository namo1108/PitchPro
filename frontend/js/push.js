import { fetchJSON } from "./api.js";
import { listFavorites } from "./favorites.js";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

let swRegistration = null;

async function getRegistration() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  if (!swRegistration) swRegistration = await navigator.serviceWorker.register("/sw.js");
  return swRegistration;
}

// 아직 구독 중이 아니면 권한 요청 + 구독 + 서버 등록까지 처리하고 구독 객체를 돌려준다.
// 권한 거부/미지원이면 null.
export async function ensureSubscribed() {
  const reg = await getRegistration();
  if (!reg) return null;

  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  const { publicKey } = await fetchJSON("/push/vapid-public-key");
  if (!publicKey) return null;

  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const teamIds = listFavorites().map((t) => t.id);
  await fetchJSONPost("/push/subscribe", { subscription: subscription.toJSON(), teamIds });
  syncNotifyButton(true);
  return subscription;
}

// 특정 경기 하나를 알림 대상으로 켜거나 끈다. 구독이 없으면 새로 만든다.
export async function setMatchWatch(matchId, watch) {
  const subscription = await ensureSubscribed();
  if (!subscription) return false;
  const result = await fetchJSONPost("/push/watch-match", { endpoint: subscription.endpoint, matchId, watch });
  return result?.status === "ok";
}

function syncNotifyButton(subscribed) {
  const btn = document.getElementById("notify-btn");
  if (btn) updateButton(btn, subscribed);
}

export function initPushButton() {
  const btn = document.getElementById("notify-btn");
  if (!btn || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    if (btn) btn.disabled = true;
    return;
  }

  getRegistration().then(async (reg) => {
    const existing = await reg.pushManager.getSubscription();
    updateButton(btn, !!existing);
  });

  btn.addEventListener("click", async () => {
    const reg = await getRegistration();
    const existing = await reg.pushManager.getSubscription();

    if (existing) {
      await fetchJSONPost("/push/unsubscribe", { endpoint: existing.endpoint }).catch(() => {});
      await existing.unsubscribe();
      updateButton(btn, false);
      return;
    }

    const subscription = await ensureSubscribed();
    updateButton(btn, !!subscription);
  });
}

// 이미 구독 중인 상태에서 즐겨찾기 팀이 바뀌면(구독 시점 이후 추가/삭제), 서버의 teamIds도 다시 맞춘다.
// 안 그러면 구독할 때 즐겨찾기가 비어 있던 경우 팀 골 알림이 영영 안 온다.
window.addEventListener("favorites-changed", async () => {
  const reg = await getRegistration();
  if (!reg) return;
  const existing = await reg.pushManager.getSubscription();
  if (!existing) return;

  const teamIds = listFavorites().map((t) => t.id);
  await fetchJSONPost("/push/subscribe", { subscription: existing.toJSON(), teamIds }).catch(() => {});
});

async function fetchJSONPost(path, body) {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function updateButton(btn, subscribed) {
  btn.textContent = subscribed ? "🔕 골 알림 끄기" : "🔔 골 알림 받기";
  btn.classList.toggle("active", subscribed);
}
