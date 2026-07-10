import { routeApiRequest } from "./router.js";
import { runScheduledTasks } from "./scheduled/index.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await routeApiRequest(request, env, ctx);
      } catch (err) {
        console.error("API request failed:", err);
        return new Response(JSON.stringify({ detail: String(err.message || err) }), {
          status: 502,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledTasks(env));
  },
};
