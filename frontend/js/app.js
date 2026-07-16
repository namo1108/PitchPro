import "./router.js";
import { loadMatches, loadMatchDetail, setDayOffset } from "./views/matches.js";
import "./views/leagues.js";
import "./views/news.js";
import "./views/transfers.js";
import "./views/aiAnalysis.js";
import "./views/myTeam.js";
import "./views/hallOfFame.js";
import "./views/soccerSchool.js";
import { goToTeam } from "./views/teamDetail.js";
import { goToPlayer } from "./views/playerDetail.js";
import { initPushButton } from "./push.js";
import { loadViewState } from "./viewState.js";
import { refreshMe } from "./auth.js";
import { whenAuthenticated } from "./authGate.js";

// 로그인 게이트를 통과해야(이미 로그인돼 있거나, 방금 로그인/회원가입하면) 앱 본편이 시작된다.
whenAuthenticated(() => {
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
});
