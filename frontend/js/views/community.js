import { fetchJSON } from "../api.js";
import { onTabChange, pushSubView } from "../router.js";
import { fadeIn, skeletonList, escapeHtml, crestImg } from "../format.js";
import { isLoggedIn, getCurrentUser, authFetch } from "../auth.js";
import { setupMentionAutocomplete } from "../mentionAutocomplete.js";

const el = {
  listWrap: document.getElementById("community-list-wrap"),
  list: document.getElementById("community-list"),
  writeBtn: document.getElementById("community-write-btn"),
  writeWrap: document.getElementById("community-write-wrap"),
  writeBack: document.getElementById("community-write-back"),
  titleInput: document.getElementById("community-title-input"),
  teamInput: document.getElementById("community-team-input"),
  teamResults: document.getElementById("community-team-results"),
  teamPicked: document.getElementById("community-team-picked"),
  bodyInput: document.getElementById("community-body-input"),
  bodyMentionResults: document.getElementById("community-body-mention-results"),
  writeError: document.getElementById("community-write-error"),
  submitBtn: document.getElementById("community-submit-btn"),
  detailWrap: document.getElementById("community-detail-wrap"),
  detailBack: document.getElementById("community-detail-back"),
  postContent: document.getElementById("community-post-content"),
  filterInput: document.getElementById("community-filter-input"),
  filterResults: document.getElementById("community-filter-results"),
  filterChip: document.getElementById("community-filter-chip"),
  categoryTabs: document.getElementById("community-category-tabs"),
  writeCategoryTabs: document.getElementById("community-write-category-tabs"),
};

// 국축/해축 탭 각각 이번 세션에 한 번 그려본 뒤로는 그 탭으로 다시 돌아와도 스켈레톤으로 비우지
// 않고 화면에 남겨둔 채 조용히 새로 받아와서 갈아끼운다(다른 탭들과 동일한 패턴). 팀 필터가
// 바뀌면(선택/해제) 조회 조건 자체가 달라지는 거라 전부 다시 첫 로딩 취급한다.
const loadedCategories = new Set();
// 지금 보고 있는 탭 - "국축"(국내축구) 또는 "해축"(해외축구). 기본은 국축.
let category = "국축";
// 글쓰기에서 고른 국축/해축 분류 - 목록에서 보고 있던 탭을 기본값으로 따라간다.
let writeCategory = "국축";
// 글쓰기에서 고른 팀(선택사항) - 글 등록 요청에 그대로 실어보낸다.
let pickedPostTeam = null;
// 목록에서 "이 팀 얘기만 보기"로 고른 팀 - 없으면 전체.
let filterTeam = null;

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

function showList() {
  el.listWrap.style.display = "block";
  el.writeWrap.style.display = "none";
  el.detailWrap.style.display = "none";
}

async function loadPosts() {
  const alreadyLoaded = loadedCategories.has(category);
  if (!alreadyLoaded) el.list.innerHTML = skeletonList(6);
  try {
    const params = new URLSearchParams({ category });
    if (filterTeam) params.set("teamId", filterTeam.id);
    const data = await fetchJSON(`/community/posts?${params.toString()}`);
    renderList(data.posts || [], !alreadyLoaded);
    loadedCategories.add(category);
  } catch (err) {
    if (!alreadyLoaded) el.list.innerHTML = `<div class="error-state">게시글을 불러오지 못했습니다.<br>${escapeHtml(err.message)}</div>`;
  }
}

// 팀 필터가 바뀌면 조회 조건이 달라지는 거라, 두 탭 다 다음 로딩부터 다시 스켈레톤을 보여준다.
function resetLoadedState() {
  loadedCategories.clear();
}

el.categoryTabs.querySelectorAll(".school-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.category === category) return;
    category = btn.dataset.category;
    el.categoryTabs.querySelectorAll(".school-tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    loadPosts();
  });
});

setupMentionAutocomplete(el.bodyInput, el.bodyMentionResults);

// ---------- 닉네임 옆 친구추가 버튼 ----------
// 로그인 상태 + 내 닉네임이 아닐 때만 보여준다. 이미 친구거나 요청을 이미 보낸 상태는 서버가 그대로
// 알려주는 에러 메시지를 버튼 라벨로 반영한다(별도로 매번 상태 조회를 안 해도 되게).
function friendAddButtonHtml(nickname) {
  const me = getCurrentUser();
  if (!me || me.nickname === nickname) return "";
  return `<button type="button" class="community-friend-add-btn" data-friend-nickname="${escapeHtml(nickname)}">+ 친구</button>`;
}

function wireFriendAddButtons(container) {
  container.querySelectorAll("[data-friend-nickname]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation(); // 게시글 목록 행 클릭(글 열기)으로 안 번지게
      btn.disabled = true;
      try {
        await authFetch("/friends/request", { method: "POST", body: { nickname: btn.dataset.friendNickname } });
        btn.textContent = "✓ 요청됨";
      } catch (err) {
        btn.textContent = /이미/.test(err.message) ? "✓ 완료" : "실패";
        btn.disabled = false;
      }
    });
  });
}

function teamBadgeHtml(team) {
  if (!team) return "";
  return `<span class="community-team-badge">${crestImg(team, "community-team-badge-crest")}${escapeHtml(team.name)}</span>`;
}

function renderList(posts, animate) {
  if (!posts.length) {
    const label = filterTeam ? "이 팀 관련 글이" : `${category} 글이`;
    el.list.innerHTML = `<div class="empty-state">아직 ${label} 없습니다. 첫 글을 남겨보세요!</div>`;
    return;
  }

  el.list.innerHTML = posts
    .map(
      (p) => `
    <div class="community-row" data-post-id="${p.id}">
      <div class="community-row-title">${escapeHtml(p.title)}</div>
      <div class="community-row-meta">
        ${teamBadgeHtml(p.team)}
        <span class="community-row-nickname">${escapeHtml(p.nickname)}</span>
        ${friendAddButtonHtml(p.nickname)}
        <span class="community-row-dot">·</span>
        <span class="community-row-time">${timeAgo(p.createdAt)}</span>
        ${p.commentCount ? `<span class="community-row-comments">💬 ${p.commentCount}</span>` : ""}
      </div>
    </div>
  `
    )
    .join("");

  if (animate) fadeIn(el.list);
  el.list.querySelectorAll("[data-post-id]").forEach((row) => {
    row.addEventListener("click", () => openPost(row.dataset.postId));
  });
  wireFriendAddButtons(el.list);
}

// 이미 상세 화면에 들어와 있는 상태에서(댓글 작성/삭제 후) 내용만 다시 그릴 때 쓴다 - openPost와
// 달리 history를 새로 쌓지 않는다(안 그러면 댓글 하나 달 때마다 뒤로가기 기록이 계속 늘어남).
async function refreshPostDetail(id) {
  el.postContent.innerHTML = skeletonList(3);
  try {
    const data = await fetchJSON(`/community/posts/${id}`);
    renderPost(data.post);
  } catch (err) {
    el.postContent.innerHTML = `<div class="error-state">게시글을 불러오지 못했습니다.<br>${escapeHtml(err.message)}</div>`;
  }
}

// 목록에서 글을 눌러 처음 들어올 때만 호출 - 뒤로가기(하드웨어/제스처 포함)로 목록에 돌아갈 수
// 있도록 history에 등록해둔다.
async function openPost(id) {
  el.listWrap.style.display = "none";
  el.writeWrap.style.display = "none";
  el.detailWrap.style.display = "block";
  pushSubView(() => {
    showList();
    loadPosts();
  });
  await refreshPostDetail(id);
}

function renderPost(post) {
  const me = getCurrentUser();
  // 관리자(GOAT 계정, level===99 - admin.js와 동일한 판정 기준)는 이상한 글/댓글을 신고 없이도
  // 바로 지울 수 있어야 한다(서버 canModerate는 이미 허용했었는데 이 삭제 버튼이 본인 글에만
  // 보여서 실제로 쓸 방법이 없었다 - 사용자 요청, 2026-08-08).
  const isAdmin = me?.progress?.level === 99;
  const canDeletePost = me && (me.username === post.username || isAdmin);

  const commentsHtml = (post.comments || [])
    .map((c) => {
      const isMine = me && me.username === c.username; // 수정은 본인 댓글에만 허용(서버도 동일하게 제한)
      const canDeleteComment = isMine || isAdmin;
      return `
      <div class="community-comment" data-comment-id="${c.id}">
        <div class="community-comment-meta">
          <span class="community-row-nickname">${escapeHtml(c.nickname)}</span>
          ${friendAddButtonHtml(c.nickname)}
          <span class="community-row-dot">·</span>
          <span class="community-row-time">${timeAgo(c.createdAt)}${c.editedAt ? " (수정됨)" : ""}</span>
          ${isMine ? '<button class="community-delete-btn" data-edit-comment>수정</button>' : ""}
          ${canDeleteComment ? '<button class="community-delete-btn" data-delete-comment>삭제</button>' : ""}
          ${!isMine && !isAdmin && me ? '<button class="community-report-btn" data-report-comment>신고</button>' : ""}
        </div>
        <div class="community-comment-body" data-comment-body>${escapeHtml(c.body)}</div>
      </div>
    `;
    })
    .join("");

  el.postContent.innerHTML = `
    <div class="community-post-header">
      <h3 class="community-post-title">${escapeHtml(post.title)}</h3>
      ${canDeletePost ? '<button class="community-delete-btn" data-delete-post>삭제</button>' : ""}
      ${!canDeletePost && me ? '<button class="community-report-btn" data-report-post>신고</button>' : ""}
    </div>
    <div class="community-row-meta">
      ${teamBadgeHtml(post.team)}
      <span class="community-row-nickname">${escapeHtml(post.nickname)}</span>
      ${friendAddButtonHtml(post.nickname)}
      <span class="community-row-dot">·</span>
      <span class="community-row-time">${timeAgo(post.createdAt)}</span>
    </div>
    <div class="community-post-body">${escapeHtml(post.body)}</div>

    <div class="community-comments-section">
      <div class="community-comments-title">댓글 ${post.comments?.length || 0}개</div>
      <div class="community-comments-list">${commentsHtml}</div>
      ${
        isLoggedIn()
          ? `
        <div class="community-comment-form">
          <div class="team-search-wrap">
            <textarea id="community-comment-input" class="community-comment-input" placeholder="댓글을 남겨보세요 (@닉네임으로 태그할 수 있어요)" maxlength="500" rows="2"></textarea>
            <div id="community-comment-mention-results" class="team-search-results"></div>
          </div>
          <button id="community-comment-submit" class="community-submit-btn">등록</button>
        </div>
      `
          : '<div class="community-login-hint">댓글을 남기려면 로그인이 필요해요 (나의 팀 탭)</div>'
      }
    </div>
  `;

  wireFriendAddButtons(el.postContent);
  setupMentionAutocomplete(
    document.getElementById("community-comment-input"),
    document.getElementById("community-comment-mention-results")
  );

  if (canDeletePost) {
    el.postContent.querySelector("[data-delete-post]").addEventListener("click", async () => {
      if (!confirm("이 글을 삭제할까요?")) return;
      try {
        await authFetch(`/community/posts/${post.id}`, { method: "DELETE" });
        resetLoadedState();
        // 이 상세 화면은 openPost로 들어올 때 이미 "뒤로가면 목록으로" 기록을 쌓아뒀으니, 여기서도
        // 직접 목록으로 되돌리지 않고 그 기록을 그대로 소비한다(안 그러면 history가 실제 화면과 어긋남).
        history.back();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  el.postContent.querySelector("[data-report-post]")?.addEventListener("click", async () => {
    const reason = prompt("신고 사유를 알려주세요 (선택 입력)", "");
    if (reason === null) return;
    try {
      await authFetch(`/community/posts/${post.id}/report`, { method: "POST", body: { reason } });
      alert("신고가 접수됐어요. 검토 후 조치할게요.");
    } catch (err) {
      alert(err.message);
    }
  });

  el.postContent.querySelectorAll("[data-report-comment]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const reason = prompt("신고 사유를 알려주세요 (선택 입력)", "");
      if (reason === null) return;
      const commentId = btn.closest("[data-comment-id]").dataset.commentId;
      try {
        await authFetch(`/community/posts/${post.id}/comments/${commentId}/report`, { method: "POST", body: { reason } });
        alert("신고가 접수됐어요. 검토 후 조치할게요.");
      } catch (err) {
        alert(err.message);
      }
    });
  });

  el.postContent.querySelectorAll("[data-delete-comment]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("이 댓글을 삭제할까요?")) return;
      const commentId = btn.closest("[data-comment-id]").dataset.commentId;
      try {
        await authFetch(`/community/posts/${post.id}/comments/${commentId}`, { method: "DELETE" });
        refreshPostDetail(post.id);
      } catch (err) {
        alert(err.message);
      }
    });
  });

  // 수정 버튼을 누르면 그 댓글 본문 자리를 textarea + 저장/취소 버튼으로 바꿔치기한다(전체 화면을
  // 다시 그리지 않고 그 댓글만 인라인으로 편집 - 스크롤 위치도 그대로 유지됨).
  el.postContent.querySelectorAll("[data-edit-comment]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const commentEl = btn.closest("[data-comment-id]");
      const commentId = commentEl.dataset.commentId;
      const comment = (post.comments || []).find((c) => c.id === commentId);
      if (!comment) return;
      const bodyEl = commentEl.querySelector("[data-comment-body]");
      bodyEl.innerHTML = `
        <textarea class="community-comment-input" maxlength="500" rows="2">${escapeHtml(comment.body)}</textarea>
        <div class="community-comment-edit-actions">
          <button class="community-submit-btn" data-save-comment>저장</button>
          <button class="community-delete-btn" data-cancel-comment>취소</button>
        </div>
      `;
      bodyEl.querySelector("[data-cancel-comment]").addEventListener("click", () => refreshPostDetail(post.id));
      bodyEl.querySelector("[data-save-comment]").addEventListener("click", async (e) => {
        const newBody = bodyEl.querySelector("textarea").value.trim();
        if (!newBody) return;
        e.target.disabled = true;
        try {
          await authFetch(`/community/posts/${post.id}/comments/${commentId}`, { method: "PUT", body: { body: newBody } });
          await refreshPostDetail(post.id);
        } catch (err) {
          alert(err.message);
          e.target.disabled = false;
        }
      });
    });
  });

  const commentSubmitBtn = document.getElementById("community-comment-submit");
  if (commentSubmitBtn) {
    commentSubmitBtn.addEventListener("click", async () => {
      const input = document.getElementById("community-comment-input");
      const body = input.value.trim();
      if (!body) return;
      commentSubmitBtn.disabled = true;
      try {
        await authFetch(`/community/posts/${post.id}/comments`, { method: "POST", body: { body } });
        resetLoadedState(); // 목록의 댓글 수도 최신으로 다시 받아오게
        await refreshPostDetail(post.id);
      } catch (err) {
        alert(err.message);
      } finally {
        commentSubmitBtn.disabled = false;
      }
    });
  }
}

function openWriteForm() {
  if (!isLoggedIn()) {
    alert("글쓰기는 로그인이 필요해요 - '나의 팀' 탭에서 로그인해주세요.");
    return;
  }
  el.listWrap.style.display = "none";
  el.detailWrap.style.display = "none";
  el.writeWrap.style.display = "block";
  pushSubView(() => {
    showList();
    loadPosts();
  });
  el.titleInput.value = "";
  el.bodyInput.value = "";
  el.writeError.style.display = "none";
  pickedPostTeam = null;
  el.teamInput.value = "";
  el.teamResults.innerHTML = "";
  el.teamPicked.style.display = "none";
  // 지금 보고 있던 목록 탭을 글쓰기 기본 분류로 따라가되, 언제든 바꿔서 쓸 수 있게 둔다.
  writeCategory = category;
  el.writeCategoryTabs.querySelectorAll(".school-tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.category === writeCategory));
  el.titleInput.focus();
}

el.writeCategoryTabs.querySelectorAll(".school-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    writeCategory = btn.dataset.category;
    el.writeCategoryTabs.querySelectorAll(".school-tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
  });
});

// 실제 되돌리기는 openPost/openWriteForm이 pushSubView로 등록해둔 콜백이 popstate 시점에 처리한다.
el.writeBtn.addEventListener("click", openWriteForm);
el.writeBack.addEventListener("click", () => history.back());
el.detailBack.addEventListener("click", () => history.back());

// ---------- 글쓰기: 관련 팀 선택(선택사항) - 나의 팀/회원가입 팀 검색과 같은 패턴 ----------
let teamSearchTimer = null;
let teamSearchRequestId = 0;

el.teamInput.addEventListener("input", () => {
  const q = el.teamInput.value.trim();
  clearTimeout(teamSearchTimer);
  if (q.length < 1) {
    teamSearchRequestId++;
    el.teamResults.innerHTML = "";
    return;
  }
  const requestId = ++teamSearchRequestId;
  teamSearchTimer = setTimeout(async () => {
    try {
      const data = await fetchJSON(`/teams/search?q=${encodeURIComponent(q)}`);
      if (requestId !== teamSearchRequestId) return;
      renderTeamPickResults(data.teams || []);
    } catch {
      if (requestId === teamSearchRequestId) el.teamResults.innerHTML = "";
    }
  }, 300);
});

function renderTeamPickResults(teams) {
  if (!teams.length) {
    el.teamResults.innerHTML = '<div class="team-search-empty">검색 결과가 없습니다.</div>';
    return;
  }
  el.teamResults.innerHTML = teams
    .map(
      (t) => `
    <div class="team-search-row" data-team-id="${t.id}">
      ${crestImg(t, "team-search-crest")}
      <span class="team-search-name">${escapeHtml(t.name)}</span>
      <span class="team-search-comp">${escapeHtml(t.competitionName)}</span>
    </div>
  `
    )
    .join("");
  el.teamResults.querySelectorAll("[data-team-id]").forEach((row, i) => {
    row.addEventListener("click", () => {
      pickedPostTeam = teams[i];
      el.teamInput.value = "";
      el.teamResults.innerHTML = "";
      el.teamPicked.style.display = "flex";
      el.teamPicked.innerHTML = `${crestImg(pickedPostTeam, "team-picked-crest")}<span>${escapeHtml(pickedPostTeam.name)}</span><button type="button" id="community-team-clear">✕</button>`;
      document.getElementById("community-team-clear").addEventListener("click", () => {
        pickedPostTeam = null;
        el.teamPicked.style.display = "none";
      });
    });
  });
}

// ---------- 목록 필터: "이 팀 얘기만 보기" - 같은 팀 검색 패턴을 재사용 ----------
let filterSearchTimer = null;
let filterSearchRequestId = 0;

el.filterInput.addEventListener("input", () => {
  const q = el.filterInput.value.trim();
  clearTimeout(filterSearchTimer);
  if (q.length < 1) {
    filterSearchRequestId++;
    el.filterResults.innerHTML = "";
    return;
  }
  const requestId = ++filterSearchRequestId;
  filterSearchTimer = setTimeout(async () => {
    try {
      const data = await fetchJSON(`/teams/search?q=${encodeURIComponent(q)}`);
      if (requestId !== filterSearchRequestId) return;
      renderFilterResults(data.teams || []);
    } catch {
      if (requestId === filterSearchRequestId) el.filterResults.innerHTML = "";
    }
  }, 300);
});

function renderFilterResults(teams) {
  if (!teams.length) {
    el.filterResults.innerHTML = '<div class="team-search-empty">검색 결과가 없습니다.</div>';
    return;
  }
  el.filterResults.innerHTML = teams
    .map(
      (t) => `
    <div class="team-search-row" data-team-id="${t.id}">
      ${crestImg(t, "team-search-crest")}
      <span class="team-search-name">${escapeHtml(t.name)}</span>
      <span class="team-search-comp">${escapeHtml(t.competitionName)}</span>
    </div>
  `
    )
    .join("");
  el.filterResults.querySelectorAll("[data-team-id]").forEach((row, i) => {
    row.addEventListener("click", () => {
      filterTeam = teams[i];
      el.filterInput.value = "";
      el.filterResults.innerHTML = "";
      el.filterChip.style.display = "flex";
      el.filterChip.innerHTML = `${crestImg(filterTeam, "team-picked-crest")}<span>${escapeHtml(filterTeam.name)} 글만 보는 중</span><button type="button" id="community-filter-clear">✕</button>`;
      document.getElementById("community-filter-clear").addEventListener("click", () => {
        filterTeam = null;
        el.filterChip.style.display = "none";
        resetLoadedState();
        loadPosts();
      });
      resetLoadedState();
      loadPosts();
    });
  });
}

el.submitBtn.addEventListener("click", async () => {
  const title = el.titleInput.value.trim();
  const body = el.bodyInput.value.trim();
  if (!title || !body) {
    el.writeError.textContent = "제목과 내용을 모두 입력해주세요.";
    el.writeError.style.display = "block";
    return;
  }
  el.submitBtn.disabled = true;
  try {
    await authFetch("/community/posts", {
      method: "POST",
      body: {
        title,
        body,
        category: writeCategory,
        teamId: pickedPostTeam?.id || null,
        teamName: pickedPostTeam?.name || null,
        teamCrest: pickedPostTeam?.crest || null,
      },
    });
    // 방금 올린 글의 분류로 목록 탭을 맞춰서, 글쓴 직후 바로 내가 쓴 글이 보이게 한다.
    category = writeCategory;
    el.categoryTabs.querySelectorAll(".school-tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.category === category));
    resetLoadedState();
    // openWriteForm이 pushSubView로 등록해둔 "목록으로 돌아가서 새로고침" 콜백을 그대로 소비한다.
    history.back();
  } catch (err) {
    el.writeError.textContent = err.message;
    el.writeError.style.display = "block";
  } finally {
    el.submitBtn.disabled = false;
  }
});

onTabChange("community", () => {
  showList();
  loadPosts();
});
