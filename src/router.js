import { json } from "./lib/http.js";
import { handleHealth } from "./routes/health.js";
import { handleCompetitions } from "./routes/competitions.js";
import { handleMatches } from "./routes/matches.js";
import { handleMatchDetail } from "./routes/matchDetail.js";
import { handleStandings } from "./routes/standings.js";
import { handleTeamDetail } from "./routes/team.js";
import { handleHeadToHead } from "./routes/headToHead.js";
import { handleNews } from "./routes/news.js";
import { handleAnalysis } from "./routes/analysis.js";
import { handleVapidPublicKey, handleSubscribe, handleUnsubscribe } from "./routes/push.js";

export async function routeApiRequest(request, env, ctx) {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean); // ["api", ...]

  if (segments[1] === "health" && segments.length === 2) {
    return handleHealth(request, env);
  }
  if (segments[1] === "competitions" && segments.length === 2) {
    return handleCompetitions();
  }
  if (segments[1] === "matches" && segments.length === 2) {
    return handleMatches(request, env, url);
  }
  if (segments[1] === "matches" && segments.length === 3) {
    return handleMatchDetail(request, env, segments[2]);
  }
  if (segments[1] === "standings" && segments.length === 3) {
    return handleStandings(request, env, segments[2]);
  }
  if (segments[1] === "teams" && segments.length === 3) {
    return handleTeamDetail(request, env, segments[2]);
  }
  if (segments[1] === "head2head" && segments.length === 2) {
    return handleHeadToHead(request, env, url);
  }
  if (segments[1] === "news" && segments.length === 2) {
    return handleNews(request, env);
  }
  if (segments[1] === "analysis" && segments.length === 2) {
    return handleAnalysis(request, env);
  }
  if (segments[1] === "push" && segments[2] === "vapid-public-key" && request.method === "GET") {
    return handleVapidPublicKey(request, env);
  }
  if (segments[1] === "push" && segments[2] === "subscribe" && request.method === "POST") {
    return handleSubscribe(request, env);
  }
  if (segments[1] === "push" && segments[2] === "unsubscribe" && request.method === "POST") {
    return handleUnsubscribe(request, env);
  }

  return json({ detail: "찾을 수 없는 경로" }, 404);
}
