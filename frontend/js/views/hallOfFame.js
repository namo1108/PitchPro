import { fetchJSON } from "../api.js";
import { onTabChange } from "../router.js";
import { fadeIn, skeletonList } from "../format.js";
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

function friendStateBadge(entry) {
  if (entry.isFriend) return '<span class="hof-friend-badge">친구</span>';
  if (entry.requestSent) return '<span class="hof-friend-badge pending">요청함</span>';
  if (entry.requestReceived) return '<span class="hof-friend-badge pending">요청 받음 · 눌러서 수락</span>';
  return "";
}

// 로그인 상태에서 나 자신이 아니고 이미 친구도 아닌 닉네임은 눌러서 친구 요청(또는 받은 요청 수락)을 보낼 수 있다.
function isClickable(entry) {
  return isLoggedIn() && !entry.isMe && !entry.isFriend;
}

function rowHtml(entry) {
  const clickable = isClickable(entry);
  return `
    <div class="hof-row ${entry.isMe ? "me" : ""} ${clickable ? "clickable" : ""}" ${clickable ? `data-nickname="${entry.nickname}" data-request-received="${entry.requestReceived}"` : ""}>
      <span class="hof-rank">${MEDAL[entry.rank] || entry.rank}</span>
      <span class="hof-nickname">${entry.nickname}${entry.isMe ? " (나)" : ""}${friendStateBadge(entry)}<span class="hof-title">${entry.title || ""}</span></span>
      <span class="hof-level">Lv.${entry.level}</span>
      <span class="hof-points">${entry.points.toLocaleString()}P</span>
    </div>
  `;
}

// GOAT_USERNAMES(운영자 이스터에그)는 순위 경쟁에서 빼고 맨 위에 염소 아이콘과 함께 고정으로 보여준다.
function goatRowHtml(entry) {
  const clickable = isClickable(entry);
  return `
    <div class="hof-row goat ${entry.isMe ? "me" : ""} ${clickable ? "clickable" : ""}" ${clickable ? `data-nickname="${entry.nickname}" data-request-received="${entry.requestReceived}"` : ""}>
      <span class="hof-rank">🐐</span>
      <span class="hof-nickname">${entry.nickname}${entry.isMe ? " (나)" : ""}${friendStateBadge(entry)}<span class="hof-title">${entry.title || ""}</span></span>
      <span class="hof-level">GOAT</span>
      <span class="hof-points">${entry.points.toLocaleString()}P</span>
    </div>
  `;
}

async function handleRowClick(row) {
  const nickname = row.dataset.nickname;
  const isAccept = row.dataset.requestReceived === "true";
  try {
    if (isAccept) {
      await authFetch(`/friends/requests/${encodeURIComponent(nickname)}/accept`, { method: "POST", body: {} });
    } else {
      await authFetch("/friends/request", { method: "POST", body: { nickname } });
    }
    loadLeaderboard();
  } catch (err) {
    alert(err.message);
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
  el.list.querySelectorAll(".hof-row.clickable").forEach((row) => {
    row.addEventListener("click", () => handleRowClick(row));
  });
}

onTabChange("hof", loadLeaderboard);
onAuthChange(() => {
  if (document.getElementById("view-hof")?.classList.contains("active")) loadLeaderboard();
});
