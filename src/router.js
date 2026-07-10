import { json } from "./lib/http.js";
import { handleHealth } from "./routes/health.js";
import { handleCompetitions } from "./routes/competitions.js";
import { handleMatches } from "./routes/matches.js";
import { handleMatchDetail } from "./routes/matchDetail.js";
import { handleStandings } from "./routes/standings.js";

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

  return json({ detail: "찾을 수 없는 경로" }, 404);
}
