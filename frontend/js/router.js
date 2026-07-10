const PRIMARY_VIEWS = ["matches", "news", "leagues", "ai", "myteam"];

const state = {
  view: "matches",
  returnTo: "matches",
};

const els = {
  views: {},
  navButtons: document.querySelectorAll(".nav-btn"),
  backButtons: document.querySelectorAll(".back-btn"),
};

PRIMARY_VIEWS.concat(["detail", "team"]).forEach((name) => {
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

export function pushDetail(name) {
  if (PRIMARY_VIEWS.includes(state.view)) {
    state.returnTo = state.view;
  }
  showView(name);
}

export function goBack() {
  showView(state.returnTo);
}

const onNavChange = [];
export function onTabChange(view, handler) {
  onNavChange.push({ view, handler });
}

els.navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const view = btn.dataset.view;
    showView(view);
    onNavChange.filter((h) => h.view === view).forEach((h) => h.handler());
  });
});

els.backButtons.forEach((btn) => {
  btn.addEventListener("click", () => goBack());
});
