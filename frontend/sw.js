// 서비스 워커는 기본적으로 기존 탭이 다 닫혀야 새 버전으로 교체되는데, PWA는 계속 켜둔 채로 쓰는 경우가
// 많아서 배포해도 한참 옛날 버전이 계속 알림을 처리하는 경우가 있다(방금 아이콘 수정이 안 먹힌 이유).
// skipWaiting + clients.claim으로 배포 즉시 새 버전이 넘겨받도록 강제한다.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "PITCH PRO", body: "새 소식이 있습니다." };
  try {
    payload = event.data.json();
  } catch {
    // 페이로드가 JSON이 아니면 기본값 사용
  }

  const isGoal = payload.type === "goal";
  const isLineup = payload.type === "lineup";

  let icon = "/img/goal-icon-96.png";
  let badge = "/img/badge-icon-96.png";
  if (isGoal) icon = "/img/goal-icon-192.png";
  if (isLineup) {
    icon = "/img/pitch-icon-192.png";
    badge = "/img/pitch-badge-96.png";
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "PITCH PRO", {
      body: payload.body || "",
      icon,
      // badge는 안드로이드 상태표시줄용 -> OS가 알파 채널만 보고 단색으로 다시 칠하기 때문에
      // 배경이 불투명한 이미지를 쓰면 그냥 네모난 덩어리로 보인다. 투명 배경 실루엣을 따로 쓴다.
      badge,
      vibrate: isGoal ? [80, 40, 80, 40, 80, 40, 260] : [120, 60, 120],
      tag: payload.matchId || undefined,
      renotify: !!payload.matchId,
      data: { matchId: payload.matchId },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});
