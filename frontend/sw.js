// 서비스 워커는 기본적으로 기존 탭이 다 닫혀야 새 버전으로 교체되는데, PWA는 계속 켜둔 채로 쓰는 경우가
// 많아서 배포해도 한참 옛날 버전이 계속 알림을 처리하는 경우가 있다(방금 아이콘 수정이 안 먹힌 이유).
// skipWaiting + clients.claim으로 배포 즉시 새 버전이 넘겨받도록 강제한다.
self.addEventListener("install", () => {
  self.skipWaiting();
});

// 캐시 이름에 버전을 박아두고, activate 시점에 이전 버전 캐시를 지운다 - 그래야 오프라인 캐시 전략을
// 나중에 바꿔도(예: SHELL_CACHE_VERSION 올리기) 옛날 캐시가 계속 쌓여있지 않는다.
const SHELL_CACHE_VERSION = "v1";
const SHELL_CACHE = `pitchpro-shell-${SHELL_CACHE_VERSION}`;

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await clients.claim();
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("pitchpro-shell-") && k !== SHELL_CACHE).map((k) => caches.delete(k)));
    })()
  );
});

// 오프라인 대응 - 실시간 데이터(/api/*)는 절대 캐시하지 않고 항상 네트워크로만 처리한다(캐시된 옛날
// 스코어를 보여주면 오히려 해로움). 그 외 같은 출처의 GET 요청(HTML/CSS/JS/이미지 등 앱 셸)은
// "네트워크 우선, 실패하면 캐시" 전략으로 처리한다 - 온라인일 땐 항상 최신을 받고, 방문했던 페이지는
// 오프라인에서도 흰 화면 대신 마지막으로 받아둔 화면이 뜬다. 화면 이동(주소 자체를 새로 여는 경우)이
// 오프라인이라 캐시에도 없으면 최소한 앱 셸("/")로라도 대체한다.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  event.respondWith(
    (async () => {
      try {
        const res = await fetch(event.request);
        if (res.ok) {
          const cache = await caches.open(SHELL_CACHE);
          cache.put(event.request, res.clone());
        }
        return res;
      } catch {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate") {
          const shell = await caches.match("/");
          if (shell) return shell;
        }
        return Response.error();
      }
    })()
  );
});

self.addEventListener("push", (event) => {
  let payload = { title: "PITCH PRO", body: "새 소식이 있습니다." };
  try {
    payload = event.data.json();
  } catch {
    // 페이로드가 JSON이 아니면 기본값 사용
  }

  const isGoal = payload.type === "goal";
  const isConcede = payload.type === "concede";
  const isVarCancel = payload.type === "var_cancel";
  const isRedCard = payload.type === "redcard";
  const isYellowCard = payload.type === "yellowcard";
  const isCard = isRedCard || isYellowCard;
  const isLineup = payload.type === "lineup";
  const isKickoff = payload.type === "kickoff";
  const isKickoffSoon = payload.type === "kickoff_soon";
  const isHalftime = payload.type === "halftime";
  const isFulltime = payload.type === "fulltime";
  const isWhistle = isKickoff || isFulltime;
  const isFriend = payload.type === "friend_request" || payload.type === "friend_accept";
  const isTransfer = payload.type === "transfer";

  let icon = "/img/goal-icon-96.png";
  if (isGoal || isConcede) icon = "/img/goal-icon-192.png";
  if (isLineup) icon = "/img/lineup-icon-192.png";
  if (isFriend) icon = "/img/pitch-icon-192.png";
  if (isWhistle) icon = "/img/whistle-icon-192.png";
  if (isKickoffSoon) icon = "/img/fiveminutes-icon-192.png";
  if (isHalftime) icon = "/img/pause-icon-192.png";
  if (isVarCancel) icon = "/img/varcancel-icon-192.png";
  if (isTransfer) icon = "/img/transfer-icon-192.png";
  if (isRedCard) icon = "/img/redcard-icon-192.png";
  if (isYellowCard) icon = "/img/yellowcard-icon-192.png";

  // badge는 안드로이드 상태표시줄용이라 OS가 알파 채널만 보고 단색 실루엣으로 다시 칠한다 - 색은
  // 어차피 안 보이니 "모양"만으로 종류를 구분해야 한다. 처음엔 카드류만 따로 만들고 나머지는 전부
  // 공 모양 하나로 통일했는데, 실점/킥오프/하프타임/종료/골취소/이적/라인업까지 다 같은 공 모양이면
  // 사용자가 구분을 못 한다는 피드백(2026-08-10)을 받아 종류별로 실루엣을 다 따로 만들었다.
  let badge = "/img/badge-icon-96.png"; // 골 - 기본값
  if (isCard) badge = "/img/badge-card-96.png";
  else if (isConcede) badge = "/img/badge-concede-96.png";
  else if (isKickoff) badge = "/img/badge-kickoff-96.png";
  else if (isKickoffSoon) badge = "/img/badge-kickoffsoon-96.png";
  else if (isHalftime) badge = "/img/badge-halftime-96.png";
  else if (isFulltime) badge = "/img/badge-fulltime-96.png";
  else if (isVarCancel) badge = "/img/badge-varcancel-96.png";
  else if (isTransfer) badge = "/img/badge-transfer-96.png";
  else if (isLineup) badge = "/img/badge-lineup-96.png";

  event.waitUntil(
    self.registration.showNotification(payload.title || "PITCH PRO", {
      body: payload.body || "",
      icon,
      badge,
      vibrate: isGoal
        ? [80, 40, 80, 40, 80, 40, 260]
        : isConcede
        ? [220, 100, 220]
        : isRedCard
        ? [60, 60, 60, 60, 60, 60, 260]
        : isVarCancel || isWhistle
        ? [150, 80, 150]
        : [120, 60, 120],
      tag: payload.matchId || undefined,
      renotify: !!payload.matchId,
      // 설정 탭에서 "알림 소리 끄기"를 켜면 서버가 payload.silent를 실어 보낸다 - true면 OS가
      // 소리/진동 없이 조용히 알림만 띄운다(vibrate 배열이 있어도 silent가 우선한다).
      silent: !!payload.silent,
      // 골 알림은 서버가 그때그때 득점팀 엠블럼+득점자+시간으로 그려주는 이미지 URL을 같이 보낸다
      // (payload.image) - 안드로이드에서 알림을 펼치면 큰 사진처럼 보인다. 없으면 그냥 생략(일부
      // 알림 종류는 이미지가 없음).
      ...(payload.image ? { image: payload.image } : {}),
      data: { matchId: payload.matchId },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});

// 브라우저/OS 푸시 서비스가 구독을 만료시키거나 교체하는 경우(장기 미접속, PWA 재설치, OS 푸시
// 리셋 등)가 정상적으로 발생하는데, 이걸 감지해 서버에 재등록하는 코드가 없으면 그 기기는 골 알림을
// 켜둔 것처럼 보여도 실제로는 영구히 못 받게 된다. 새 구독을 만들고 옛 구독은 서버에서 지운 뒤,
// 열려 있는 탭에 즐겨찾기 팀 목록을 물어봐서(서비스워커는 localStorage에 접근 못 함) 새로 등록한다.
async function requestFavoriteTeamIds() {
  const allClients = await clients.matchAll({ type: "window" });
  if (!allClients.length) return [];
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => resolve(e.data?.teamIds || []);
    allClients[0].postMessage({ type: "request-favorite-team-ids" }, [channel.port2]);
    setTimeout(() => resolve([]), 1500);
  });
}

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const newSubscription = await self.registration.pushManager.subscribe(
          event.oldSubscription ? event.oldSubscription.options : event.newSubscription?.options
        );

        if (event.oldSubscription?.endpoint) {
          await fetch("/api/push/unsubscribe", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ endpoint: event.oldSubscription.endpoint }),
          }).catch(() => {});
        }

        const teamIds = await requestFavoriteTeamIds();
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ subscription: newSubscription.toJSON(), teamIds }),
        });
      } catch (err) {
        console.error("push resubscribe failed:", err);
      }
    })()
  );
});
