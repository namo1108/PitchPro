import { fetchJSON } from "../api.js";
import { onTabChange } from "../router.js";
import { crestImg, formatMatchDateTime, formBadgesHtml, teamHintFromElement } from "../format.js";
import { listFavorites, toggleFavorite } from "../favorites.js";
import { goToTeam } from "./teamDetail.js";
import { openSoccerSchool } from "./soccerSchool.js";
import { getCurrentUser, isLoggedIn, signup, login, logout, deleteAccount, refreshMe, onAuthChange, authFetch } from "../auth.js";
import { trackEvent } from "../analytics.js";

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
  agreeTerms: document.getElementById("auth-agree-terms"),
};

// 축구교실은 순수 정적 콘텐츠(규칙/포지션/포메이션/용어)라 로그인 여부와 무관하게 항상 눌러야 하므로,
// 로그인 후에만 다시 그려지는 profile-wrap 밖(index.html)의 고정 버튼에 한 번만 리스너를 붙인다.
document.getElementById("soccer-school-btn")?.addEventListener("click", () => openSoccerSchool());

// ---------- 로그인/회원가입 ----------

let authMode = "login";
let pickedTeam = null;

function setAuthMode(mode) {
  authMode = mode;
  el.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));
  el.signupFields.style.display = mode === "signup" ? "block" : "none";
  // 회원가입 전용 필드를 감싼 el.signupFields를 display:none으로 숨겨도, 그 안의 약관 동의
  // 체크박스는 required 속성이 남아있으면 크롬이 "보이지 않는 요소"로 제외해주지 않고 여전히
  // 폼 검증 대상으로 취급한다 - 그래서 로그인 모드에선 체크 안 한 채 조용히 제출 자체가 막혀서
  // 로그인 버튼을 눌러도 아무 반응이 없는 것처럼 보이는 버그가 있었다(2026-08-10 제보). 화면에
  // 안 보이게만 하지 말고 required 자체를 떼어내야 한다.
  el.agreeTerms.required = mode === "signup";
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
      // 국가대표팀은 "나의 팀"에 못 넣게 해서(2026-08-17) 최애팀 검색 결과에서도 아예 뺀다.
      renderTeamResults((data.teams || []).filter((t) => t.competitionName !== "국가대표"));
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
  el.form.style.display = "block";
  document.getElementById("auth-find-wrap").style.display = "none";
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
        securityAnswer: document.getElementById("auth-security-answer")?.value.trim() || "",
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

// ---------- 아이디/비밀번호 찾기 ----------
// 이메일/휴대폰 인증이 없는 앱이라, 아이디 찾기는 닉네임으로 조회하고 비밀번호 찾기는 가입 때
// 선택적으로 등록한 보안 답변으로 본인 확인한다(둘 다 auth.js의 새 엔드포인트를 그대로 fetchJSON으로 호출).
const findEl = {
  wrap: document.getElementById("auth-find-wrap"),
  toggleBtn: document.getElementById("auth-find-toggle"),
  closeBtn: document.getElementById("auth-find-close"),
  tabs: document.querySelectorAll("#auth-find-wrap .auth-form-tab"),
  usernamePanel: document.getElementById("auth-find-username-panel"),
  passwordPanel: document.getElementById("auth-find-password-panel"),
};

findEl.toggleBtn?.addEventListener("click", () => {
  el.form.style.display = "none";
  findEl.wrap.style.display = "block";
});

findEl.closeBtn?.addEventListener("click", () => {
  findEl.wrap.style.display = "none";
  el.form.style.display = "block";
});

findEl.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    findEl.tabs.forEach((t) => t.classList.toggle("active", t === tab));
    const mode = tab.dataset.findMode;
    findEl.usernamePanel.style.display = mode === "username" ? "block" : "none";
    findEl.passwordPanel.style.display = mode === "password" ? "block" : "none";
  });
});

document.getElementById("find-username-submit")?.addEventListener("click", async () => {
  const resultBox = document.getElementById("find-username-result");
  const nickname = document.getElementById("find-username-nickname").value.trim();
  if (!nickname) return;
  resultBox.className = "auth-find-result";
  resultBox.textContent = "찾는 중...";
  try {
    const data = await fetchJSON("/auth/find-username", { method: "POST", body: { nickname } });
    resultBox.className = "auth-find-result ok";
    resultBox.textContent = `아이디는 "${data.username}" 입니다.`;
  } catch (err) {
    resultBox.className = "auth-find-result error";
    resultBox.textContent = err.message;
  }
});

document.getElementById("find-password-check")?.addEventListener("click", async () => {
  const username = document.getElementById("find-password-username").value.trim();
  const resultBox = document.getElementById("find-password-result");
  const questionWrap = document.getElementById("find-password-question-wrap");
  questionWrap.style.display = "none";
  resultBox.className = "auth-find-result";
  if (!username) return;
  resultBox.textContent = "확인 중...";
  try {
    const data = await fetchJSON("/auth/find-password/check", { method: "POST", body: { username } });
    if (!data.hasSecurityQuestion) {
      resultBox.className = "auth-find-result error";
      resultBox.textContent = "보안 질문이 설정되어 있지 않아요. 관리자에게 문의해주세요.";
      return;
    }
    resultBox.textContent = "";
    document.getElementById("find-password-question-text").textContent = data.question;
    questionWrap.style.display = "block";
  } catch (err) {
    resultBox.className = "auth-find-result error";
    resultBox.textContent = err.message;
  }
});

document.getElementById("find-password-submit")?.addEventListener("click", async (e) => {
  const username = document.getElementById("find-password-username").value.trim();
  const securityAnswer = document.getElementById("find-password-answer").value.trim();
  const newPassword = document.getElementById("find-password-new").value;
  const resultBox = document.getElementById("find-password-result");
  e.target.disabled = true;
  try {
    await fetchJSON("/auth/find-password/reset", { method: "POST", body: { username, securityAnswer, newPassword } });
    resultBox.className = "auth-find-result ok";
    resultBox.textContent = "비밀번호가 변경됐어요. 이제 로그인해주세요.";
  } catch (err) {
    resultBox.className = "auth-find-result error";
    resultBox.textContent = err.message;
  } finally {
    e.target.disabled = false;
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
  pointsHistoryLoaded = false; // 로그인/로그아웃으로 계정이 바뀌면 이전 사용자의 내역 캐시를 버린다.
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
      <div class="profile-level-row">
        ${levelBarHtml(user)}
        <button id="points-info-btn" class="points-info-btn" aria-label="포인트 안내" title="포인트 안내">ⓘ</button>
      </div>
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
      <button id="delete-account-open-btn" class="account-delete-link">회원 탈퇴</button>
    </div>
  `;

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await logout();
  });

  document.getElementById("delete-account-open-btn").addEventListener("click", openDeleteAccountModal);

  document.getElementById("points-info-btn").addEventListener("click", showPointsInfoModal);
  // 로그인 후 이 프로필 카드를 처음 보는 순간 한 번 자동으로 띄워서 "뭐 하면 몇 점"인지 바로 알려준다.
  // 이후엔 ⓘ 버튼으로 언제든 다시 열어볼 수 있다.
  if (!localStorage.getItem(POINTS_INFO_SEEN_KEY)) {
    localStorage.setItem(POINTS_INFO_SEEN_KEY, "1");
    showPointsInfoModal();
  }

  initFriendSearch();
  loadFriends();
  loadFriendRequests();
}

// ---------- 포인트 안내 팝업 ----------
const POINTS_INFO_SEEN_KEY = "points-info-seen-v1";
const pointsInfoModal = document.getElementById("points-info-modal");

function showPointsInfoModal() {
  pointsInfoModal.style.display = "flex";
}

function hidePointsInfoModal() {
  pointsInfoModal.style.display = "none";
}

document.getElementById("points-info-close")?.addEventListener("click", hidePointsInfoModal);
document.querySelector("#points-info-modal .points-info-backdrop")?.addEventListener("click", hidePointsInfoModal);

// ---------- 회원 탈퇴 팝업 ----------
const deleteAccountModal = document.getElementById("delete-account-modal");
const deleteAccountPassword = document.getElementById("delete-account-password");
const deleteAccountError = document.getElementById("delete-account-error");
const deleteAccountConfirmBtn = document.getElementById("delete-account-confirm-btn");

function openDeleteAccountModal() {
  deleteAccountPassword.value = "";
  deleteAccountError.textContent = "";
  deleteAccountModal.style.display = "flex";
}

function hideDeleteAccountModal() {
  deleteAccountModal.style.display = "none";
}

document.getElementById("delete-account-close")?.addEventListener("click", hideDeleteAccountModal);
document.querySelector("#delete-account-modal .points-info-backdrop")?.addEventListener("click", hideDeleteAccountModal);

deleteAccountConfirmBtn?.addEventListener("click", async () => {
  const password = deleteAccountPassword.value;
  if (!password) {
    deleteAccountError.textContent = "비밀번호를 입력해주세요.";
    return;
  }
  deleteAccountConfirmBtn.disabled = true;
  deleteAccountError.textContent = "";
  try {
    await deleteAccount({ password });
    hideDeleteAccountModal();
  } catch (err) {
    deleteAccountError.textContent = err.message;
  } finally {
    deleteAccountConfirmBtn.disabled = false;
  }
});

// 안내 카드 맨 아래 "내 포인트 내역 보기"를 누르면 그 자리에서 실제 내역(집관인증/승패 정산 등)을
// 펼쳐 보여준다 - 매번 다시 열 때마다 새로 받아오지 않고 이 모달이 열려있는 동안엔 한 번만 불러온다.
let pointsHistoryLoaded = false;
document.getElementById("points-history-toggle")?.addEventListener("click", async (e) => {
  const listEl = document.getElementById("points-history-list");
  const isOpen = listEl.style.display !== "none";
  if (isOpen) {
    listEl.style.display = "none";
    e.target.textContent = "📜 내 포인트 내역 보기";
    return;
  }
  listEl.style.display = "block";
  e.target.textContent = "📜 내 포인트 내역 숨기기";
  if (pointsHistoryLoaded) return;
  listEl.innerHTML = '<div class="loading">불러오는 중...</div>';
  try {
    const data = await authFetch("/points/history");
    renderPointsHistory(data.history || []);
    pointsHistoryLoaded = true;
  } catch (err) {
    listEl.innerHTML = `<div class="error-state">${err.message}</div>`;
  }
});

function renderPointsHistory(history) {
  const listEl = document.getElementById("points-history-list");
  if (!history.length) {
    listEl.innerHTML = '<div class="empty-state">아직 포인트 내역이 없어요.</div>';
    return;
  }
  listEl.innerHTML = history
    .map((h) => {
      const isPlus = h.delta > 0;
      const sign = isPlus ? "+" : "";
      return `
      <div class="points-history-row">
        <div class="points-history-reason">${h.reason || "포인트 변동"}</div>
        <div class="points-history-meta">
          <span class="points-history-delta ${isPlus ? "good" : h.delta < 0 ? "bad" : ""}">${sign}${h.delta}P</span>
          <span class="points-history-date">${new Date(h.at).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })}</span>
        </div>
      </div>
    `;
    })
    .join("");
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
          trackEvent("checkin");
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

// 이번 세션에 한 번 그려본 뒤로는 탭을 다시 눌러도 "불러오는 중..."으로 비우지 않고 화면에
// 남겨둔 채 조용히 새로 받아와서 갈아끼운다 - 매번 탭 전환마다 깜빡이며 로딩되는 느낌을 없앤다.
let myTeamLoadedOnce = false;

export async function loadMyTeam() {
  renderProfile();

  const favorites = listFavorites();
  if (!favorites.length) {
    el.list.innerHTML = '<div class="empty-state">팀 상세 화면에서 ★를 눌러 즐겨찾기하세요.</div>';
    return;
  }

  if (!myTeamLoadedOnce) el.list.innerHTML = '<div class="loading">불러오는 중...</div>';
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
  myTeamLoadedOnce = true;

  el.list.querySelectorAll("[data-team-id]").forEach((elm) => {
    elm.addEventListener("click", (e) => {
      if (e.target.closest("[data-remove]") || e.target.closest(".checkin-slot")) return;
      goToTeam(elm.dataset.teamId, teamHintFromElement(elm));
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
    ? `<div class="myteam-next">다음 경기: ${next.homeTeam.shortName || next.homeTeam.name} vs ${next.awayTeam.shortName || next.awayTeam.name} · ${formatMatchDateTime(next.utcDate)}</div>`
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
