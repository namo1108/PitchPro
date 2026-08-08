import { fetchJSON } from "../api.js";
import { onTabChange } from "../router.js";
import { getCurrentSubscription } from "../push.js";
import { getGoalSound, setGoalSound } from "./matches.js";
import { getTheme, setTheme } from "../theme.js";

// 각 서버 크론(detectGoalsAndNotify.js 등)이 실제로 보내는 payload.type과 정확히 일치해야 한다
// (src/lib/config.js의 NOTIFICATION_TYPES와 id를 맞춰서 관리 - 프론트는 별도 정적 자산이라
// 그쪽 서버 코드를 import할 수 없어 라벨/아이콘까지 여기서 다시 정의한다).
const NOTIFICATION_TYPES = [
  { id: "goal", icon: "⚽", label: "골" },
  { id: "concede", icon: "😢", label: "실점" },
  { id: "var_cancel", icon: "🚫", label: "골 취소(VAR)" },
  { id: "kickoff_soon", icon: "⏱", label: "경기 시작 5분 전" },
  { id: "kickoff", icon: "🏟", label: "경기 시작" },
  { id: "halftime", icon: "🟨", label: "전반전 종료" },
  { id: "fulltime", icon: "🏁", label: "경기 종료" },
  { id: "redcard", icon: "🟥", label: "퇴장" },
  { id: "lineup", icon: "📋", label: "라인업 발표" },
  { id: "transfer", icon: "🔁", label: "이적 소식" },
];

const el = {
  soundToggle: document.getElementById("pref-sound-toggle"),
  typeList: document.getElementById("notif-type-list"),
};

// 어떤 소리인지 고르게 하지 않고, 켜고 끄는 것만 설정하게 한다(사용자 요청, 2026-08-08 -
// 소리는 알아서 기본값으로 나오면 되고 고르는 UI 자체가 불필요하다는 피드백).
function initGoalSoundToggle() {
  const toggle = document.getElementById("goal-sound-toggle");
  if (!toggle) return;

  toggle.checked = getGoalSound() !== "none";
  toggle.addEventListener("change", () => setGoalSound(toggle.checked ? "goal1" : "none"));
}

initGoalSoundToggle();

function renderTypeList(prefs) {
  el.typeList.innerHTML = NOTIFICATION_TYPES.map(
    (t) => `
    <div class="settings-row">
      <span class="settings-row-label">${t.icon} ${t.label}</span>
      <label class="toggle-switch">
        <input type="checkbox" data-type="${t.id}" ${prefs.types?.[t.id] !== false ? "checked" : ""} />
        <span class="toggle-switch-track"></span>
      </label>
    </div>
  `
  ).join("");

  el.typeList.querySelectorAll("input[data-type]").forEach((input) => {
    input.addEventListener("change", () => savePrefs({ types: { [input.dataset.type]: input.checked } }));
  });
}

// 아직 알림을 한 번도 켠 적 없는 기기(구독 없음)면 서버에 물어볼 endpoint 자체가 없다 - 이 경우
// 토글 목록을 흐리게 비활성화하고, 위쪽 "🔔 골 알림 받기" 버튼부터 누르라고 안내한다.
function renderNoSubscription() {
  el.typeList.innerHTML =
    '<div class="empty-state">먼저 위의 "🔔 골 알림 받기"를 눌러 알림을 켜야 종류별로 설정할 수 있어요.</div>';
  el.soundToggle.disabled = true;
}

let cachedEndpoint = null;

async function loadPrefs() {
  const subscription = await getCurrentSubscription();
  if (!subscription) {
    cachedEndpoint = null;
    renderNoSubscription();
    return;
  }
  cachedEndpoint = subscription.endpoint;
  el.soundToggle.disabled = false;

  try {
    const { prefs } = await fetchJSON(`/push/preferences?endpoint=${encodeURIComponent(cachedEndpoint)}`);
    el.soundToggle.checked = prefs.sound !== false;
    renderTypeList(prefs);
  } catch {
    el.typeList.innerHTML = '<div class="error-state">알림 설정을 불러오지 못했습니다.</div>';
  }
}

// 토글 하나를 바꿀 때마다 그 항목만 서버에 반영한다(merge 저장이라 나머지 설정은 그대로 유지됨).
async function savePrefs(partialPrefs) {
  if (!cachedEndpoint) return;
  try {
    await fetchJSON("/push/preferences", { method: "POST", body: { endpoint: cachedEndpoint, prefs: partialPrefs } });
  } catch {
    // 실패해도 조용히 무시 - 다음에 설정 탭을 다시 열면 서버 값으로 토글이 다시 맞춰진다.
  }
}

el.soundToggle.addEventListener("change", () => savePrefs({ sound: el.soundToggle.checked }));

// 설정 탭을 열 때마다, 그리고 다른 탭에서 알림을 막 켰거나 껐을 때도(push.js가 이벤트를 쏨) 최신 상태로 갱신한다.
onTabChange("settings", loadPrefs);
window.addEventListener("push-subscription-changed", () => {
  if (document.getElementById("view-settings")?.classList.contains("active")) loadPrefs();
});

// ---------- 화면 테마 토글 ----------
function renderThemeButtons() {
  const current = getTheme();
  document.querySelectorAll("[data-theme-option]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.themeOption === current);
  });
}

document.querySelectorAll("[data-theme-option]").forEach((btn) => {
  btn.addEventListener("click", () => {
    setTheme(btn.dataset.themeOption);
    renderThemeButtons();
  });
});

renderThemeButtons();
