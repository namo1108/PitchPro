import { fetchJSON } from "../api.js";
import { pushDetail } from "../router.js";
import { playerAvatarImg, fadeIn, skeletonList } from "../format.js";
import { saveViewState } from "../viewState.js";

const el = {
  content: document.getElementById("player-detail-content"),
};

export function goToPlayer(playerId) {
  pushDetail("player");
  saveViewState({ view: "player", playerId });
  loadPlayerDetail(playerId);
}

async function loadPlayerDetail(playerId) {
  el.content.innerHTML = skeletonList(5);
  try {
    const data = await fetchJSON(`/players/${playerId}`);
    renderPlayerDetail(data);
    fadeIn(el.content);
  } catch (err) {
    el.content.innerHTML = `<div class="error-state">선수 정보를 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

function calcAge(dateBorn) {
  if (!dateBorn) return null;
  const birth = new Date(dateBorn);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

function formerTeamRow(ft) {
  const period = [ft.joined, ft.departed].filter(Boolean).join(" ~ ");
  return `
    <div class="mini-match-row transfer-row">
      <div class="mini-team">
        ${ft.crest ? `<img class="team-crest" src="${ft.crest}" alt="" />` : ""}
        <span>${ft.team}</span>
      </div>
      <div class="mini-status">${ft.moveType || ""}</div>
      <div class="mini-status">${period || "기간 정보 없음"}</div>
    </div>
  `;
}

function statsRow(s) {
  return `
    <tr>
      <td>${s.season}</td>
      <td>${s.competition || "-"}</td>
      <td>${s.appearances ?? "-"}</td>
      <td>${s.goals ?? "-"}</td>
      <td>${s.assists ?? "-"}</td>
    </tr>
  `;
}

function renderPlayerDetail(data) {
  const { player, formerTeams, seasonStats } = data;
  const age = calcAge(player.dateBorn);

  el.content.innerHTML = `
    <div class="team-header-card player-header-card">
      ${playerAvatarImg(player, player.team || player.name, "player-header-photo")}
      <div class="team-header-name">${player.name}</div>
      <div class="team-header-venue">${[player.position, player.team].filter(Boolean).join(" · ")}</div>
      <div class="player-meta-row">
        ${player.nationality ? `<span>🌍 ${player.nationality}</span>` : ""}
        ${age !== null ? `<span>🎂 ${age}세</span>` : ""}
        ${player.height ? `<span>📏 ${player.height}</span>` : ""}
        ${player.number ? `<span>#${player.number}</span>` : ""}
      </div>
    </div>

    ${
      player.description
        ? `<div class="team-section"><h3 class="team-section-title">경력</h3><p class="player-description">${player.description}</p></div>`
        : ""
    }

    <div class="team-section">
      <h3 class="team-section-title">시즌별 스탯</h3>
      ${
        seasonStats.length
          ? `<div class="standings-table-wrap"><table class="standings-table player-stats-table">
              <thead><tr><th>시즌</th><th>대회</th><th>출전</th><th>득점</th><th>도움</th></tr></thead>
              <tbody>${seasonStats.map(statsRow).join("")}</tbody>
            </table></div>`
          : '<div class="empty-state">시즌별 스탯 정보가 없습니다.</div>'
      }
    </div>

    <div class="team-section">
      <h3 class="team-section-title">이적 히스토리</h3>
      ${
        formerTeams.length
          ? formerTeams.map(formerTeamRow).join("")
          : '<div class="empty-state">이적 히스토리 정보가 없습니다.</div>'
      }
    </div>

    <div class="player-data-note">데이터 제공: API-Football (최근 시즌 기준)</div>
  `;
}
