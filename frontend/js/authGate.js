import { fetchJSON } from "./api.js";
import { crestImg } from "./format.js";
import { isLoggedIn, onAuthChange, signup, login } from "./auth.js";

const el = {
  gate: document.getElementById("auth-gate"),
  tabs: document.querySelectorAll(".auth-gate-tab"),
  form: document.getElementById("auth-gate-form"),
  username: document.getElementById("gate-username"),
  password: document.getElementById("gate-password"),
  signupFields: document.getElementById("gate-signup-fields"),
  nickname: document.getElementById("gate-nickname"),
  teamSearchInput: document.getElementById("gate-team-search"),
  teamResultsBox: document.getElementById("gate-team-results"),
  teamPickedChip: document.getElementById("gate-team-picked"),
  submitBtn: document.getElementById("gate-submit-btn"),
  errorBox: document.getElementById("gate-error"),
};

let mode = "login";
let pickedTeam = null;

function setMode(m) {
  mode = m;
  el.tabs.forEach((t) => t.classList.toggle("active", t.dataset.mode === m));
  el.signupFields.style.display = m === "signup" ? "block" : "none";
  el.submitBtn.textContent = m === "signup" ? "회원가입" : "로그인";
  el.errorBox.textContent = "";
  if (m === "signup") {
    pickedTeam = null;
    el.teamSearchInput.value = "";
    el.teamResultsBox.innerHTML = "";
    el.teamPickedChip.style.display = "none";
  }
}

el.tabs.forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.mode)));

// ---------- 최애팀 검색(회원가입 전용) - 나의 팀 로그인 폼과 동일한 패턴 ----------

let searchTimer = null;
let searchRequestId = 0;

el.teamSearchInput?.addEventListener("input", () => {
  const q = el.teamSearchInput.value.trim();
  clearTimeout(searchTimer);
  if (q.length < 1) {
    searchRequestId++;
    el.teamResultsBox.innerHTML = "";
    return;
  }
  const requestId = ++searchRequestId;
  searchTimer = setTimeout(async () => {
    try {
      const data = await fetchJSON(`/teams/search?q=${encodeURIComponent(q)}`);
      if (requestId !== searchRequestId) return;
      renderTeamResults(data.teams || []);
    } catch {
      if (requestId === searchRequestId) el.teamResultsBox.innerHTML = "";
    }
  }, 300);
});

function renderTeamResults(teams) {
  if (!teams.length) {
    el.teamResultsBox.innerHTML = '<div class="team-search-empty">검색 결과가 없습니다.</div>';
    return;
  }
  el.teamResultsBox.innerHTML = teams
    .map(
      (t) => `
    <div class="team-search-row" data-team-id="${t.id}" data-name="${t.name}" data-crest="${t.crest || ""}">
      ${crestImg(t, "team-search-crest")}
      <span class="team-search-name">${t.name}</span>
      <span class="team-search-comp">${t.competitionName}</span>
    </div>
  `
    )
    .join("");

  el.teamResultsBox.querySelectorAll("[data-team-id]").forEach((row) => {
    row.addEventListener("click", () => {
      pickedTeam = { id: row.dataset.teamId, name: row.dataset.name, crest: row.dataset.crest || null };
      el.teamSearchInput.value = "";
      el.teamResultsBox.innerHTML = "";
      el.teamPickedChip.style.display = "flex";
      el.teamPickedChip.innerHTML = `${crestImg(pickedTeam, "team-picked-crest")}<span>${pickedTeam.name}</span><button type="button" id="gate-team-clear">✕</button>`;
      document.getElementById("gate-team-clear").addEventListener("click", () => {
        pickedTeam = null;
        el.teamPickedChip.style.display = "none";
      });
    });
  });
}

el.form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  el.errorBox.textContent = "";
  el.submitBtn.disabled = true;
  try {
    if (mode === "signup") {
      await signup({
        username: el.username.value.trim(),
        password: el.password.value,
        nickname: el.nickname.value.trim(),
        favoriteTeamId: pickedTeam?.id || null,
        favoriteTeamName: pickedTeam?.name || null,
        favoriteTeamCrest: pickedTeam?.crest || null,
      });
    } else {
      await login({ username: el.username.value.trim(), password: el.password.value });
    }
    el.form.reset();
  } catch (err) {
    el.errorBox.textContent = err.message;
  } finally {
    el.submitBtn.disabled = false;
  }
});

function updateGateVisibility() {
  el.gate.style.display = isLoggedIn() ? "none" : "flex";
}

onAuthChange(updateGateVisibility);
updateGateVisibility();

// 로그인된 후에만 실행해야 하는 앱 초기화 로직(app.js)을 위한 훅.
// 이미 로그인돼 있으면 즉시, 아니면 게이트를 통과하는 순간(auth-changed) 한 번만 실행한다.
export function whenAuthenticated(callback) {
  if (isLoggedIn()) {
    callback();
    return;
  }
  const handler = () => {
    if (isLoggedIn()) {
      window.removeEventListener("auth-changed", handler);
      callback();
    }
  };
  window.addEventListener("auth-changed", handler);
}
