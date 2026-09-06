export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    // Cache-Control을 안 정해두면 중간(CDN 엣지 등)에서 GET 응답을 URL 기준으로 그대로 캐싱해버릴 수
    // 있다 - 실제로 쿼리스트링 없는 /api/teams/50 요청이 KV 캐시를 지우고 코드까지 새로 배포한
    // 뒤에도 계속 옛날 값을 주다가, 쿼리스트링 하나만 붙여도(캐시 키가 달라져서) 바로 최신 값이
    // 나오는 걸로 확인됐다(2026-09-06). 캐싱 자체는 이미 각 라우트가 KV로 알아서 하고 있으니, 그
    // 위에 얹히는 외부 캐시는 득 없이 혼란만 준다 - 아예 못 캐싱하게 막는다.
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
