// 바텀 네비게이션이 8개까지 늘어나서 답답해 보여, 자주 안 쓰는 3개(이적시장/AI분석/명예의전당)를
// "더보기" 팝오버 안으로 옮겼다. 안의 버튼들은 원래 그대로의 .nav-btn/data-view라 router.js의
// 탭 전환 로직은 손대지 않고, 이 파일은 팝오버를 열고/닫는 것만 담당한다.
const menu = document.getElementById("more-menu");
const toggleBtn = document.getElementById("more-toggle-btn");
const MORE_MENU_VIEWS = ["transfers", "ai", "hof", "settings"];

function closeMenu() {
  menu.classList.remove("open");
}

function openMenu() {
  menu.classList.add("open");
}

// 지금 활성화된 화면이 더보기 메뉴 안의 것이면 토글 버튼도 같이 강조 표시한다.
function syncToggleActiveState() {
  const isMoreView = MORE_MENU_VIEWS.some((v) => document.getElementById(`view-${v}`)?.classList.contains("active"));
  toggleBtn.classList.toggle("active", isMoreView);
}

toggleBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (menu.classList.contains("open")) closeMenu();
  else openMenu();
});

document.addEventListener("click", (e) => {
  if (menu.classList.contains("open") && !menu.contains(e.target) && e.target !== toggleBtn) closeMenu();
  // router.js의 탭 전환(showView)이 같은 클릭 이벤트 안에서 동기적으로 먼저 반영되지만, 리스너 등록
  // 순서에 기대지 않도록 다음 틱에 한 번 더 확인해서 토글 버튼 강조 상태를 맞춘다.
  if (e.target.closest(".nav-btn")) setTimeout(syncToggleActiveState, 0);
});

menu.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", closeMenu);
});
