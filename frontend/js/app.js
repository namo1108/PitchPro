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

// 새로고침(브라우저/PWA pull-to-refresh 포함) 후에도 보고 있던 화면으로 돌아가도록, 세션에 저장해둔
// 마지막 화면이 있으면 그걸 복원하고, 없으면(첫 방문 등) 평소대로 오늘 경기 목록을 보여준다.
const lastView = loadViewState();

if (lastView?.view === "detail" && lastView.matchId) {
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
