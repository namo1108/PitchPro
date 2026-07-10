import { fetchJSON } from "../api.js";
import { pushDetail } from "../router.js";
import { crestImg, formatKickoff, STATUS_KO, LIVE_STATUSES } from "../format.js";
import { isFavorite, toggleFavorite } from "../favorites.js";

const el = {
  content: document.getElementById("team-detail-content"),
};

export function goToTeam(teamId) {
  pushDetail("team");
  loadTeamDetail(teamId);
}

async function loadTeamDetail(teamId) {
  el.content.innerHTML = '<div class="loading">불러오는 중...</div>';
  try {
    const data = await fetchJSON(`/teams/${teamId}`);
    renderTeamDetail(teamId, data);
  } catch (err) {
    el.content.innerHTML = `<div class="error-state">팀 정보를 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

function matchRow(m, perspectiveTeamId) {
  const isLive = LIVE_STATUSES.has(m.status);
  const isFinished = m.status === "FINISHED";
  const home = m.score.fullTime.home;
  const away = m.score.fullTime.away;
  const hasScore = home !== null && home !== undefined;

  const statusText = isLive
    ? STATUS_KO[m.status]
    : isFinished
    ? "종료"
    : formatKickoff(m.utcDate);

  return `
    <div class="mini-match-row">
      <div class="mini-team ${m.homeTeam.id === perspectiveTeamId ? "highlight" : ""}">
        ${crestImg(m.homeTeam, "team-crest")}<span>${m.homeTeam.shortName || m.homeTeam.name}</span>
      </div>
      <div class="mini-score ${isLive ? "live" : ""}">${hasScore ? `${home}:${away}` : "vs"}</div>
      <div class="mini-team ${m.awayTeam.id === perspectiveTeamId ? "highlight" : ""}">
        ${crestImg(m.awayTeam, "team-crest")}<span>${m.awayTeam.shortName || m.awayTeam.name}</span>
      </div>
      <div class="mini-status">${statusText}</div>
    </div>
  `;
}

function renderTeamDetail(teamId, data) {
  const { team, recentMatches, upcomingMatches, squad } = data;
  const favorite = isFavorite(teamId);

  el.content.innerHTML = `
    <div class="team-header-card">
      ${crestImg(team, "team-header-crest")}
      <div class="team-header-name">${team.name}</div>
      ${team.venue ? `<div class="team-header-venue">${team.venue}</div>` : ""}
      <button class="favorite-btn ${favorite ? "active" : ""}" id="favorite-toggle">
        ${favorite ? "★ 즐겨찾기됨" : "☆ 즐겨찾기"}
      </button>
    </div>

    <div class="team-section">
      <h3 class="team-section-title">최근 경기</h3>
      ${recentMatches.length ? recentMatches.map((m) => matchRow(m, teamId)).join("") : '<div class="empty-state">최근 경기 정보가 없습니다.</div>'}
    </div>

    <div class="team-section">
      <h3 class="team-section-title">경기 일정</h3>
      ${upcomingMatches.length ? upcomingMatches.map((m) => matchRow(m, teamId)).join("") : '<div class="empty-state">예정된 경기가 없습니다.</div>'}
    </div>

    <div class="team-section">
      <h3 class="team-section-title">스쿼드</h3>
      ${
        squad.length
          ? `<div class="squad-grid">${squad
              .slice(0, 30)
              .map(
                (p) => `
                <div class="squad-card">
                  <div class="squad-name">${p.name}</div>
                  <div class="squad-meta">${p.position || ""}${p.nationality ? ` · ${p.nationality}` : ""}</div>
                </div>`
              )
              .join("")}</div>`
          : '<div class="empty-state">스쿼드 정보가 없습니다.</div>'
      }
    </div>
  `;

  document.getElementById("favorite-toggle").addEventListener("click", (e) => {
    const nowFavorite = toggleFavorite({ id: teamId, name: team.name, crest: team.crest });
    e.target.textContent = nowFavorite ? "★ 즐겨찾기됨" : "☆ 즐겨찾기";
    e.target.classList.toggle("active", nowFavorite);
  });
}
