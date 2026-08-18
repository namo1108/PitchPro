import { fetchJSON, API } from "./api.js";
import { listFavorites } from "./favorites.js";
import { getToken } from "./auth.js";

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

// 서비스워커(sw.js)는 localStorage에 접근할 수 없어서, pushsubscriptionchange로 재구독할 때
// 열린 탭에 즐겨찾기 팀 id 목록을 물어본다 - 여기서 응답해준다.
navigator.serviceWorker?.addEventListener("message", (event) => {
  if (event.data?.type === "request-favorite-team-ids") {
    event.ports[0]?.postMessage({ teamIds: listFavorites().map((t) => t.id) });
  }
});

// 브라우저 쪽 구독 객체가 이미 있어도 서버 KV 레코드는 지워졌을 수 있다(만료 구독 자동 정리 등) ->
// 매번 서버에 다시 등록하고, 실제로 저장됐는지 응답을 확인해야 버튼 상태와 실제 알림 수신 여부가
// 어긋나지 않는다(예전엔 서버가 503을 반환해도 버튼은 "켜짐"으로 표시됐었다).
async function postSubscribe(subscription, teamIds) {
  const { ok } = await fetchJSONPost("/push/subscribe", { subscription: subscription.toJSON(), teamIds });
  return ok;
}

// 아직 구독 중이 아니면 권한 요청 + 구독까지 처리하고, 브라우저 구독이 있든 새로 만들었든
// 항상 서버 등록을 (재)시도해서 실제로 저장됐는지 확인한 뒤 구독 객체를 돌려준다.
// 권한 거부/미지원/서버 등록 실패면 null.
export async function ensureSubscribed() {
  const reg = await getRegistration();
  if (!reg) return null;

  let subscription = await reg.pushManager.getSubscription();

  if (!subscription) {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;

    const { publicKey } = await fetchJSON("/push/vapid-public-key");
    if (!publicKey) return null;

    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const teamIds = listFavorites().map((t) => t.id);
  const ok = await postSubscribe(subscription, teamIds);
  syncNotifyButton(ok);
  return ok ? subscription : null;
}

// 설정 탭이 "지금 이 기기가 알림을 받고 있는지"만 조용히 확인할 때 쓴다 - ensureSubscribed와 달리
// 권한 요청 팝업을 띄우지 않고, 이미 구독 중이면 그 구독을, 아니면 null을 돌려준다.
export async function getCurrentSubscription() {
  const reg = await getRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

// 특정 경기 하나를 알림 대상으로 켜거나 끈다. 구독이 없으면 새로 만든다.
export async function setMatchWatch(matchId, watch) {
  const subscription = await ensureSubscribed();
  if (!subscription) return false;
  const { ok, data } = await fetchJSONPost("/push/watch-match", { endpoint: subscription.endpoint, matchId, watch });
  return ok && data?.status === "ok";
}

function syncNotifyButton(subscribed) {
  const btn = document.getElementById("notify-btn");
  if (btn) updateButton(btn, subscribed);
  window.dispatchEvent(new CustomEvent("push-subscription-changed", { detail: { subscribed } }));
}

export function initPushButton() {
  const btn = document.getElementById("notify-btn");
  if (!btn || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    if (btn) btn.disabled = true;
    return;
  }

  getRegistration().then(async (reg) => {
    const existing = await reg.pushManager.getSubscription();
    if (!existing) {
      syncNotifyButton(false);
      return;
    }
    // 브라우저 구독은 남아 있어도 서버 KV 레코드가 지워졌을 수 있어(만료 구독 자동 정리 등),
    // 페이지를 열 때마다 조용히 재등록해서 버튼 표시와 실제 수신 가능 여부가 어긋나지 않게 한다.
    const teamIds = listFavorites().map((t) => t.id);
    const ok = await postSubscribe(existing, teamIds);
    syncNotifyButton(ok);
  });

  btn.addEventListener("click", async () => {
    const reg = await getRegistration();
    const existing = await reg.pushManager.getSubscription();

    if (existing) {
      await fetchJSONPost("/push/unsubscribe", { endpoint: existing.endpoint }).catch(() => {});
      await existing.unsubscribe();
      syncNotifyButton(false);
      return;
    }

    const subscription = await ensureSubscribed();
    syncNotifyButton(!!subscription);
  });
}

// 이미 구독 중인 상태에서 즐겨찾기 팀이 바뀌면(구독 시점 이후 추가/삭제), 서버의 teamIds도 다시 맞춘다.
// 안 그러면 구독할 때 즐겨찾기가 비어 있던 경우 팀 골 알림이 영영 안 온다.
//
// 아직 구독 중이 아니면(=첫 즐겨찾기 팀 추가), 여기서 바로 알림 권한을 요청한다 - "즐겨찾기 팀
// 등록"이라는 사용자의 진짜 클릭에서 곧바로 이어지는 동기 호출이라 브라우저의 user-activation이
// 살아있어 권한 팝업이 자연스럽게 뜬다("🔔 골 알림 받기" 버튼을 따로 눌러야 하는 불편을 없앤다).
// 단, 브라우저는 권한을 코드로 "자동 허용"시키는 건 절대 허용하지 않는다 - 사용자가 그 네이티브
// 팝업에서 직접 허용/거부를 선택해야 하며, 우리가 할 수 있는 건 그 팝업이 뜨는 타이밍뿐이다.
window.addEventListener("favorites-changed", async () => {
  const reg = await getRegistration();
  if (!reg) return;
  const existing = await reg.pushManager.getSubscription();

  if (!existing) {
    if (Notification.permission === "default") await ensureSubscribed();
    return;
  }

  const teamIds = listFavorites().map((t) => t.id);
  await fetchJSONPost("/push/subscribe", { subscription: existing.toJSON(), teamIds }).catch(() => {});
});

// 이미 골 알림을 켜둔 채로 로그인/로그아웃하면, 그 구독을 이 계정과 다시 연결(또는 해제)해야
// 친구 요청/수락 알림을 이 계정 기준으로 보낼 수 있다.
window.addEventListener("auth-changed", async () => {
  const reg = await getRegistration();
  if (!reg) return;
  const existing = await reg.pushManager.getSubscription();
  if (!existing) return;

  const teamIds = listFavorites().map((t) => t.id);
  await fetchJSONPost("/push/subscribe", { subscription: existing.toJSON(), teamIds }).catch(() => {});
});

// 로그인 상태면 Authorization 헤더를 실어 보내서, 서버가 이 구독을 계정과 연결할 수 있게 한다.
// fetch 자체는 4xx/5xx에도 정상적으로 resolve하므로(reject 아님), ok를 같이 돌려줘야 호출부가
// "요청은 갔지만 서버가 실패로 응답했다"를 "성공"으로 착각하지 않는다.
async function fetchJSONPost(path, body) {
  const token = getToken();
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

function updateButton(btn, subscribed) {
  btn.textContent = subscribed ? "🔕 골 알림 끄기" : "🔔 골 알림 받기";
  btn.classList.toggle("active", subscribed);
}
