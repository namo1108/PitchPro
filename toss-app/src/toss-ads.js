// 2026-08-27 - toss-notifications.js(Notification/User)와 별도 파일로 분리했다. 그쪽 SDK 사용이
// 미니앱 전체를 먹통으로 만드는 문제가 두 번 재확인됐는데(async 스크립트로도 못 피함), 알림 쪽
// 코드가 원인인지 광고 쪽이 원인인지 구분이 안 된 상태였다 - 이 파일은 광고 SDK만 import해서
// 광고만 따로 테스트해보기 위한 것(사용자 요청). 알림 관련 코드는 전혀 없다.
//
// 2026-09-09 - 하단 플로팅 배너(TossAds.attachBanner)에서 전면(풀스크린) 광고로 교체(사용자 요청).
// 2026-09-10 1차 반려: "유저가 예상하기 어려운 시점에 광고가 노출돼요. 광고 노출 전에 유저가 인지할
// 수 있도록 CTA 문구나 UI를 추가해 주세요." -> loadFullScreenAd로 미리 불러만 두고, 실제로 다
// 불러졌을 때(광고가 있을 때만) 화면 안내 + "확인" 버튼을 띄운 뒤 사용자가 직접 눌러야만 노출하도록
// 고쳤는데, 바로 다음 반려: "미니앱 접속 직후 바텀시트가 바로 노출돼요." - 안내창 자체가 앱 켜자마자
// (광고 로드가 끝나는 대로) 자동으로 뜨는 게 문제였다. 그래서 안내창은 광고가 준비돼 있어도 사용자가
// 화면을 한 번이라도 탭하기 전까진 절대 띄우지 않는다 - "접속 직후"라는 시점 자체를 없앤다.
import { loadFullScreenAd, showFullScreenAd } from "@apps-in-toss/web-framework";

// 콘솔에서 발급받은 실제(운영) 전면광고 그룹 ID(사용자 제공, 2026-09-09 배너 -> 전면 교체).
const AD_GROUP_ID = "ait.v2.live.082ac21e3f3d4e7b";

function showAdNotice(onConfirm) {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);";
  overlay.innerHTML = `
    <div style="background:#181c24;color:#fff;padding:28px 24px;border-radius:20px;text-align:center;max-width:260px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <div style="font-size:34px;margin-bottom:10px;">📢</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:6px;">잠시 후 광고가 표시돼요</div>
      <div style="font-size:13px;color:#9aa0ac;margin-bottom:18px;">확인을 누르면 광고가 시작돼요</div>
      <button id="pitchpro-ad-confirm" style="width:100%;padding:12px 0;border:none;border-radius:12px;background:#3182f6;color:#fff;font-size:15px;font-weight:700;">확인</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#pitchpro-ad-confirm").addEventListener("click", () => {
    overlay.remove();
    onConfirm();
  });
}

function initInterstitialAd() {
  if (!loadFullScreenAd?.isSupported?.() || !showFullScreenAd?.isSupported?.()) return;

  let adReady = false;
  let userInteracted = false;
  let noticeShown = false;

  const maybeShow = () => {
    if (noticeShown || !adReady || !userInteracted) return;
    noticeShown = true;
    showAdNotice(() => {
      showFullScreenAd({
        options: { adGroupId: AD_GROUP_ID },
        onEvent: (showEvent) => {
          if (showEvent.type === "failedToShow") console.error("토스 전면광고 노출 실패");
        },
        onError: (err) => console.error("토스 전면광고 노출 요청 실패:", err?.message),
      });
    });
  };

  loadFullScreenAd({
    options: { adGroupId: AD_GROUP_ID },
    onEvent: (event) => {
      if (event.type !== "loaded") return;
      adReady = true;
      maybeShow();
    },
    onError: (err) => {
      // 채울 광고가 없거나(no-fill) SDK 미지원인 경우도 여기로 온다 - 조용히 넘어간다(안내 자체를
      // 안 띄웠으니 화면에 빈 흔적이 남을 걱정도 없음).
      console.warn("토스 전면광고 불러오기 실패(no-fill 포함 가능):", err?.message);
    },
  });

  // "미니앱 접속 직후"를 없애기 위해, 사용자가 화면을 한 번이라도 탭하기 전까진 안내창 자체를
  // 절대 띄우지 않는다 - 광고 로딩은(화면에 아무것도 안 그리니) 미리 해둬도 상관없다.
  document.addEventListener(
    "click",
    () => {
      userInteracted = true;
      maybeShow();
    },
    { once: true }
  );
}

initInterstitialAd();
