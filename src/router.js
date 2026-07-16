import { json } from "./lib/http.js";
import { handleHealth } from "./routes/health.js";
import { handleCompetitions } from "./routes/competitions.js";
import { handleMatches } from "./routes/matches.js";
import { handleMatchDetail } from "./routes/matchDetail.js";
import { handleStandings } from "./routes/standings.js";
import { handleLeagueTopPlayers } from "./routes/leagueTopPlayers.js";
import { handleLeagueBracket } from "./routes/leagueBracket.js";
import { handleTeamDetail } from "./routes/team.js";
import { handleTeamSearch } from "./routes/teamSearch.js";
import { handlePlayerDetail } from "./routes/player.js";
import { handlePlayerPhotos } from "./routes/playerPhotos.js";
import { handleHeadToHead } from "./routes/headToHead.js";
import { handleNews } from "./routes/news.js";
import { handleTransfers } from "./routes/transfers.js";
import { handleAnalysis } from "./routes/analysis.js";
import { handleVapidPublicKey, handleSubscribe, handleUnsubscribe, handleWatchMatch } from "./routes/push.js";
import { handleSignup, handleLogin, handleLogout, handleMe } from "./routes/auth.js";
import { handleCheckin, handleCheckinStatus } from "./routes/checkin.js";
import { handleAddFriend, handleRemoveFriend, handleListFriends } from "./routes/friends.js";
import { handleLeaderboard } from "./routes/leaderboard.js";
import { scrapeK3K4TopScorers } from "./scheduled/scrapeK3K4TopScorers.js";
import { scrapeKLeagueTopPlayers } from "./scheduled/scrapeKLeagueTopPlayers.js";
import { scrapeKLeaguePlayerPhotos } from "./scheduled/scrapeKLeaguePlayerPhotos.js";
import { scrapeKLeagueCoachPhotos } from "./scheduled/scrapeKLeagueCoachPhotos.js";
import { detectTransfersAndNotify } from "./scheduled/detectTransfersAndNotify.js";
import { refreshApiFootballStandings } from "./scheduled/refreshApiFootballStandings.js";
import { refreshTransferMarket } from "./scheduled/refreshTransferMarket.js";

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
  if (segments[1] === "leagues" && segments.length === 4 && segments[3] === "top-players") {
    return handleLeagueTopPlayers(request, env, segments[2]);
  }
  if (segments[1] === "leagues" && segments.length === 4 && segments[3] === "bracket") {
    return handleLeagueBracket(request, env, segments[2]);
  }
  // /teams/search는 /teams/:id 패턴과 겹치니 그 앞에서 먼저 확인한다.
  if (segments[1] === "teams" && segments[2] === "search" && segments.length === 3) {
    return handleTeamSearch(request, env, url);
  }
  if (segments[1] === "teams" && segments.length === 3) {
    return handleTeamDetail(request, env, segments[2]);
  }
  // /players/photos는 /players/:id 패턴과 겹치니 그 앞에서 먼저 확인한다.
  if (segments[1] === "players" && segments[2] === "photos" && segments.length === 3) {
    return handlePlayerPhotos(request, env, url);
  }
  if (segments[1] === "players" && segments.length === 3) {
    return handlePlayerDetail(request, env, segments[2]);
  }
  if (segments[1] === "head2head" && segments.length === 2) {
    return handleHeadToHead(request, env, url);
  }
  if (segments[1] === "news" && segments.length === 2) {
    return handleNews(request, env);
  }
  if (segments[1] === "transfers" && segments.length === 2) {
    return handleTransfers(request, env);
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
  if (segments[1] === "push" && segments[2] === "watch-match" && request.method === "POST") {
    return handleWatchMatch(request, env);
  }
  if (segments[1] === "auth" && segments[2] === "signup" && request.method === "POST") {
    return handleSignup(request, env);
  }
  if (segments[1] === "auth" && segments[2] === "login" && request.method === "POST") {
    return handleLogin(request, env);
  }
  if (segments[1] === "auth" && segments[2] === "logout" && request.method === "POST") {
    return handleLogout(request, env);
  }
  if (segments[1] === "auth" && segments[2] === "me" && request.method === "GET") {
    return handleMe(request, env);
  }
  if (segments[1] === "checkin" && segments.length === 3 && request.method === "GET") {
    return handleCheckinStatus(request, env, segments[2]);
  }
  if (segments[1] === "checkin" && segments.length === 2 && request.method === "POST") {
    return handleCheckin(request, env);
  }
  if (segments[1] === "friends" && segments.length === 2 && request.method === "GET") {
    return handleListFriends(request, env);
  }
  if (segments[1] === "friends" && segments.length === 2 && request.method === "POST") {
    return handleAddFriend(request, env);
  }
  if (segments[1] === "friends" && segments.length === 3 && request.method === "DELETE") {
    return handleRemoveFriend(request, env, segments[2]);
  }
  if (segments[1] === "leaderboard" && segments.length === 2) {
    return handleLeaderboard(request, env);
  }
  // 매주 일요일 밤 자동 스크랩을 기다리지 않고 즉시 다시 긁어오고 싶을 때 수동으로 호출.
  if (segments[1] === "admin" && segments[2] === "refresh-k3k4-scorers" && request.method === "POST") {
    await scrapeK3K4TopScorers(env);
    return json({ ok: true });
  }
  if (segments[1] === "admin" && segments[2] === "refresh-kleague-top-players" && request.method === "POST") {
    await scrapeKLeagueTopPlayers(env);
    return json({ ok: true });
  }
  if (segments[1] === "admin" && segments[2] === "refresh-kleague-player-photos" && request.method === "POST") {
    await scrapeKLeaguePlayerPhotos(env);
    return json({ ok: true });
  }
  if (segments[1] === "admin" && segments[2] === "refresh-kleague-coach-photos" && request.method === "POST") {
    await scrapeKLeagueCoachPhotos(env);
    return json({ ok: true });
  }
  if (segments[1] === "admin" && segments[2] === "check-transfers" && request.method === "POST") {
    await detectTransfersAndNotify(env);
    return json({ ok: true });
  }
  // 새 리그 추가 후 로테이션 커서가 돌아올 때까지 기다리지 않고 즉시 순위를 채우고 싶을 때 수동 호출.
  if (segments[1] === "admin" && segments[2] === "refresh-standings" && request.method === "POST") {
    await refreshApiFootballStandings(env);
    return json({ ok: true });
  }
  if (segments[1] === "admin" && segments[2] === "refresh-transfer-market" && request.method === "POST") {
    await refreshTransferMarket(env);
    return json({ ok: true });
  }

  return json({ detail: "찾을 수 없는 경로" }, 404);
}
