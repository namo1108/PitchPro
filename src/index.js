import { routeApiRequest } from "./router.js";
import { runScheduledTasks } from "./scheduled/index.js";

// 앱인토스(Apps in Toss) 미니앱은 우리 사이트를 그대로 서빙하는 게 아니라 정적 파일을 통째로
// 복사해 자기네 WebView 안(다른 출처)에서 띄우는 방식이라, 상대경로 /api 요청이 우리 서버가
// 아니라 그 WebView 자체 출처로 나가서 다 실패한다(2026-08-17 확인) - 프론트는 절대 URL로
// 고치고, 서버는 그 출처의 요청을 허용해야 한다. Bearer 토큰 인증이라 쿠키가 안 얽혀서 *로
// 열어도 안전하다(자격증명 방식이었다면 특정 출처만 허용해야 했음).
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }
      try {
        const res = await routeApiRequest(request, env, ctx);
        const headers = new Headers(res.headers);
        for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
        return new Response(res.body, { status: res.status, headers });
      } catch (err) {
        console.error("API request failed:", err);
        return new Response(JSON.stringify({ detail: String(err.message || err) }), {
          status: 502,
          headers: { "content-type": "application/json; charset=utf-8", ...CORS_HEADERS },
        });
      }
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledTasks(env));
  },
};
