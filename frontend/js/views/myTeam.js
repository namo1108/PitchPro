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
let teamSearchRequestId = 0;

el.teamSearchInput?.addEventListener("input", () => {
  const q = el.teamSearchInput.value.trim();
  clearTimeout(teamSearchTimer);
  if (q.length < 1) {
    teamSearchRequestId++; // 진행 중이던 이전 요청 결과는 무시하게 만든다.
    el.teamResultsBox.innerHTML = "";
    return;
  }
  // 타이핑마다 바로 요청하지 않고 살짝 기다렸다가 검색(디바운스)해서 불필요한 호출을 줄인다.
  const requestId = ++teamSearchRequestId;
  teamSearchTimer = setTimeout(async () => {
    try {
      const data = await fetchJSON(`/teams/search?q=${encodeURIComponent(q)}`);
      // 느린 응답이 나중에 도착해 더 최신 검색 결과를 덮어쓰지 않도록, 그사이 새 요청이 있었으면 버린다.
      if (requestId !== teamSearchRequestId) return;
      renderTeamResults(data.teams || []);
    } catch {
      if (requestId === teamSearchRequestId) el.teamResultsBox.innerHTML = "";
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
  const p = user.progress || { level: user.level, floor: 0, ceil: 100, percent: 0, title: "" };
  const isMaxTier = p.level >= 99;
  const bottomLabel = isMaxTier
    ? `${user.points.toLocaleString()}P · 최고 등급`
    : `${user.points.toLocaleString()}P · 다음 레벨까지 ${(p.ceil - user.points).toLocaleString()}P`;
  return `
    <div class="level-badge">Lv.${p.level}</div>
    <div class="level-bar-wrap">
      <div class="level-title">${p.title}</div>
      <div class="level-bar"><div class="level-bar-fill" style="width:${p.percent}%"></div></div>
      <div class="level-bar-label">${bottomLabel}</div>
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
      <span class="friend-nickname">${f.nickname}<span class="friend-title">${f.progress?.title || ""}</span></span>
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
    // 로그아웃 등으로 로그인 상태가 풀리면(로그인 폼이 열려있는 중이 아닌 한) 로그인 유도 카드를 다시 보여준다.
    if (el.formWrap.style.display === "none") el.guestWrap.style.display = "block";
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
        <div id="friend-requests-wrap" class="friend-requests-wrap"></div>
        <div class="friends-title">👥 친구</div>
        <div class="team-search-wrap">
          <input type="text" id="friend-nickname-input" placeholder="닉네임으로 친구 검색" autocomplete="off" />
          <div id="friend-search-results" class="team-search-results"></div>
        </div>
        <div id="friends-add-error" class="auth-error"></div>
        <div id="friends-list-wrap" class="friends-list-wrap"></div>
      </div>
    </div>
  `;

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await logout();
  });

  initFriendSearch();
  loadFriends();
  loadFriendRequests();
}

// ---------- 받은 친구 요청 ----------

async function loadFriendRequests() {
  const wrap = document.getElementById("friend-requests-wrap");
  if (!wrap) return;
  try {
    const data = await authFetch("/friends/requests");
    renderFriendRequests(data.requests || []);
  } catch {
    wrap.innerHTML = "";
  }
}

function renderFriendRequests(requests) {
  const wrap = document.getElementById("friend-requests-wrap");
  if (!wrap) return;
  if (!requests.length) {
    wrap.innerHTML = "";
    return;
  }
  wrap.innerHTML = `
    <div class="friend-requests-title">받은 친구 요청 (${requests.length})</div>
    ${requests
      .map(
        (r) => `
      <div class="friend-request-row">
        <span class="friend-nickname">${r.nickname}<span class="friend-title">${r.progress?.title || ""}</span></span>
        <button class="friend-request-accept" data-nickname="${r.nickname}">수락</button>
        <button class="friend-request-decline" data-nickname="${r.nickname}">거절</button>
      </div>
    `
      )
      .join("")}
  `;

  wrap.querySelectorAll(".friend-request-accept").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await authFetch(`/friends/requests/${encodeURIComponent(btn.dataset.nickname)}/accept`, { method: "POST", body: {} }).catch(() => {});
      loadFriendRequests();
      loadFriends();
    });
  });
  wrap.querySelectorAll(".friend-request-decline").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await authFetch(`/friends/requests/${encodeURIComponent(btn.dataset.nickname)}/decline`, { method: "POST", body: {} }).catch(() => {});
      loadFriendRequests();
    });
  });
}

// ---------- 친구 검색(가입된 실제 닉네임만 실시간으로 보여줌) ----------

let friendSearchTimer = null;
let friendSearchRequestId = 0;

function initFriendSearch() {
  const input = document.getElementById("friend-nickname-input");
  const resultsBox = document.getElementById("friend-search-results");
  if (!input || !resultsBox) return;

  input.addEventListener("input", () => {
    const q = input.value.trim();
    clearTimeout(friendSearchTimer);
    if (q.length < 1) {
      friendSearchRequestId++;
      resultsBox.innerHTML = "";
      return;
    }
    const requestId = ++friendSearchRequestId;
    friendSearchTimer = setTimeout(async () => {
      try {
        const data = await authFetch(`/users/search?q=${encodeURIComponent(q)}`);
        if (requestId !== friendSearchRequestId) return;
        renderFriendSearchResults(data.users || [], resultsBox, input);
      } catch {
        if (requestId === friendSearchRequestId) resultsBox.innerHTML = "";
      }
    }, 300);
  });
}

function friendStateBadge(u) {
  if (u.isFriend) return '<span class="friend-added-badge">✓ 친구</span>';
  if (u.requestSent) return '<span class="friend-added-badge">요청 보냄</span>';
  if (u.requestReceived) return '<span class="friend-add-badge">받은 요청 수락하기</span>';
  return '<span class="friend-add-badge">+ 요청</span>';
}

function renderFriendSearchResults(users, resultsBox, input) {
  if (!users.length) {
    resultsBox.innerHTML = '<div class="team-search-empty">가입된 사용자 중 일치하는 닉네임이 없습니다.</div>';
    return;
  }
  resultsBox.innerHTML = users
    .map(
      (u) => `
    <div class="team-search-row ${u.isFriend || u.requestSent ? "already-friend" : ""}" data-nickname="${u.nickname}">
      <span class="team-search-name">${u.nickname}</span>
      <span class="team-search-comp">Lv.${u.level}</span>
      ${friendStateBadge(u)}
    </div>
  `
    )
    .join("");

  resultsBox.querySelectorAll("[data-nickname]:not(.already-friend)").forEach((row) => {
    row.addEventListener("click", async () => {
      const errorBox = document.getElementById("friends-add-error");
      errorBox.textContent = "";
      try {
        await authFetch("/friends/request", { method: "POST", body: { nickname: row.dataset.nickname } });
        input.value = "";
        resultsBox.innerHTML = "";
        loadFriends();
        loadFriendRequests();
      } catch (err) {
        errorBox.textContent = err.message;
      }
    });
  });
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

function checkinDoneMessage(status) {
  if (status.resolved) {
    const outcome = status.finalPoints > status.awardedPoints ? " · 승리! 🎉" : status.finalPoints < status.awardedPoints ? " · 패배 😢" : " · 무승부";
    return `✅ 집관인증 완료 (${status.finalPoints >= 0 ? "+" : ""}${status.finalPoints}P${outcome})`;
  }
  return `✅ 집관인증 완료 (+${status.awardedPoints}P · 경기 끝나면 승패 결과로 최종 정산돼요)`;
}

async function renderCheckinSlot(slot, matchId, teamId) {
  try {
    const status = await authFetch(`/checkin/${matchId}`);
    if (status.alreadyCheckedIn) {
      slot.innerHTML = `<div class="checkin-done">${checkinDoneMessage(status)}</div>`;
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
          const result = await authFetch("/checkin", { method: "POST", body: { matchId, teamId } });
          slot.innerHTML = `<div class="checkin-done">✅ 집관인증 완료 (+${result.pointsAwarded}P · 경기 끝나면 승패 결과로 최종 정산돼요${result.leveledUp ? " · 레벨업! 🎉" : ""})</div>`;
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
      renderCheckinSlot(slot, slot.dataset.checkinMatchId, slot.dataset.checkinTeamId);
    });
  }
}

function renderCard(fav, data) {
  const next = data?.upcomingMatches?.[0];
  const nextHtml = next
    ? `<div class="myteam-next">다음 경기: ${next.homeTeam.shortName || next.homeTeam.name} vs ${next.awayTeam.shortName || next.awayTeam.name} · ${formatKickoff(next.utcDate)}</div>`
    : '<div class="myteam-next">예정된 경기 정보 없음</div>';

  const form = formBadgesHtml(data?.recentMatches, fav.id, 5);
  const checkinHtml =
    next && isLoggedIn() ? `<div class="checkin-slot" data-checkin-match-id="${next.id}" data-checkin-team-id="${fav.id}"><div class="loading">·</div></div>` : "";

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
