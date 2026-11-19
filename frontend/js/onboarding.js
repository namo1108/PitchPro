// 첫 방문 시 딱 한 번, "나의 팀" 탭(골 알림 켜기·즐겨찾기 팀·집관인증이 모여있는 곳)을 가리키는
// 말풍선을 잠깐 띄운다. 이 기능들이 실제로는 다 만들어져 있는데 눈에 안 띄어서 못 써보고 이탈하는
// 걸 막기 위한 최소한의 힌트 - 여러 단계짜리 투어는 만들지 않는다(탭 이동까지 강제하면 오히려 부담).
const STORAGE_KEY = "onboarding-tip-seen-v1";
const AUTO_DISMISS_MS = 8000;

// 검색엔진/애드센스 크롤러는 localStorage가 매번 비어 있어 "이미 봤음"이 절대 기록 안 되다 보니
// 이 안내 말풍선도 크롤링할 때마다 뜬다 - updateNotes.js와 같은 이유로(2026-11-19) 크롤러에게는
// 생략한다. 실제 콘텐츠는 그대로이고 이 일회성 안내 하나만 빠지는 거라 클로킹이 아니다.
const BOT_UA_PATTERN = /googlebot|mediapartners-google|adsbot-google|bingbot|yandexbot|duckduckbot|baiduspider|slurp/i;

function showTip() {
  if (BOT_UA_PATTERN.test(navigator.userAgent)) return;
  if (localStorage.getItem(STORAGE_KEY)) return;
  const target = document.querySelector('.nav-btn[data-view="myteam"]');
  if (!target) return;

  const tip = document.createElement("div");
  tip.className = "onboarding-tip";
  tip.innerHTML = `
    <div class="onboarding-tip-body">
      <span class="onboarding-tip-emoji">🔔</span>
      <div class="onboarding-tip-text">
        <strong>골 알림, 즐겨찾기 팀은 여기서!</strong>
        <span>'나의 팀' 탭에서 알림을 켜고 좋아하는 팀을 등록해보세요</span>
      </div>
      <button class="onboarding-tip-close" aria-label="닫기">✕</button>
    </div>
    <div class="onboarding-tip-arrow"></div>
  `;
  document.body.appendChild(tip);

  function position() {
    const rect = target.getBoundingClientRect();
    const tipWidth = tip.offsetWidth;
    let left = rect.left + rect.width / 2 - tipWidth / 2;
    left = Math.max(10, Math.min(left, window.innerWidth - tipWidth - 10));
    tip.style.left = `${left}px`;
    tip.style.top = `${rect.top - tip.offsetHeight - 12}px`;
    tip.querySelector(".onboarding-tip-arrow").style.left = `${rect.left + rect.width / 2 - left - 6}px`;
  }

  let dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    localStorage.setItem(STORAGE_KEY, "1");
    tip.classList.remove("show");
    window.removeEventListener("resize", position);
    setTimeout(() => tip.remove(), 250);
  }

  position();
  requestAnimationFrame(() => tip.classList.add("show"));
  window.addEventListener("resize", position);
  tip.querySelector(".onboarding-tip-close").addEventListener("click", dismiss);
  target.addEventListener("click", dismiss, { once: true });
  setTimeout(dismiss, AUTO_DISMISS_MS);
}

export function initOnboarding() {
  setTimeout(showTip, 1500);
}
