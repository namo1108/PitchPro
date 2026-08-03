// 홈 화면 설치 유도 배너 - 지금까진 브라우저 기본 설치 UI(안 뜨는 경우도 많음)와 설정 탭에 묻혀있는
// 안내문뿐이라 설치 전환이 낮았다(삼성/iOS 백그라운드 알림 문제로 설치 자체가 더 중요해진 상태).
// Android/Chrome/Edge는 beforeinstallprompt를 가로채 직접 배너를 띄우고, iOS Safari는 이 이벤트
// 자체가 없어서 "공유 -> 홈 화면에 추가" 안내 배너를 대신 보여준다.
const DISMISS_KEY = "pitchpro.installBannerDismissedAt";
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 한 번 닫으면 2주간 다시 안 보여줌

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isDismissedRecently() {
  const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
  return Date.now() - at < DISMISS_COOLDOWN_MS;
}

function dismiss(banner) {
  localStorage.setItem(DISMISS_KEY, String(Date.now()));
  banner.remove();
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isSafari() {
  return /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);
}

function buildBanner({ text, actionLabel, onAction }) {
  const banner = document.createElement("div");
  banner.className = "install-banner";
  banner.innerHTML = `
    <span class="install-banner-icon">⚽</span>
    <span class="install-banner-text">${text}</span>
    ${actionLabel ? `<button class="install-banner-action">${actionLabel}</button>` : ""}
    <button class="install-banner-close" aria-label="닫기">✕</button>
  `;
  banner.querySelector(".install-banner-close").addEventListener("click", () => dismiss(banner));
  if (actionLabel) {
    banner.querySelector(".install-banner-action").addEventListener("click", async () => {
      await onAction?.();
      dismiss(banner);
    });
  }
  document.querySelector(".app")?.prepend(banner);
  return banner;
}

export function initInstallBanner() {
  if (isStandalone() || isDismissedRecently()) return;

  // Android/Chrome/Edge 등 - 브라우저가 "설치 가능"으로 판단하면 이 이벤트를 준다. preventDefault로
  // 브라우저 기본 미니 인포바를 막고, 우리 배너의 버튼을 눌렀을 때만 프롬프트를 띄운다.
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    buildBanner({
      text: "PITCH PRO를 홈 화면에 추가하면 더 빠르고, 앱을 안 열어도 알림이 잘 와요.",
      actionLabel: "설치",
      onAction: async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice.catch(() => {});
        deferredPrompt = null;
      },
    });
  });

  // iOS Safari는 beforeinstallprompt를 지원하지 않아 안내만 보여준다(버튼 없이 방법만 설명).
  if (isIos() && isSafari()) {
    buildBanner({
      text: "iPhone은 Safari 하단 공유 버튼(⬆️) → \"홈 화면에 추가\"로 설치하면 알림이 훨씬 잘 와요.",
    });
  }
}
