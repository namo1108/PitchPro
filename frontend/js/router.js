import { saveViewState } from "./viewState.js";

const PRIMARY_VIEWS = ["matches", "news", "leagues", "transfers", "ai", "myteam", "hof"];

const state = {
  view: "matches",
  history: [], // 뒤로가기용 이전 화면 스택(팀 상세 -> 선수 상세처럼 2단 이상 진입할 수 있어서 단일 값이 아닌 스택으로 관리)
};

const els = {
  views: {},
  navButtons: document.querySelectorAll(".nav-btn"),
  backButtons: document.querySelectorAll(".back-btn"),
};

PRIMARY_VIEWS.concat(["detail", "team", "player", "soccerschool"]).forEach((name) => {
  els.views[name] = document.getElementById(`view-${name}`);
});

export function showView(name) {
  state.view = name;
  Object.entries(els.views).forEach(([key, node]) => {
    if (node) node.classList.toggle("active", key === name);
  });
  els.navButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });
}

// 모바일 브라우저/PWA의 하드웨어·제스처 뒤로가기가 앱을 바로 닫아버리지 않고 이전 화면으로
// 돌아가도록, 상세 화면에 들어갈 때마다 History API에도 항목을 쌓고 popstate를 우리 스택과 맞춘다.
export function pushDetail(name) {
  state.history.push(state.view);
  showView(name);
  history.pushState({ appView: name }, "", location.href);
}

export function goBack() {
  const prev = state.history.pop() || "matches";
  showView(prev);
}

window.addEventListener("popstate", () => {
  // 스택이 비어 있으면(기본 탭 화면) 우리가 가로채지 않고 브라우저가 원래 하려던 동작(앱 종료 등)을 그대로 둔다.
  if (state.history.length > 0) {
    goBack();
  }
});

const onNavChange = [];
export function onTabChange(view, handler) {
  onNavChange.push({ view, handler });
}

els.navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const view = btn.dataset.view;
    state.history = [];
    showView(view);
    history.replaceState({ appView: view }, "", location.href);
    saveViewState({ view });
    onNavChange.filter((h) => h.view === view).forEach((h) => h.handler());
  });
});

els.backButtons.forEach((btn) => {
  btn.addEventListener("click", () => history.back());
});
