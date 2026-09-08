// 앱인토스 심사 반려(2026-09-08) - "내부 경기 상세 화면에서 상단 뒤로가기를 눌렀으나 이전 경기
// 목록이 아니라 미니앱이 종료됩니다." toss-ads.js/toss-notifications.js와 마찬가지로 별도 파일로
// 분리해서 esbuild로 단독 번들한다 - Notification/User SDK가 미니앱 전체를 먹통으로 만든 전례가
// 있어서(toss-notifications.js 주석 참고), 새 SDK 모듈(graniteEvent)을 추가할 때도 다른 코드와
// 절대 안 섞이게 격리해둔다.
//
// graniteEvent.addEventListener("backEvent", ...)로 구독하면 토스 웹뷰의 시스템 뒤로가기(상단 버튼/
// 제스처 공용)를 우리가 가로챌 수 있다 - 구독 안 하면 토스 기본 동작(미니앱 그냥 닫기)이 그대로 실행된다.
import { graniteEvent, closeView } from "@apps-in-toss/web-framework";

graniteEvent.addEventListener("backEvent", {
  onEvent: () => {
    // router.js가 심어둔 전역(window.__pitchProTossHandleBack) - 앱 안에 되돌아갈 화면이 있으면
    // 그리로 이동시키고 true, 이미 맨 처음(경기 목록) 화면이면 false를 돌려준다. app.js 로딩 전이라
    // 아직 이 함수가 없을 수도 있는 아주 짧은 순간엔 안전하게 그냥 미니앱을 닫는다.
    const handled = window.__pitchProTossHandleBack?.();
    if (!handled) closeView();
  },
  onError: (err) => console.error("토스 뒤로가기 이벤트 구독 실패:", err),
});
