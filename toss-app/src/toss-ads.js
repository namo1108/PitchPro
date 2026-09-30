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
//
// 2026-09-30 3차 반려(같은 사유 "유저가 예상하기 어려운 시점에 광고가 노출돼요") - 이전 수정의
// 진짜 문제를 다시 짚어보니, "화면 아무 데나 탭"을 광고 트리거로 쓴 것 자체가 원인이었다. 유저가
// 경기 카드나 탭 버튼을 눌렀을 뿐인데(다른 화면으로 이동하려던 것) 뜬금없이 광고 안내가 끼어드니,
// 안내 문구가 있어도 "예상 못 한 시점"인 건 마찬가지였던 것. 이번엔 트리거 자체를 바꾼다 - 화면
// 아무 곳이나 누르면 반응하는 대신, 명확한 문구가 적힌 전용 배너 버튼(#toss-ad-banner, 하단
// 플로팅 탭바 바로 위)을 만들어서 그 버튼을 직접 눌러야만(다른 어떤 조작도 광고를 트리거하지 않음)
// 광고가 뜨도록 한다 - 버튼 문구 자체가 이미 "이걸 누르면 광고가 나온다"는 안내라 별도 확인창도 필요 없다.
import { loadFullScreenAd, showFullScreenAd } from "@apps-in-toss/web-framework";

// 콘솔에서 발급받은 실제(운영) 전면광고 그룹 ID(사용자 제공, 2026-09-09 배너 -> 전면 교체).
const AD_GROUP_ID = "ait.v2.live.082ac21e3f3d4e7b";

function renderBanner(state, onClick) {
  const el = document.getElementById("toss-ad-banner");
  if (!el) return;
  const LABEL = {
    loading: "📢 광고 준비 중...",
    ready: "📢 광고 보고 PITCH PRO 응원하기",
    showing: "📢 광고를 불러오는 중...",
  };
  el.textContent = LABEL[state] || "";
  el.style.display = "block";
  el.style.cursor = state === "ready" ? "pointer" : "default";
  el.style.opacity = state === "ready" ? "1" : "0.6";
  el.onclick = state === "ready" ? onClick : null;
}

function initInterstitialAd() {
  if (!loadFullScreenAd?.isSupported?.() || !showFullScreenAd?.isSupported?.()) return;

  renderBanner("loading");

  const showAd = () => {
    renderBanner("showing");
    showFullScreenAd({
      options: { adGroupId: AD_GROUP_ID },
      onEvent: (showEvent) => {
        if (showEvent.type === "failedToShow") console.error("토스 전면광고 노출 실패");
        // 성공/실패와 무관하게 이번 세션에 불러온 광고 1개는 소모됐으니 배너를 치운다(다시 눌러도
        // 보여줄 게 없음 - 재로딩은 다음 세션에서).
        const el = document.getElementById("toss-ad-banner");
        if (el) el.style.display = "none";
      },
      onError: (err) => {
        console.error("토스 전면광고 노출 요청 실패:", err?.message);
        const el = document.getElementById("toss-ad-banner");
        if (el) el.style.display = "none";
      },
    });
  };

  loadFullScreenAd({
    options: { adGroupId: AD_GROUP_ID },
    onEvent: (event) => {
      if (event.type !== "loaded") return;
      renderBanner("ready", showAd);
    },
    onError: (err) => {
      // 채울 광고가 없거나(no-fill) SDK 미지원인 경우도 여기로 온다 - 배너 자체를 숨겨서
      // "눌러도 아무 일도 안 일어나는 죽은 버튼"이 안 남게 한다.
      console.warn("토스 전면광고 불러오기 실패(no-fill 포함 가능):", err?.message);
      const el = document.getElementById("toss-ad-banner");
      if (el) el.style.display = "none";
    },
  });
}

initInterstitialAd();
