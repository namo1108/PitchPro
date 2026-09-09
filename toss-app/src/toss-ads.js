// 2026-08-27 - toss-notifications.js(Notification/User)와 별도 파일로 분리했다. 그쪽 SDK 사용이
// 미니앱 전체를 먹통으로 만드는 문제가 두 번 재확인됐는데(async 스크립트로도 못 피함), 알림 쪽
// 코드가 원인인지 광고 쪽이 원인인지 구분이 안 된 상태였다 - 이 파일은 광고 SDK만 import해서
// 광고만 따로 테스트해보기 위한 것(사용자 요청). 알림 관련 코드는 전혀 없다.
//
// 2026-09-09 - 하단 플로팅 배너(TossAds.attachBanner)에서 전면(풀스크린) 광고로 교체(사용자 요청).
// loadFullScreenAd로 미리 불러두고, "loaded" 이벤트가 오면 바로 showFullScreenAd로 노출한다.
// 앱 켤 때 한 번만 뜨는 구조 - 이 스크립트 자체가 미니앱 로딩 시점에 한 번만 실행되니 탭을 옮겨
// 다녀도 다시 뜨지 않는다(재실행되려면 미니앱을 완전히 새로 열어야 함).
import { loadFullScreenAd, showFullScreenAd } from "@apps-in-toss/web-framework";

// 콘솔에서 발급받은 실제(운영) 전면광고 그룹 ID(사용자 제공, 2026-09-09 배너 -> 전면 교체).
const AD_GROUP_ID = "ait.v2.live.082ac21e3f3d4e7b";

function showInterstitialAd() {
  if (!loadFullScreenAd?.isSupported?.() || !showFullScreenAd?.isSupported?.()) return;

  loadFullScreenAd({
    options: { adGroupId: AD_GROUP_ID },
    onEvent: (event) => {
      if (event.type !== "loaded") return;
      showFullScreenAd({
        options: { adGroupId: AD_GROUP_ID },
        onEvent: (showEvent) => {
          if (showEvent.type === "failedToShow") console.error("토스 전면광고 노출 실패");
        },
        onError: (err) => console.error("토스 전면광고 노출 요청 실패:", err?.message),
      });
    },
    onError: (err) => {
      // 채울 광고가 없거나(no-fill) SDK 미지원인 경우도 여기로 온다 - 조용히 넘어간다(배너와
      // 달리 노출 자리를 따로 차지하지 않으니 화면에 빈 공간이 남을 걱정은 없음).
      console.warn("토스 전면광고 불러오기 실패(no-fill 포함 가능):", err?.message);
    },
  });
}

showInterstitialAd();
