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
import { handleTrack, handleAnalyticsSummary } from "./routes/track.js";
import { handleBackupExport } from "./routes/backup.js";
import {
  handleVapidPublicKey,
  handleSubscribe,
  handleUnsubscribe,
  handleWatchMatch,
  handleGetPreferences,
  handleSetPreferences,
  handleTestPush,
} from "./routes/push.js";
import { handleTossSubscribe, handleTossWatchMatch } from "./routes/toss.js";
import {
  handleGoalNotificationImage,
  handleMatchStatusNotificationImage,
  handleTransferNotificationImage,
} from "./routes/notifImage.js";
import {
  handleSignup,
  handleLogin,
  handleLogout,
  handleMe,
  handleDeleteAccount,
  handleFindUsername,
  handleCheckSecurityQuestion,
  handleResetPasswordWithAnswer,
} from "./routes/auth.js";
import { handlePointsHistory } from "./routes/points.js";
import { handleCheckin, handleCheckinStatus } from "./routes/checkin.js";
import {
  handleSendFriendRequest,
  handleRemoveFriend,
  handleListFriends,
  handleListFriendRequests,
  handleAcceptFriendRequest,
  handleDeclineFriendRequest,
} from "./routes/friends.js";
import { handleUserSearch } from "./routes/userSearch.js";
import {
  handleListPosts,
  handleCreatePost,
  handleReportPost,
  handleReportComment,
  handleListReports,
  handleResolveReport,
  handleGetPost,
  handleCreateComment,
  handleEditComment,
  handleDeletePost,
  handleDeleteComment,
} from "./routes/community.js";
import { handleLeaderboard } from "./routes/leaderboard.js";
import { scrapeK3K4TopScorers } from "./scheduled/scrapeK3K4TopScorers.js";
import { scrapeKLeagueTopPlayers } from "./scheduled/scrapeKLeagueTopPlayers.js";
import { scrapeKLeaguePlayerPhotos } from "./scheduled/scrapeKLeaguePlayerPhotos.js";
import { scrapeKLeagueCoachPhotos } from "./scheduled/scrapeKLeagueCoachPhotos.js";
import { detectTransfersAndNotify } from "./scheduled/detectTransfersAndNotify.js";
import { refreshApiFootballStandings } from "./scheduled/refreshApiFootballStandings.js";
import { refreshApiFootballMatches, fetchAndStoreMatches } from "./scheduled/refreshApiFootballMatches.js";
import { refreshTransferMarket } from "./scheduled/refreshTransferMarket.js";
import { enrichTransferFees } from "./scheduled/enrichTransferFees.js";
import { refreshKLeagueResults } from "./scheduled/refreshKLeagueResults.js";
import { refreshKfaResults } from "./scheduled/refreshKfaResults.js";
import { refreshKfaCupResults } from "./scheduled/refreshKfaCupResults.js";
import { resolveCheckinOutcomes } from "./scheduled/resolveCheckinOutcomes.js";
import { detectCardsAndNotify } from "./scheduled/detectCardsAndNotify.js";
import { refreshNationalTeams } from "./scheduled/refreshNationalTeams.js";
import { refreshAnalysis } from "./scheduled/refreshAnalysis.js";
import { KV_KEYS, GOAT_USERNAMES } from "./lib/config.js";
import { getJSON, putJSON } from "./lib/kv.js";
import { userKey, nicknameIndexKey, hashPassword, getAuthedUser } from "./lib/auth.js";

export async function routeApiRequest(request, env, ctx) {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean); // ["api", ...]

  // /api/admin/* 는 전부 관리자(GOAT_USERNAMES) 전용이어야 하는데, 라우트마다 각자 체크하는 방식이라
  // 새 라우트를 추가할 때 깜빡 빠뜨리기 쉬웠다 - 실제로 delete-user/reset-password/users/checkins/
  // test-push까지 인증 체크가 아예 없이 열려있던 걸 관리자 페이지 분리 작업 중 테스트하다 발견했다
  // (프론트에서 버튼만 숨겨뒀을 뿐 서버는 누구든 호출 가능한 상태였음). 개별 라우트를 하나씩 고치는
  // 대신 여기서 한 번에 막아서, 앞으로 admin 라우트가 추가돼도 이 게이트를 빠져나갈 수 없게 한다.
  if (segments[1] === "admin") {
    const adminUser = await getAuthedUser(request, env);
    if (!adminUser || !GOAT_USERNAMES.includes(adminUser.username)) {
      return json({ detail: "권한이 없습니다." }, 403);
    }
  }

  if (segments[1] === "health" && segments.length === 2) {
    return handleHealth(request, env);
  }
  if (segments[1] === "competitions" && segments.length === 2) {
    return handleCompetitions();
  }
  if (segments[1] === "matches" && segments.length === 2) {
    return handleMatches(request, env, url);
  }
  if (segments[1] === "notif-image" && segments[2] === "goal" && request.method === "GET") {
    return handleGoalNotificationImage(request, env, url);
  }
  if (segments[1] === "notif-image" && segments[2] === "status" && request.method === "GET") {
    return handleMatchStatusNotificationImage(request, env, url);
  }
  if (segments[1] === "notif-image" && segments[2] === "transfer" && request.method === "GET") {
    return handleTransferNotificationImage(request, env, url);
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
  if (segments[1] === "track" && segments.length === 2 && request.method === "POST") {
    return handleTrack(request, env);
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
  if (segments[1] === "push" && segments[2] === "preferences" && request.method === "GET") {
    return handleGetPreferences(request, env, url);
  }
  if (segments[1] === "push" && segments[2] === "preferences" && request.method === "POST") {
    return handleSetPreferences(request, env);
  }
  if (segments[1] === "admin" && segments[2] === "test-push" && request.method === "POST") {
    return handleTestPush(request, env);
  }
  if (segments[1] === "toss" && segments[2] === "subscribe" && request.method === "POST") {
    return handleTossSubscribe(request, env);
  }
  if (segments[1] === "toss" && segments[2] === "watch-match" && request.method === "POST") {
    return handleTossWatchMatch(request, env);
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
  if (segments[1] === "auth" && segments[2] === "me" && request.method === "DELETE") {
    return handleDeleteAccount(request, env);
  }
  if (segments[1] === "auth" && segments[2] === "find-username" && request.method === "POST") {
    return handleFindUsername(request, env);
  }
  if (segments[1] === "auth" && segments[2] === "find-password" && segments[3] === "check" && request.method === "POST") {
    return handleCheckSecurityQuestion(request, env);
  }
  if (segments[1] === "auth" && segments[2] === "find-password" && segments[3] === "reset" && request.method === "POST") {
    return handleResetPasswordWithAnswer(request, env);
  }
  if (segments[1] === "points" && segments[2] === "history" && request.method === "GET") {
    return handlePointsHistory(request, env);
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
  if (segments[1] === "friends" && segments[2] === "request" && segments.length === 3 && request.method === "POST") {
    return handleSendFriendRequest(request, env);
  }
  if (segments[1] === "friends" && segments[2] === "requests" && segments.length === 3 && request.method === "GET") {
    return handleListFriendRequests(request, env);
  }
  if (segments[1] === "friends" && segments[2] === "requests" && segments.length === 5 && segments[4] === "accept" && request.method === "POST") {
    return handleAcceptFriendRequest(request, env, segments[3]);
  }
  if (segments[1] === "friends" && segments[2] === "requests" && segments.length === 5 && segments[4] === "decline" && request.method === "POST") {
    return handleDeclineFriendRequest(request, env, segments[3]);
  }
  if (segments[1] === "friends" && segments.length === 3 && request.method === "DELETE") {
    return handleRemoveFriend(request, env, segments[2]);
  }
  // 팬 커뮤니티 게시판 - 목록/글쓰기는 로그인 없이도 읽을 순 있지만 쓰기(글/댓글)는 로그인 필요.
  if (segments[1] === "community" && segments[2] === "posts" && segments.length === 3 && request.method === "GET") {
    return handleListPosts(request, env, url);
  }
  if (segments[1] === "community" && segments[2] === "posts" && segments.length === 3 && request.method === "POST") {
    return handleCreatePost(request, env);
  }
  if (segments[1] === "community" && segments[2] === "posts" && segments.length === 4 && request.method === "GET") {
    return handleGetPost(request, env, segments[3]);
  }
  if (segments[1] === "community" && segments[2] === "posts" && segments.length === 4 && request.method === "DELETE") {
    return handleDeletePost(request, env, segments[3]);
  }
  if (segments[1] === "community" && segments[2] === "posts" && segments[4] === "comments" && segments.length === 5 && request.method === "POST") {
    return handleCreateComment(request, env, segments[3]);
  }
  if (segments[1] === "community" && segments[2] === "posts" && segments[4] === "comments" && segments.length === 6 && request.method === "DELETE") {
    return handleDeleteComment(request, env, segments[3], segments[5]);
  }
  if (segments[1] === "community" && segments[2] === "posts" && segments[4] === "comments" && segments.length === 6 && request.method === "PUT") {
    return handleEditComment(request, env, segments[3], segments[5]);
  }
  if (segments[1] === "community" && segments[2] === "posts" && segments[4] === "report" && segments.length === 5 && request.method === "POST") {
    return handleReportPost(request, env, segments[3]);
  }
  if (
    segments[1] === "community" &&
    segments[2] === "posts" &&
    segments[4] === "comments" &&
    segments[6] === "report" &&
    segments.length === 7 &&
    request.method === "POST"
  ) {
    return handleReportComment(request, env, segments[3], segments[5]);
  }
  if (segments[1] === "users" && segments[2] === "search" && segments.length === 3) {
    return handleUserSearch(request, env, url);
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
  // 새로 넓힌 경기 일정 범위(연말까지)나 새 대회(국가대표 친선경기) 반영을 크론 게이트 기다리지 않고
  // 바로 확인하고 싶을 때 수동 호출. force=1이면 최소 간격 게이트까지 건너뛰고 즉시 조회한다
  // (남발하면 API 호출이 늘어나니 확인 목적으로만 쓸 것).
  if (segments[1] === "admin" && segments[2] === "refresh-matches" && request.method === "POST") {
    if (url.searchParams.get("force") === "1") {
      const existing = await getJSON(env, KV_KEYS.matches);
      await fetchAndStoreMatches(env, existing);
    } else {
      await refreshApiFootballMatches(env);
    }
    return json({ ok: true });
  }
  // 경기 상세 캐시(5분 TTL)가 만료되기 전에, 방금 배포한 수정이 반영된 값을 바로 확인하고 싶을 때
  // (예: kleague 폴백 파싱 로직 수정 후) 특정 경기 캐시만 지운다.
  if (segments[1] === "admin" && segments[2] === "clear-match-detail-cache" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const id = body?.id;
    if (!id) return json({ detail: "id가 필요합니다." }, 400);
    await env.CACHE.delete(`${KV_KEYS.detailPrefix}${id}`);
    return json({ ok: true });
  }
  if (segments[1] === "admin" && segments[2] === "refresh-transfer-market" && request.method === "POST") {
    await refreshTransferMarket(env);
    return json({ ok: true });
  }
  if (segments[1] === "admin" && segments[2] === "enrich-transfer-fees" && request.method === "POST") {
    await enrichTransferFees(env);
    return json({ ok: true });
  }
  if (segments[1] === "admin" && segments[2] === "refresh-kleague-results" && request.method === "POST") {
    await refreshKLeagueResults(env);
    return json({ ok: true });
  }
  if (segments[1] === "admin" && segments[2] === "refresh-kfa-results" && request.method === "POST") {
    await refreshKfaResults(env);
    return json({ ok: true });
  }
  if (segments[1] === "admin" && segments[2] === "refresh-kfa-cup-results" && request.method === "POST") {
    await refreshKfaCupResults(env);
    return json({ ok: true });
  }
  if (segments[1] === "admin" && segments[2] === "resolve-checkin-outcomes" && request.method === "POST") {
    await resolveCheckinOutcomes(env);
    return json({ ok: true });
  }
  // 크론 실패 시 관리자 푸시가 실제로 오는지 확인하는 수동 테스트용 - 중복 방지 캐시를 건너뛰도록
  // 매번 다른 작업 이름을 써서 dedupe에 걸리지 않게 한다.
  if (segments[1] === "admin" && segments[2] === "analytics" && request.method === "GET") {
    return handleAnalyticsSummary(request, env, url);
  }
  if (segments[1] === "admin" && segments[2] === "backup-export" && request.method === "GET") {
    return handleBackupExport(request, env);
  }
  if (segments[1] === "admin" && segments[2] === "reports" && segments.length === 3 && request.method === "GET") {
    return handleListReports(request, env);
  }
  if (segments[1] === "admin" && segments[2] === "reports" && segments[4] === "resolve" && segments.length === 5 && request.method === "POST") {
    return handleResolveReport(request, env, segments[3]);
  }
  if (segments[1] === "admin" && segments[2] === "test-cron-alert" && request.method === "POST") {
    const { alertAdminOfFailure } = await import("./lib/adminAlert.js");
    await alertAdminOfFailure(env, `테스트-${Date.now()}`, new Error("관리자 알림 테스트입니다."));
    return json({ ok: true });
  }
  // 실제 퇴장 이벤트를 기다리지 않고도 크론 로직이 정상 동작하는지 즉시 확인하고 싶을 때 수동 호출.
  if (segments[1] === "admin" && segments[2] === "check-cards" && request.method === "POST") {
    await detectCardsAndNotify(env);
    return json({ ok: true });
  }
  // 하루 주기 크론을 기다리지 않고 국가대표팀 명단을 바로 채우고 싶을 때 수동 호출.
  if (segments[1] === "admin" && segments[2] === "refresh-national-teams" && request.method === "POST") {
    await refreshNationalTeams(env);
    return json({ ok: true });
  }
  // AI 분석 캐시를 15분 크론을 기다리지 않고 바로 다시 채우고 싶을 때(냉캐시 응답 속도 확인 등) 수동 호출.
  if (segments[1] === "admin" && segments[2] === "refresh-analysis" && request.method === "POST") {
    await refreshAnalysis(env);
    return json({ ok: true });
  }
  // 테스트/도배성 게시글을 작성자 로그인 없이도 바로 지우고 싶을 때(운영자용) 수동 호출.
  if (segments[1] === "admin" && segments[2] === "community-delete-post" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const id = body?.id;
    if (!id) return json({ detail: "id가 필요합니다." }, 400);
    await env.CACHE.delete(`${KV_KEYS.communityPostPrefix}${id}`);
    const index = (await getJSON(env, KV_KEYS.communityPostIndex))?.posts || [];
    await putJSON(env, KV_KEYS.communityPostIndex, { posts: index.filter((p) => p.id !== id) });
    return json({ ok: true });
  }
  // 실사용자/테스트 계정을 가려내기 위한 조회용 - 계정 목록과 가입일/포인트/즐겨찾기팀만 보여주고
  // 비밀번호 해시 등 민감 정보는 응답에 포함하지 않는다.
  if (segments[1] === "admin" && segments[2] === "users" && request.method === "GET") {
    const list = await env.CACHE.list({ prefix: KV_KEYS.userPrefix });
    const users = await Promise.all(
      list.keys.map(async (k) => {
        const u = await getJSON(env, k.name);
        if (!u) return null;
        return {
          username: u.username,
          nickname: u.nickname,
          points: u.points || 0,
          level: u.level || 1,
          favoriteTeamName: u.favoriteTeamName || null,
          friendsCount: (u.friends || []).length,
          createdAt: u.createdAt || null,
        };
      })
    );
    return json({ users: users.filter(Boolean).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || "")) });
  }
  // 집관인증 포인트 정산이 왜 안 됐는지 확인용 - 특정 유저의 체크인 기록 전부를 보여준다.
  if (segments[1] === "admin" && segments[2] === "checkins" && request.method === "GET") {
    const username = (url.searchParams.get("username") || "").trim().toLowerCase();
    if (!username) return json({ detail: "username 쿼리파라미터가 필요합니다." }, 400);
    const list = await env.CACHE.list({ prefix: `${KV_KEYS.checkinPrefix}${username}:` });
    const records = await Promise.all(list.keys.map((k) => getJSON(env, k.name)));
    return json({ checkins: records.filter(Boolean) });
  }
  // 테스트/미사용 계정 정리용 - 유저 레코드 + 닉네임 색인을 함께 지운다(세션은 TTL로 자연 만료).
  if (segments[1] === "admin" && segments[2] === "delete-user" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const username = String(body?.username || "").trim().toLowerCase();
    if (!username) return json({ detail: "username이 필요합니다." }, 400);
    const user = await getJSON(env, userKey(username));
    if (!user) return json({ detail: "사용자를 찾을 수 없습니다." }, 404);
    await env.CACHE.delete(userKey(username));
    if (user.nickname) await env.CACHE.delete(nicknameIndexKey(user.nickname));
    return json({ ok: true, deleted: username });
  }
  // 본인이 아이디/비번 찾기로도 못 살리는 계정(보안 답변 미설정 등)을 운영자가 대신 초기화해줄 때
  // 쓰는 관리자 전용 엔드포인트 - 기존 비밀번호 확인 없이 새 비밀번호로 바로 덮어쓴다.
  if (segments[1] === "admin" && segments[2] === "reset-password" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const username = String(body?.username || "").trim().toLowerCase();
    const newPassword = String(body?.newPassword || "");
    if (!username) return json({ detail: "username이 필요합니다." }, 400);
    if (newPassword.length < 6) return json({ detail: "비밀번호는 6자 이상이어야 합니다." }, 400);
    const user = await getJSON(env, userKey(username));
    if (!user) return json({ detail: "사용자를 찾을 수 없습니다." }, 404);
    user.passwordHash = await hashPassword(newPassword);
    await putJSON(env, userKey(username), user);
    return json({ ok: true, username });
  }

  return json({ detail: "찾을 수 없는 경로" }, 404);
}
