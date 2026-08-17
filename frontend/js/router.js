import { saveViewState } from "./viewState.js";
import { trackView } from "./analytics.js";

const PRIMARY_VIEWS = ["matches", "news", "leagues", "transfers", "ai", "myteam", "hof", "community", "settings"];

const state = { view: "matches" };

const els = {
  views: {},
  navButtons: document.querySelectorAll(".nav-btn"),
  backButtons: document.querySelectorAll(".back-btn"),
};

PRIMARY_VIEWS.concat(["detail", "team", "player", "soccerschool", "admin"]).forEach((name) => {
  els.views[name] = document.getElementById(`view-${name}`);
});

export function showView(name) {
  // 탭(주요 화면)을 실제로 새로 열 때만 집계한다 - 같은 탭을 다시 누르거나 상세/팀/선수 화면
  // 진입까지 다 세면 숫자가 부풀어서 탭별 사용량 비교에 의미가 없어진다.
  if (name !== state.view && (PRIMARY_VIEWS.includes(name) || name === "soccerschool")) trackView(name);
  state.view = name;
  Object.entries(els.views).forEach(([key, node]) => {
    if (node) node.classList.toggle("active", key === name);
  });
  els.navButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });
}

// 맨 처음 진입 시점의 히스토리 항목에도 "경기" 탭이라는 걸 표시해둔다 - 탭을 여러 번 옮겨다니다가
// 뒤로가기를 계속 눌러도 결국 이 항목(경기)에서 멈추게 하기 위함(그 밑으로 더 누르면 그제서야
// 앱을 벗어나는 원래 브라우저 동작으로 넘어감).
history.replaceState({ appView: "matches" }, "", location.href);

// 뒤로가기로 되돌릴 "화면 안" 동작들을 한 줄로 순서대로 쌓는 통합 스택 - 상세화면 진입(pushDetail)과
// 서브뷰 진입(pushSubView)을 예전엔 서로 다른 스택(state.history / subViewStack)으로 따로 관리해서,
// 리그 상세 -> 그 안에서 팀 상세 -> 선수 상세처럼 두 종류가 섞여서 중첩되면 뒤로가기가 항상 서브뷰
// 스택부터 확인하는 바람에 순서가 뒤바뀌는 버그가 있었다(예: 리그 상세에서 "← 리그 목록"을 눌렀는데
// 엉뚱하게 경기 탭으로 튀는 문제, 2026-07-26 제보). 실제로 쌓인 순서(=브라우저 히스토리 순서) 그대로
// 하나의 배열에 담아 항상 제일 최근 것부터 되돌리면 순서가 어긋나지 않는다.
const backStack = [];

// 모바일 브라우저/PWA의 하드웨어·제스처 뒤로가기가 앱을 바로 닫아버리지 않고 이전 화면으로
// 돌아가도록, 상세 화면에 들어갈 때마다 History API에도 항목을 쌓고 popstate를 이 스택과 맞춘다.
export function pushDetail(name) {
  const prevView = state.view;
  backStack.push({ kind: "detail", prevView });
  showView(name);
  history.pushState({ seq: backStack.length }, "", location.href);
}

// 리그 상세/이적시장 팀 목록/커뮤니티 글 상세처럼 최상위 view는 안 바뀌고 같은 탭 "안에서"
// 목록<->상세를 전환하는 경우를 위한 것 - pushDetail과 달리 view를 바꾸지 않고, 뒤로가기가
// 눌렸을 때 되돌릴 동작(onBack)만 콜백으로 받아 쌓아둔다.
export function pushSubView(onBack) {
  backStack.push({ kind: "subview", onBack });
  history.pushState({ seq: backStack.length }, "", location.href);
}

function popBackStack() {
  const entry = backStack.pop();
  if (!entry) return false;
  if (entry.kind === "detail") showView(entry.prevView);
  else entry.onBack();
  return true;
}

window.addEventListener("popstate", (event) => {
  // 화면 안 스택(상세/서브뷰)에 되돌릴 게 있으면 그것부터 처리한다.
  if (popBackStack()) return;
  // 탭을 옮겨다닐 때마다 쌓아둔 브라우저 히스토리 항목 자체에 그 시점의 탭 이름이 실려있으니,
  // 뒤로 이동한 그 항목이 가리키는 탭을 그대로 보여준다 - 여러 탭을 거쳐왔으면 한 번에 하나씩,
  // 순서대로 이전 탭으로 돌아가고, 맨 처음(경기) 항목까지 오면 더 눌러도 거기 머무른다.
  const targetView = event.state?.appView;
  if (targetView) {
    showView(targetView);
    saveViewState({ view: targetView });
  }
});

// 경기 탭의 대회 헤더에서 리그 탭의 순위 상세로 바로 넘어가기 위한 연결 고리 - matches.js가
// leagues.js를 직접 import하면 leagues.js도 이미 matches.js를 import하고 있어(loadMatchDetail)
// 순환 참조가 생기니(auth.js/api.js 분리와 같은 이유), 여기 router 계층에서 콜백만 중개한다.
let leagueStandingsOpener = null;
export function setLeagueStandingsOpener(fn) {
  leagueStandingsOpener = fn;
}
export function openLeagueStandings(code) {
  document.querySelector('.nav-btn[data-view="leagues"]')?.click();
  leagueStandingsOpener?.(code);
}

const onNavChange = [];
export function onTabChange(view, handler) {
  onNavChange.push({ view, handler });
}

els.navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const view = btn.dataset.view;
    // 실제로 탭이 바뀔 때만 히스토리 항목을 새로 쌓는다(이미 있는 탭을 다시 눌러도 중복으로
    // 쌓이지 않게) - 이렇게 탭을 옮길 때마다 하나씩 쌓아두면, 뒤로가기가 방문한 순서 그대로
    // 한 단계씩 되돌아가다가 맨 처음(경기) 항목에서 멈춘다.
    const changingView = view !== state.view;
    backStack.length = 0; // 탭 자체를 바꾸면 그 탭 안의 상세/서브뷰 기록은 의미 없으니 비운다.
    showView(view);
    if (changingView) {
      history.pushState({ appView: view }, "", location.href);
    } else {
      history.replaceState({ appView: view }, "", location.href);
    }
    saveViewState({ view });
    onNavChange.filter((h) => h.view === view).forEach((h) => h.handler());
  });
});

els.backButtons.forEach((btn) => {
  btn.addEventListener("click", () => history.back());
});
