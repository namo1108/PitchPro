// 2026-08-27 - toss-notifications.js(Notification/User)와 별도 파일로 분리했다. 그쪽 SDK 사용이
// 미니앱 전체를 먹통으로 만드는 문제가 두 번 재확인됐는데(async 스크립트로도 못 피함), 알림 쪽
// 코드가 원인인지 광고 쪽이 원인인지 구분이 안 된 상태였다 - 이 파일은 광고 SDK만 import해서
// 광고만 따로 테스트해보기 위한 것(사용자 요청). 알림 관련 코드는 전혀 없다.
//
// 2026-09-09 - 하단 플로팅 배너(TossAds.attachBanner)에서 전면(풀스크린) 광고로 교체(사용자 요청).
// 2026-09-10 - 앱인토스 심사 반려: "유저가 예상하기 어려운 시점에 광고가 노출돼요. 광고 노출 전에
// 유저가 인지할 수 있도록 CTA 문구나 UI를 추가해 주세요." loadFullScreenAd로 미리 불러만 두고,
// 실제로 다 불러졌을 때(즉 광고가 있을 때만) 화면 안내 + "확인" 버튼을 띄운 뒤, 사용자가 직접
// 눌러야만 showFullScreenAd로 노출한다 - 자동으로 뜨는 광고가 아예 없어진다. 광고가 없으면(no-fill)
// 안내 자체를 안 띄운다(어차피 보여줄 게 없으니).
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

function showInterstitialAd() {
  if (!loadFullScreenAd?.isSupported?.() || !showFullScreenAd?.isSupported?.()) return;

  loadFullScreenAd({
    options: { adGroupId: AD_GROUP_ID },
    onEvent: (event) => {
      if (event.type !== "loaded") return;
      showAdNotice(() => {
        showFullScreenAd({
          options: { adGroupId: AD_GROUP_ID },
          onEvent: (showEvent) => {
            if (showEvent.type === "failedToShow") console.error("토스 전면광고 노출 실패");
          },
          onError: (err) => console.error("토스 전면광고 노출 요청 실패:", err?.message),
        });
      });
    },
    onError: (err) => {
      // 채울 광고가 없거나(no-fill) SDK 미지원인 경우도 여기로 온다 - 조용히 넘어간다(안내 자체를
      // 안 띄웠으니 화면에 빈 흔적이 남을 걱정도 없음).
      console.warn("토스 전면광고 불러오기 실패(no-fill 포함 가능):", err?.message);
    },
  });
}

showInterstitialAd();
