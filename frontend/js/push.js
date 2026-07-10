import { fetchJSON } from "./api.js";
import { listFavorites } from "./favorites.js";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function initPushButton() {
  const btn = document.getElementById("notify-btn");
  if (!btn || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    if (btn) btn.disabled = true;
    return;
  }

  navigator.serviceWorker.register("/sw.js").then(async (reg) => {
    const existing = await reg.pushManager.getSubscription();
    updateButton(btn, !!existing);
  });

  btn.addEventListener("click", async () => {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();

    if (existing) {
      await fetchJSONPost("/push/unsubscribe", { endpoint: existing.endpoint }).catch(() => {});
      await existing.unsubscribe();
      updateButton(btn, false);
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    const { publicKey } = await fetchJSON("/push/vapid-public-key");
    if (!publicKey) {
      alert("서버에 알림 키가 설정되지 않았습니다.");
      return;
    }

    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const teamIds = listFavorites().map((t) => t.id);
    await fetchJSONPost("/push/subscribe", { subscription: subscription.toJSON(), teamIds });
    updateButton(btn, true);
  });
}

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
