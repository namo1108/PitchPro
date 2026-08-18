import { fetchJSON } from "../api.js";
import { pushDetail } from "../router.js";
import {
  crestImg,
  playerAvatarImg,
  formatKickoff,
  formatMatchDateTime,
  STATUS_KO,
  LIVE_STATUSES,
  fadeIn,
  skeletonList,
  matchResultForTeam,
  resultClass,
  formBadgesHtml,
} from "../format.js";
import { isFavorite, toggleFavorite, MAX_FAVORITES } from "../favorites.js";
import { goToPlayer } from "./playerDetail.js";
import { loadMatchDetail } from "./matches.js";
import { saveViewState } from "../viewState.js";

const el = {
  content: document.getElementById("team-detail-content"),
};

export function goToTeam(teamId) {
  pushDetail("team");
  saveViewState({ view: "team", teamId });
  loadTeamDetail(teamId);
}

async function loadTeamDetail(teamId) {
  el.content.innerHTML = skeletonList(6);
  try {
    const data = await fetchJSON(`/teams/${teamId}`);
    renderTeamDetail(teamId, data);
    fadeIn(el.content);
  } catch (err) {
    el.content.innerHTML = `<div class="error-state">팀 정보를 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

function matchRow(m, perspectiveTeamId, isUpcoming) {
  const isLive = LIVE_STATUSES.has(m.status);
  const isFinished = m.status === "FINISHED";
  const home = m.score.fullTime.home;
  const away = m.score.fullTime.away;
  const hasScore = home !== null && home !== undefined;

  const statusText = isLive
    ? STATUS_KO[m.status]
    : isFinished
    ? "종료"
    : isUpcoming
    ? formatMatchDateTime(m.utcDate)
    : formatKickoff(m.utcDate);

  const result = isFinished ? matchResultForTeam(m, perspectiveTeamId) : null;

  return `
    <div class="mini-match-row ${resultClass(result)}" data-match-id="${m.id}">
      <div class="mini-status">${statusText}</div>
      <div class="mini-team ${m.homeTeam.id === perspectiveTeamId ? "highlight" : ""}">
        ${crestImg(m.homeTeam, "team-crest")}<span>${m.homeTeam.shortName || m.homeTeam.name}</span>
      </div>
      <div class="mini-score ${isLive ? "live" : ""}">${hasScore ? `${home}:${away}` : "vs"}</div>
      <div class="mini-team ${m.awayTeam.id === perspectiveTeamId ? "highlight" : ""}">
        ${crestImg(m.awayTeam, "team-crest")}<span>${m.awayTeam.shortName || m.awayTeam.name}</span>
      </div>
    </div>
  `;
}

const POSITION_ORDER = ["Goalkeeper", "Defender", "Midfielder", "Attacker"];
const POSITION_LABEL = {
  Goalkeeper: "골키퍼",
  Defender: "수비수",
  Midfielder: "미드필더",
  Attacker: "공격수",
};

function squadCard(p, teamId) {
  // manual-* id는 API-Football 선수 상세와 연결되지 않는 수동 명단(K3/K4)이라 클릭해도 갈 곳이 없다.
  const isManual = String(p.id).startsWith("manual-");
  const attr = isManual ? "" : `data-player-id="${p.id}"`;
  return `
    <div class="squad-card${isManual ? " squad-card--static" : ""}" ${attr}>
      ${playerAvatarImg(p, teamId, "squad-photo")}
      <div class="squad-name">${p.name}</div>
      <div class="squad-meta">${p.number ? `#${p.number}` : ""}${p.age ? ` · ${p.age}세` : ""}</div>
    </div>`;
}

function renderSquadTab(squad, coach, teamId) {
  const coachHtml = coach
    ? `
      <div class="coach-card">
        ${playerAvatarImg(coach, `${teamId}-coach`, "coach-photo")}
        <div class="coach-info">
          <div class="coach-label">감독</div>
          <div class="coach-name">${coach.name}${coach.age ? ` (${coach.age}세)` : ""}</div>
          ${coach.nationality ? `<div class="coach-nationality">${coach.nationality}</div>` : ""}
        </div>
      </div>`
    : "";

  if (!squad.length) {
    return `${coachHtml}<div class="empty-state">스쿼드 정보가 없습니다.</div>`;
  }

  const byPosition = new Map();
  squad.forEach((p) => {
    const key = POSITION_ORDER.includes(p.position) ? p.position : "Etc";
    if (!byPosition.has(key)) byPosition.set(key, []);
    byPosition.get(key).push(p);
  });

  const groupsHtml = [...POSITION_ORDER, "Etc"]
    .filter((key) => byPosition.has(key))
    .map((key) => {
      const players = byPosition.get(key);
      return `
        <div class="squad-position-group">
          <h4 class="squad-position-title">${POSITION_LABEL[key] || "기타"}</h4>
          <div class="squad-grid">${players.map((p) => squadCard(p, teamId)).join("")}</div>
        </div>`;
    })
    .join("");

  return `${coachHtml}${groupsHtml}`;
}

// K리그 팀만 venue(구장/티켓 정보)가 붙어 온다(kleagueVenues.js). 예매 링크는 새 탭으로 바로 열고,
// "가는 방법"은 브라우저 위치 정보로 사용자 현재 위치 -> 경기장 주소까지 길찾기 링크를 만든다
// (정확한 위경도 데이터가 없어 도착지는 주소 문자열로 넘기고 구글이 지오코딩하게 한다).
function renderVenueActions(venue) {
  if (!venue) return "";
  return `
    <div class="venue-actions">
      <a class="venue-action-btn" href="${venue.ticketUrl}" target="_blank" rel="noopener">🎟 예매하기</a>
      <button class="venue-action-btn" id="venue-directions-btn">📍 ${venue.stadium} 가는 길</button>
    </div>
  `;
}

function openDirections(venue) {
  const destination = encodeURIComponent(`${venue.stadium} ${venue.address}`);
  const withOrigin = (origin) => `https://www.google.com/maps/dir/?api=1${origin ? `&origin=${origin}` : ""}&destination=${destination}&travelmode=transit`;

  if (!navigator.geolocation) {
    window.open(withOrigin(null), "_blank");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => window.open(withOrigin(`${pos.coords.latitude},${pos.coords.longitude}`), "_blank"),
    () => window.open(withOrigin(null), "_blank"), // 위치 권한 거부/실패 시 목적지만이라도 열어준다
    { timeout: 5000 }
  );
}

function renderTeamInfoStrip(team) {
  const items = [];
  if (team.founded) items.push({ label: "창단", value: `${team.founded}년` });
  if (team.venueCity) items.push({ label: "연고지", value: team.venueCity });
  if (team.venueCapacity) items.push({ label: "수용인원", value: `${team.venueCapacity.toLocaleString()}명` });
  if (!items.length) return "";

  return `
    <div class="team-info-strip">
      ${items.map((it) => `<div class="team-info-item"><span class="team-info-label">${it.label}</span><span class="team-info-value">${it.value}</span></div>`).join("")}
    </div>
  `;
}

function renderTeamDetail(teamId, data) {
  const { team, recentMatches, upcomingMatches, squad, coach } = data;
  const favorite = isFavorite(teamId);

  el.content.innerHTML = `
    ${
      data.stale
        ? '<div class="stale-note">⚠ 데이터 제공처 응답 지연으로 최신 정보가 아닐 수 있습니다.</div>'
        : ""
    }
    <div class="team-header-card">
      ${crestImg(team, "team-header-crest")}
      <div class="team-header-name">${team.name}</div>
      ${team.venue ? `<div class="team-header-venue">${team.venue}</div>` : ""}
      <button class="favorite-btn ${favorite ? "active" : ""}" id="favorite-toggle">
        ${favorite ? "★ 즐겨찾기됨" : "☆ 즐겨찾기"}
      </button>
      ${renderTeamInfoStrip(team)}
      ${renderVenueActions(data.venue)}
    </div>

    <div class="team-tabs">
      <button class="team-tab-btn active" data-tab="schedule">일정</button>
      <button class="team-tab-btn" data-tab="squad">스쿼드</button>
    </div>

    <div class="team-tab-panel" data-panel="schedule">
      <div class="team-section">
        <h3 class="team-section-title">최근 경기</h3>
        ${formBadgesHtml(recentMatches, teamId, 5)}
        ${recentMatches.length ? recentMatches.map((m) => matchRow(m, teamId, false)).join("") : '<div class="empty-state">최근 경기 정보가 없습니다.</div>'}
      </div>

      <div class="team-section">
        <h3 class="team-section-title">경기 일정</h3>
        ${upcomingMatches.length ? upcomingMatches.map((m) => matchRow(m, teamId, true)).join("") : '<div class="empty-state">예정된 경기가 없습니다.</div>'}
      </div>
    </div>

    <div class="team-tab-panel" data-panel="squad" style="display: none;">
      <div class="team-section">
        <h3 class="team-section-title">스쿼드</h3>
        ${renderSquadTab(squad, coach, teamId)}
      </div>
    </div>
  `;

  if (data.venue) {
    document.getElementById("venue-directions-btn").addEventListener("click", () => openDirections(data.venue));
  }

  document.getElementById("favorite-toggle").addEventListener("click", (e) => {
    const { favorited, blocked } = toggleFavorite({ id: teamId, name: team.name, crest: team.crest, isNational: team.isNational });
    if (blocked === "national") {
      alert("국가대표팀은 '나의 팀'에 추가할 수 없어요.");
      return;
    }
    if (blocked === "limit") {
      alert(`'나의 팀'은 최대 ${MAX_FAVORITES}개까지만 등록할 수 있어요. 기존 팀을 먼저 빼주세요.`);
      return;
    }
    e.target.textContent = favorited ? "★ 즐겨찾기됨" : "☆ 즐겨찾기";
    e.target.classList.toggle("active", favorited);
  });

  el.content.querySelectorAll(".team-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      el.content.querySelectorAll(".team-tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      el.content.querySelectorAll(".team-tab-panel").forEach((panel) => {
        panel.style.display = panel.dataset.panel === btn.dataset.tab ? "block" : "none";
      });
    });
  });

  el.content.querySelectorAll("[data-player-id]").forEach((cardEl) => {
    cardEl.addEventListener("click", () => goToPlayer(cardEl.dataset.playerId));
  });

  el.content.querySelectorAll("[data-match-id]").forEach((rowEl) => {
    rowEl.style.cursor = "pointer";
    rowEl.addEventListener("click", () => loadMatchDetail(rowEl.dataset.matchId));
  });
}
