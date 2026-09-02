import { fetchJSON } from "../api.js";
import { pushDetail } from "../router.js";
import { playerAvatarImg, fadeIn, skeletonList, escapeHtml } from "../format.js";
import { saveViewState } from "../viewState.js";

const el = {
  content: document.getElementById("player-detail-content"),
};

// hint(클릭한 요소에서 뽑아낸 선수 이름/사진, format.js의 playerHintFromElement 참고)가 있으면
// 실제 데이터가 오기 전까지 빈 스켈레톤만 보이지 않고 헤더를 먼저 그린다(teamDetail.js와 동일한
// 패턴 - "선수 누르면 바로바로 랜딩되면 좋겠다" 제보, 2026-09-02).
export function goToPlayer(playerId, hint) {
  pushDetail("player");
  saveViewState({ view: "player", playerId });
  loadPlayerDetail(playerId, hint);
}

function optimisticHeaderHtml(hint) {
  if (!hint?.name) return "";
  return `
    <div class="team-header-card player-header-card">
      ${hint.photo ? `<img class="player-header-photo" src="${escapeHtml(hint.photo)}" alt="" />` : ""}
      <div class="team-header-name">${escapeHtml(hint.name)}</div>
    </div>
  `;
}

async function loadPlayerDetail(playerId, hint) {
  el.content.innerHTML = optimisticHeaderHtml(hint) + skeletonList(5);
  try {
    const data = await fetchJSON(`/players/${playerId}`);
    renderPlayerDetail(data);
    fadeIn(el.content);
  } catch (err) {
    el.content.innerHTML = `<div class="error-state">선수 정보를 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

// dateBorn은 시각 없는 순수 날짜 문자열이라 new Date()로 파싱하면 UTC 자정 기준이 된다 -> 로컬(기기)
// 시간대 getter와 섞어 비교하면 기기 시간대에 따라 생일 근처에서 하루 오차가 생길 수 있어 getUTC*로 통일한다.
function calcAge(dateBorn) {
  if (!dateBorn) return null;
  const birth = new Date(dateBorn);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (
    now.getUTCMonth() < birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())
  ) {
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
