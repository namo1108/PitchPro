import { fetchJSON } from "../api.js";
import { onTabChange } from "../router.js";
import { crestImg, formatKickoff, formBadgesHtml } from "../format.js";
import { listFavorites, toggleFavorite } from "../favorites.js";
import { goToTeam } from "./teamDetail.js";
import { GOAL_SOUNDS, getGoalSound, setGoalSound, previewGoalSound } from "./matches.js";
import { getCurrentUser, isLoggedIn, signup, login, logout, refreshMe, onAuthChange, authFetch } from "../auth.js";

const el = {
  list: document.getElementById("myteam-list"),
  guestWrap: document.getElementById("auth-guest-wrap"),
  formWrap: document.getElementById("auth-form-wrap"),
  profileWrap: document.getElementById("profile-wrap"),
  openBtn: document.getElementById("auth-open-btn"),
  closeBtn: document.getElementById("auth-form-close"),
  form: document.getElementById("auth-form"),
  usernameInput: document.getElementById("auth-username"),
  passwordInput: document.getElementById("auth-password"),
  signupFields: document.getElementById("auth-signup-fields"),
  nicknameInput: document.getElementById("auth-nickname"),
  teamSearchInput: document.getElementById("auth-team-search"),
  teamResultsBox: document.getElementById("auth-team-results"),
  teamPickedChip: document.getElementById("auth-team-picked"),
  submitBtn: document.getElementById("auth-submit-btn"),
  errorBox: document.getElementById("auth-error"),
  tabs: document.querySelectorAll(".auth-form-tab"),
};

function initGoalSoundPicker() {
  const select = document.getElementById("goal-sound-select");
  const previewBtn = document.getElementById("goal-sound-preview");
  if (!select || !previewBtn) return;

  select.innerHTML = GOAL_SOUNDS.map((s) => `<option value="${s.id}">${s.label}</option>`).join("");
  select.value = getGoalSound();

  select.addEventListener("change", () => {
    setGoalSound(select.value);
    previewGoalSound();
  });
  previewBtn.addEventListener("click", () => previewGoalSound());
}

initGoalSoundPicker();

// ---------- 로그인/회원가입 ----------

let authMode = "login";
let pickedTeam = null;

function setAuthMode(mode) {
  authMode = mode;
  el.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));
  el.signupFields.style.display = mode === "signup" ? "block" : "none";
  el.submitBtn.textContent = mode === "signup" ? "회원가입" : "로그인";
  el.errorBox.textContent = "";
  if (mode === "signup") {
    pickedTeam = null;
    el.teamSearchInput.value = "";
    el.teamResultsBox.innerHTML = "";
    el.teamPickedChip.style.display = "none";
  }
}

// ---------- 최애팀 검색(회원가입 전용) ----------

let teamSearchTimer = null;

el.teamSearchInput?.addEventListener("input", () => {
  const q = el.teamSearchInput.value.trim();
  clearTimeout(teamSearchTimer);
  if (q.length < 1) {
    el.teamResultsBox.innerHTML = "";
    return;
  }
  // 타이핑마다 바로 요청하지 않고 살짝 기다렸다가 검색(디바운스)해서 불필요한 호출을 줄인다.
  teamSearchTimer = setTimeout(async () => {
    try {
      const data = await fetchJSON(`/teams/search?q=${encodeURIComponent(q)}`);
      renderTeamResults(data.teams || []);
    } catch {
      el.teamResultsBox.innerHTML = "";
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
      el.teamPickedChip.innerHTML = `${crestImg(pickedTeam, "team-picked-crest")}<span>${pickedTeam.name}</span><button type="button" id="team-picked-clear">✕</button>`;
      document.getElementById("team-picked-clear").addEventListener("click", () => {
        pickedTeam = null;
        el.teamPickedChip.style.display = "none";
      });
    });
  });
}

el.openBtn?.addEventListener("click", () => {
  el.guestWrap.style.display = "none";
  el.formWrap.style.display = "block";
  setAuthMode("login");
});

el.closeBtn?.addEventListener("click", () => {
  el.formWrap.style.display = "none";
  el.guestWrap.style.display = isLoggedIn() ? "none" : "block";
});

el.tabs.forEach((tab) => tab.addEventListener("click", () => setAuthMode(tab.dataset.mode)));

el.form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  el.errorBox.textContent = "";
  el.submitBtn.disabled = true;
  try {
    if (authMode === "signup") {
      await signup({
        username: el.usernameInput.value.trim(),
        password: el.passwordInput.value,
        nickname: el.nicknameInput.value.trim(),
        favoriteTeamId: pickedTeam?.id || null,
        favoriteTeamName: pickedTeam?.name || null,
        favoriteTeamCrest: pickedTeam?.crest || null,
      });
    } else {
      await login({ username: el.usernameInput.value.trim(), password: el.passwordInput.value });
    }
    el.form.reset();
    el.formWrap.style.display = "none";
    pickedTeam = null;
    el.teamPickedChip.style.display = "none";
  } catch (err) {
    el.errorBox.textContent = err.message;
  } finally {
    el.submitBtn.disabled = false;
  }
});

// ---------- 프로필/레벨/친구 ----------

function levelBarHtml(user) {
  const p = user.progress || { level: user.level, floor: 0, ceil: 100, percent: 0 };
  return `
    <div class="level-badge">Lv.${p.level}</div>
    <div class="level-bar-wrap">
      <div class="level-bar"><div class="level-bar-fill" style="width:${p.percent}%"></div></div>
      <div class="level-bar-label">${user.points.toLocaleString()}P · 다음 레벨까지 ${(p.ceil - user.points).toLocaleString()}P</div>
    </div>
  `;
}

async function loadFriends() {
  const wrap = document.getElementById("friends-list-wrap");
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading">불러오는 중...</div>';
  try {
    const data = await authFetch("/friends");
    renderFriends(data.friends || []);
  } catch (err) {
    wrap.innerHTML = `<div class="error-state">${err.message}</div>`;
  }
}

function renderFriends(friends) {
  const wrap = document.getElementById("friends-list-wrap");
  if (!wrap) return;
  if (!friends.length) {
    wrap.innerHTML = '<div class="empty-state">아직 추가한 친구가 없어요. 닉네임으로 추가해보세요.</div>';
    return;
  }
  wrap.innerHTML = friends
    .map(
      (f) => `
    <div class="friend-row">
      <span class="friend-nickname">${f.nickname}</span>
      <span class="friend-level">Lv.${f.level}</span>
      <span class="friend-points">${f.points.toLocaleString()}P</span>
      <button class="friend-remove" data-nickname="${f.nickname}" title="친구 삭제">✕</button>
    </div>
  `
    )
    .join("");
  wrap.querySelectorAll("[data-nickname]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await authFetch(`/friends/${encodeURIComponent(btn.dataset.nickname)}`, { method: "DELETE" }).catch(() => {});
      loadFriends();
    });
  });
}

function renderProfile() {
  const user = getCurrentUser();
  if (!user) {
    el.profileWrap.style.display = "none";
    el.profileWrap.innerHTML = "";
    return;
  }

  el.guestWrap.style.display = "none";
  el.formWrap.style.display = "none";
  el.profileWrap.style.display = "block";
  el.profileWrap.innerHTML = `
    <div class="profile-card">
      <div class="profile-header">
        <div class="profile-nickname">${user.nickname}</div>
        <button id="logout-btn" class="logout-btn">로그아웃</button>
      </div>
      <div class="profile-level-row">${levelBarHtml(user)}</div>
      <div class="friends-section">
        <div class="friends-title">👥 친구</div>
        <form id="friend-add-form" class="friend-add-form">
          <input type="text" id="friend-nickname-input" placeholder="친구 닉네임으로 추가" />
          <button type="submit">추가</button>
        </form>
        <div id="friends-add-error" class="auth-error"></div>
        <div id="friends-list-wrap" class="friends-list-wrap"></div>
      </div>
    </div>
  `;

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await logout();
  });

  document.getElementById("friend-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("friend-nickname-input");
    const errorBox = document.getElementById("friends-add-error");
    errorBox.textContent = "";
    try {
      await authFetch("/friends", { method: "POST", body: { nickname: input.value.trim() } });
      input.value = "";
      loadFriends();
    } catch (err) {
      errorBox.textContent = err.message;
    }
  });

  loadFriends();
}

onAuthChange(() => {
  renderProfile();
  loadMyTeam();
});

// ---------- 집관인증 ----------

const CHECKIN_LABELS = {
  too_early: "🔒 집관인증은 킥오프 30분 전부터",
  open: "🏟 집관인증하기",
  closed: "⏱ 집관인증 시간이 지났어요",
};

async function renderCheckinSlot(slot, matchId) {
  try {
    const status = await authFetch(`/checkin/${matchId}`);
    if (status.alreadyCheckedIn) {
      slot.innerHTML = `<div class="checkin-done">✅ 집관인증 완료 (+${20}P)</div>`;
      return;
    }
    const disabled = status.state !== "open";
    slot.innerHTML = `<button class="checkin-btn" ${disabled ? "disabled" : ""} data-match-id="${matchId}">${CHECKIN_LABELS[status.state]}</button>`;
    if (!disabled) {
      slot.querySelector(".checkin-btn").addEventListener("click", async (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = "인증 중...";
        try {
          const result = await authFetch("/checkin", { method: "POST", body: { matchId } });
          slot.innerHTML = `<div class="checkin-done">✅ 집관인증 완료 (+${result.pointsAwarded}P${result.leveledUp ? " · 레벨업! 🎉" : ""})</div>`;
          await refreshMe();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = err.message;
        }
      });
    }
  } catch {
    slot.innerHTML = "";
  }
}

export async function loadMyTeam() {
  renderProfile();

  const favorites = listFavorites();
  if (!favorites.length) {
    el.list.innerHTML = '<div class="empty-state">팀 상세 화면에서 ★를 눌러 즐겨찾기하세요.</div>';
    return;
  }

  el.list.innerHTML = '<div class="loading">불러오는 중...</div>';
  const cards = await Promise.all(
    favorites.map(async (fav) => {
      try {
        const data = await fetchJSON(`/teams/${fav.id}`);
        return renderCard(fav, data);
      } catch {
        return renderCard(fav, null);
      }
    })
  );
  el.list.innerHTML = cards.join("");

  el.list.querySelectorAll("[data-team-id]").forEach((elm) => {
    elm.addEventListener("click", (e) => {
      if (e.target.closest("[data-remove]") || e.target.closest(".checkin-slot")) return;
      goToTeam(elm.dataset.teamId);
    });
  });
  el.list.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavorite({ id: btn.dataset.remove });
      loadMyTeam();
    });
  });

  if (isLoggedIn()) {
    el.list.querySelectorAll("[data-checkin-match-id]").forEach((slot) => {
      renderCheckinSlot(slot, slot.dataset.checkinMatchId);
    });
  }
}

function renderCard(fav, data) {
  const next = data?.upcomingMatches?.[0];
  const nextHtml = next
    ? `<div class="myteam-next">다음 경기: ${next.homeTeam.shortName || next.homeTeam.name} vs ${next.awayTeam.shortName || next.awayTeam.name} · ${formatKickoff(next.utcDate)}</div>`
    : '<div class="myteam-next">예정된 경기 정보 없음</div>';

  const form = formBadgesHtml(data?.recentMatches, fav.id, 5);
  const checkinHtml = next && isLoggedIn() ? `<div class="checkin-slot" data-checkin-match-id="${next.id}"><div class="loading">·</div></div>` : "";

  return `
    <div class="myteam-card" data-team-id="${fav.id}">
      <button class="myteam-remove" data-remove="${fav.id}" title="즐겨찾기 해제">✕</button>
      ${crestImg(fav, "myteam-crest")}
      <div class="myteam-info">
        <div class="myteam-name">${fav.name}</div>
        ${nextHtml}
        ${form}
        ${checkinHtml}
      </div>
    </div>
  `;
}

onTabChange("myteam", loadMyTeam);
