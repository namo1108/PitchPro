import { fetchJSON } from "../api.js";
import { onTabChange } from "../router.js";
import { fadeIn, skeletonList, escapeHtml } from "../format.js";
import { authFetch, isLoggedIn, getToken, onAuthChange } from "../auth.js";

const el = { list: document.getElementById("hof-list") };

const MEDAL = { 1: "🥇", 2: "🥈", 3: "🥉" };

// 로그인 여부와 무관하게 볼 수 있는 화면이지만, 로그인 중이면 토큰을 같이 보내야 서버가
// 나와 각 순위의 친구 관계(isFriend/requestSent 등)를 계산해서 돌려준다.
// 이번 세션에 한 번 그려본 뒤로는 탭을 다시 눌러도 스켈레톤으로 비우지 않고 화면에 남겨둔 채
// 조용히 새로 받아와서 갈아끼운다 - 매번 탭 전환마다 깜빡이며 로딩되는 느낌을 없앤다.
let loadedOnce = false;

async function loadLeaderboard() {
  if (!loadedOnce) el.list.innerHTML = skeletonList(8);
  try {
    const data = await fetchJSON("/leaderboard", { token: getToken() });
    renderLeaderboard(data.entries || [], data.goats || [], data.me, !loadedOnce);
    loadedOnce = true;
  } catch (err) {
    if (!loadedOnce) el.list.innerHTML = `<div class="error-state">명예의 전당을 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

// 로그인 상태 + 나 자신이 아닐 때만 친구 관련 UI를 보여준다. 이미 친구/요청 보낸 상태는 배지로만
// 알려주고, 아직 아무 관계도 없으면 "+친구" 버튼을, 상대가 먼저 요청을 보내온 상태면 "요청 수락"
// 버튼을 커뮤니티 탭과 같은 스타일(community-friend-add-btn)로 보여준다 - 예전엔 행 전체를 눌러야
// 친구 요청이 가는 방식이라 눈에 잘 안 띄었다("친구버튼 명예의 전당에도 넣어달라" 요청, 2026-09-02).
function friendActionHtml(entry) {
  if (!isLoggedIn() || entry.isMe) return "";
  if (entry.isFriend) return '<span class="hof-friend-badge">✓ 친구</span>';
  if (entry.requestSent) return '<span class="hof-friend-badge pending">요청함</span>';
  if (entry.requestReceived) {
    return `<button type="button" class="community-friend-add-btn" data-nickname="${escapeHtml(entry.nickname)}" data-hof-accept>요청 수락</button>`;
  }
  return `<button type="button" class="community-friend-add-btn" data-nickname="${escapeHtml(entry.nickname)}">+ 친구</button>`;
}

function rowHtml(entry) {
  return `
    <div class="hof-row ${entry.isMe ? "me" : ""}">
      <span class="hof-rank">${MEDAL[entry.rank] || entry.rank}</span>
      <span class="hof-nickname">${escapeHtml(entry.nickname)}${entry.isMe ? " (나)" : ""}${friendActionHtml(entry)}<span class="hof-title">${escapeHtml(entry.title || "")}</span></span>
      <span class="hof-level">Lv.${entry.level}</span>
      <span class="hof-points">${entry.points.toLocaleString()}P</span>
    </div>
  `;
}

// GOAT_USERNAMES(운영자 이스터에그)는 순위 경쟁에서 빼고 맨 위에 염소 아이콘과 함께 고정으로 보여준다.
function goatRowHtml(entry) {
  return `
    <div class="hof-row goat ${entry.isMe ? "me" : ""}">
      <span class="hof-rank">🐐</span>
      <span class="hof-nickname">${escapeHtml(entry.nickname)}${entry.isMe ? " (나)" : ""}${friendActionHtml(entry)}<span class="hof-title">${escapeHtml(entry.title || "")}</span></span>
      <span class="hof-level">GOAT</span>
      <span class="hof-points">${entry.points.toLocaleString()}P</span>
    </div>
  `;
}

async function handleFriendAction(btn) {
  const nickname = btn.dataset.nickname;
  const isAccept = "hofAccept" in btn.dataset;
  btn.disabled = true;
  try {
    if (isAccept) {
      await authFetch(`/friends/requests/${encodeURIComponent(nickname)}/accept`, { method: "POST", body: {} });
    } else {
      await authFetch("/friends/request", { method: "POST", body: { nickname } });
    }
    loadLeaderboard();
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
  }
}

function renderLeaderboard(entries, goats, me, animate) {
  if (!entries.length && !goats.length) {
    el.list.innerHTML = '<div class="empty-state">아직 집관인증한 사용자가 없습니다. 로그인하고 첫 주인공이 되어보세요!</div>';
    return;
  }

  const meOutsideTop = me && me.rank === null;

  el.list.innerHTML = `
    ${goats.map(goatRowHtml).join("")}
    <div class="hof-list-header">
      <span class="hof-rank">순위</span>
      <span class="hof-nickname">닉네임</span>
      <span class="hof-level">레벨</span>
      <span class="hof-points">포인트</span>
    </div>
    ${entries.map(rowHtml).join("")}
    ${
      meOutsideTop
        ? `<div class="hof-my-rank-note">아직 TOP 100 밖이에요 (${me.points.toLocaleString()}P · Lv.${me.progress?.level}) - 집관인증으로 순위를 올려보세요!</div>`
        : ""
    }
  `;

  if (animate) fadeIn(el.list);
  el.list.querySelectorAll("[data-nickname]").forEach((btn) => {
    btn.addEventListener("click", () => handleFriendAction(btn));
  });
}

onTabChange("hof", loadLeaderboard);
onAuthChange(() => {
  if (document.getElementById("view-hof")?.classList.contains("active")) loadLeaderboard();
});
