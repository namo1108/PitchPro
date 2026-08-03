// 외부 분석 SDK 없이 자체 서버에 익명 집계(탭 조회수/주요 이벤트 횟수)만 남기는 가벼운 비콘.
// 실패해도 화면에 영향이 없어야 하니 항상 조용히 무시하고, keepalive로 탭 전환/이탈 중에도 최대한 전송되게 한다.
function send(body) {
  try {
    fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // 무시
  }
}

export function trackView(name) {
  send({ kind: "view", name });
}

export function trackEvent(name) {
  send({ kind: "event", name });
}
