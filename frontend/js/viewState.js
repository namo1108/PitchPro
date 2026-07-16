// 새로고침(브라우저/PWA의 pull-to-refresh 등)이 페이지를 완전히 다시 로드해도, 보고 있던 화면으로
// 되돌아올 수 있도록 현재 화면을 세션에 기록해둔다. CSS로 새로고침 제스처 자체를 막는 방법은 기기별로
// 스크롤까지 막아버리는 부작용이 있어서, 대신 이 방식으로 "새로고침해도 제자리" 를 구현한다.
const KEY = "pitchpro.lastView";

export function saveViewState(viewState) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(viewState));
  } catch {
    // sessionStorage 사용 불가 환경이면 조용히 무시(그냥 새로고침 시 홈으로 감)
  }
}

export function loadViewState() {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
