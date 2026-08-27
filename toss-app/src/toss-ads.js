// 2026-08-27 - toss-notifications.js(Notification/User)와 별도 파일로 분리했다. 그쪽 SDK 사용이
// 미니앱 전체를 먹통으로 만드는 문제가 두 번 재확인됐는데(async 스크립트로도 못 피함), 알림 쪽
// 코드가 원인인지 광고 쪽(TossAds)이 원인인지 구분이 안 된 상태였다 - 이 파일은 TossAds만 import해서
// 광고만 따로 테스트해보기 위한 것(사용자 요청). 알림 관련 코드는 전혀 없다.
import { TossAds } from "@apps-in-toss/web-framework";

// 콘솔에서 발급받은 실제(운영) 배너 광고 그룹 ID(사용자 제공, 2026-08-26).
const LIVE_AD_GROUP_ID = "ait.v2.live.082ac21e3f3d4e7b";
// 토스 공식 문서 경고: 개발/테스트 중엔 반드시 이 테스트 ID를 써야 하고, 실제(live) ID로 테스트하면
// 정책 위반으로 불이익(이용 제한 등)을 받을 수 있다고 명시돼 있다 - 그래서 실제 심사/출시 직전까지는
// 이 테스트 ID를 쓴다. 심사 낼 때 LIVE_AD_GROUP_ID로 바꿔야 한다는 걸 잊지 말 것(2026-08-27).
const TEST_AD_GROUP_ID = "ait-ad-test-banner-id";
const AD_GROUP_ID = TEST_AD_GROUP_ID;

// 플로팅 탭바 바로 위에 고정 배치된 컨테이너(index.html #toss-ad-banner, 일반 웹/PWA/안드로이드
// 빌드에는 style.css에서 항상 display:none) - SDK 초기화가 실패하거나(구버전 토스 앱 등) 광고가
// 안 채워지면(onNoFill) 빈 배너가 자리만 차지하니 그 경우 컨테이너 자체를 숨긴다.
function initBannerAd() {
  const container = document.getElementById("toss-ad-banner");
  if (!container) return;
  if (!TossAds?.initialize?.isSupported?.()) {
    container.style.display = "none";
    return;
  }

  TossAds.initialize({
    callbacks: {
      onInitialized: () => {
        const result = TossAds.attachBanner(AD_GROUP_ID, container, {
          theme: "auto",
          tone: "blackAndWhite",
          variant: "expanded",
          callbacks: {
            onAdRendered: () => console.log("토스 배너 광고 렌더링 완료"),
            onNoFill: () => {
              console.warn("토스 배너 광고 - 채울 광고 없음(onNoFill)");
              container.style.display = "none";
            },
            onAdFailedToRender: (payload) => {
              console.error("토스 배너 광고 렌더링 실패:", payload?.error?.message);
              container.style.display = "none";
            },
          },
        });
        if (!result) container.style.display = "none";
      },
      onInitializationFailed: (error) => {
        console.error("토스 광고 SDK 초기화 실패:", error?.message);
        container.style.display = "none";
      },
    },
  });
}

initBannerAd();
