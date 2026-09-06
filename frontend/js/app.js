import "./router.js";
import "./moreMenu.js";
import { loadMatches, loadMatchDetail, setDayOffset } from "./views/matches.js";
import "./views/leagues.js";
import "./views/news.js";
import "./views/transfers.js";
import "./views/aiAnalysis.js";
import "./views/myTeam.js";
import "./views/hallOfFame.js";
import "./views/community.js";
import "./views/soccerSchool.js";
import "./views/settings.js";
import "./views/admin.js";
import { goToTeam } from "./views/teamDetail.js";
import { goToPlayer } from "./views/playerDetail.js";
import { openPost } from "./views/community.js";
import { initPushButton } from "./push.js";
import { loadViewState } from "./viewState.js";
import { refreshMe } from "./auth.js";
import { initOnboarding } from "./onboarding.js";
import { initInstallBanner } from "./install.js";
import { initUpdateNotes } from "./updateNotes.js";

// 경기/뉴스/리그/AI분석/즐겨찾기(골 알림 포함)는 로그인 없이도 그대로 쓸 수 있어야 한다(나의 팀 탭
// 안내문 참고) - 로그인은 집관인증/친구/명예의전당 같은 선택 기능에만 필요하므로 앱 시작을 막지 않는다.
// 이미 로그인돼 있으면(토큰 있음) 최신 프로필로 갱신하고, 없으면 조용히 아무 일도 하지 않는다.
refreshMe();

// 알림 배너를 눌러서 들어온 경우(골 -> 경기 정보, 라인업 -> 라인업 탭, 이적 -> 선수 정보, 댓글 ->
// 그 글, 친구 요청/수락 -> 나의 팀) 종류에 맞는 화면으로 바로 이동한다. sw.js가 이미 열려있는 창에는
// postMessage로, 완전히 새로 띄우는 창에는 쿼리스트링으로 이 정보를 실어보낸다.
function routeFromNotificationData(data) {
  if (!data) return;
  if (data.matchId) {
    document.querySelector('.nav-btn[data-view="matches"]')?.click();
    loadMatchDetail(data.matchId, undefined, data.type === "lineup" ? "lineup" : "info");
  } else if (data.type === "transfer" && data.playerId) {
    document.querySelector('.nav-btn[data-view="transfers"]')?.click();
    goToPlayer(data.playerId);
  } else if (data.type === "comment" && data.postId) {
    document.querySelector('.nav-btn[data-view="community"]')?.click();
    openPost(data.postId);
  } else if (data.type === "friend_request" || data.type === "friend_accept") {
    document.querySelector('.nav-btn[data-view="myteam"]')?.click();
  }
}

navigator.serviceWorker?.addEventListener("message", (event) => {
  if (event.data?.type === "notification-navigate") routeFromNotificationData(event.data.data);
});

// 새로고침(브라우저/PWA pull-to-refresh 포함) 후에도 보고 있던 화면으로 돌아가도록, 세션에 저장해둔
// 마지막 화면이 있으면 그걸 복원하고, 없으면(첫 방문 등) 평소대로 오늘 경기 목록을 보여준다.
const lastView = loadViewState();

// 알림을 눌러서 앱이 완전히 새로 켜진 경우(위 메시지 방식 대신 URL 쿼리스트링으로 전달됨) - 세션
// 복원보다 우선한다(방금 누른 알림이 예전에 보던 화면보다 더 최근 의도니까). 한 번 처리한 뒤엔 주소를
// 정리해서, 이 페이지를 새로고침해도 같은 알림으로 또 이동해버리지 않게 한다.
const notifParams = new URLSearchParams(location.search);
if (notifParams.get("notif") === "1") {
  routeFromNotificationData(Object.fromEntries(notifParams));
  history.replaceState(null, "", location.pathname);
} else if (lastView?.view === "detail" && lastView.matchId) {
  loadMatchDetail(lastView.matchId);
} else if (lastView?.view === "team" && lastView.teamId) {
  goToTeam(lastView.teamId);
} else if (lastView?.view === "player" && lastView.playerId) {
  goToPlayer(lastView.playerId);
} else if (lastView?.view && lastView.view !== "matches") {
  document.querySelector(`.nav-btn[data-view="${lastView.view}"]`)?.click();
} else {
  if (typeof lastView?.dayOffset === "number") setDayOffset(lastView.dayOffset);
  loadMatches();
}

initPushButton();
initOnboarding();
initInstallBanner();
initUpdateNotes();
