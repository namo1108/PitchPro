self.addEventListener("push", (event) => {
  let payload = { title: "PITCH PRO", body: "새 소식이 있습니다." };
  try {
    payload = event.data.json();
  } catch {
    // 페이로드가 JSON이 아니면 기본값 사용
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "PITCH PRO", {
      body: payload.body || "",
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      data: { matchId: payload.matchId },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});
