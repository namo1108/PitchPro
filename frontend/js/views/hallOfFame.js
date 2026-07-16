import { fetchJSON } from "../api.js";
import { onTabChange } from "../router.js";
import { fadeIn, skeletonList } from "../format.js";
import { getCurrentUser, onAuthChange } from "../auth.js";

const el = { list: document.getElementById("hof-list") };

const MEDAL = { 1: "🥇", 2: "🥈", 3: "🥉" };

async function loadLeaderboard() {
  el.list.innerHTML = skeletonList(8);
  try {
    const data = await fetchJSON("/leaderboard");
    renderLeaderboard(data.entries || [], data.me);
  } catch (err) {
    el.list.innerHTML = `<div class="error-state">명예의 전당을 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

function rowHtml(entry, isMe) {
  return `
    <div class="hof-row ${isMe ? "me" : ""}">
      <span class="hof-rank">${MEDAL[entry.rank] || entry.rank}</span>
      <span class="hof-nickname">${entry.nickname}${isMe ? " (나)" : ""}<span class="hof-title">${entry.title || ""}</span></span>
      <span class="hof-level">Lv.${entry.level}</span>
      <span class="hof-points">${entry.points.toLocaleString()}P</span>
    </div>
  `;
}

function renderLeaderboard(entries, me) {
  if (!entries.length) {
    el.list.innerHTML = '<div class="empty-state">아직 집관인증한 사용자가 없습니다. 로그인하고 첫 주인공이 되어보세요!</div>';
    return;
  }

  const myNickname = getCurrentUser()?.nickname;
  const meOutsideTop = me && me.rank === null;

  el.list.innerHTML = `
    <div class="hof-list-header">
      <span class="hof-rank">순위</span>
      <span class="hof-nickname">닉네임</span>
      <span class="hof-level">레벨</span>
      <span class="hof-points">포인트</span>
    </div>
    ${entries.map((e) => rowHtml(e, e.nickname === myNickname)).join("")}
    ${
      meOutsideTop
        ? `<div class="hof-my-rank-note">아직 TOP 100 밖이에요 (${me.points.toLocaleString()}P · Lv.${me.level}) - 집관인증으로 순위를 올려보세요!</div>`
        : ""
    }
  `;

  fadeIn(el.list);
}

onTabChange("hof", loadLeaderboard);
onAuthChange(() => {
  if (document.getElementById("view-hof")?.classList.contains("active")) loadLeaderboard();
});
