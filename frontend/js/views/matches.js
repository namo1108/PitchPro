import { fetchJSON } from "../api.js";
import { pushDetail, onTabChange } from "../router.js";
import { STATUS_KO, LIVE_STATUSES, crestImg, formatKickoff, dateWithOffset, toISODate, formatDateLabel } from "../format.js";
import { goToTeam } from "./teamDetail.js";

const state = { dayOffset: 0 };

const el = {
  matchesList: document.getElementById("matches-list"),
  dateLabel: document.getElementById("current-date-label"),
  prevDay: document.getElementById("prev-day"),
  nextDay: document.getElementById("next-day"),
  refreshBtn: document.getElementById("refresh-btn"),
  detailContent: document.getElementById("match-detail-content"),
};

export async function loadMatches() {
  el.dateLabel.textContent = formatDateLabel(state.dayOffset);
  el.matchesList.innerHTML = '<div class="loading">경기 정보를 불러오는 중...</div>';
  try {
    const iso = toISODate(dateWithOffset(state.dayOffset));
    const data = await fetchJSON(`/matches?date=${iso}`);
    renderMatches(data.matches || []);
  } catch (err) {
    el.matchesList.innerHTML = `<div class="error-state">경기 정보를 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

function renderMatches(matches) {
  if (!matches.length) {
    el.matchesList.innerHTML = '<div class="empty-state">해당 날짜에 예정된 경기가 없습니다.</div>';
    return;
  }

  const groups = new Map();
  matches.forEach((m) => {
    const key = m.competition.code || m.competition.name;
    if (!groups.has(key)) groups.set(key, { info: m.competition, matches: [] });
    groups.get(key).matches.push(m);
  });

  el.matchesList.innerHTML = "";
  groups.forEach((group) => {
    const groupEl = document.createElement("div");
    groupEl.className = "competition-group";

    const header = document.createElement("div");
    header.className = "competition-header";
    header.innerHTML = `<span class="competition-emblem">🏆</span> ${group.info.name}`;
    groupEl.appendChild(header);

    group.matches
      .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
      .forEach((m) => groupEl.appendChild(renderMatchRow(m)));

    el.matchesList.appendChild(groupEl);
  });
}

function renderMatchRow(m) {
  const row = document.createElement("div");
  row.className = "match-row";

  const isLive = LIVE_STATUSES.has(m.status);
  const isFinished = m.status === "FINISHED";
  const home = m.score.fullTime.home;
  const away = m.score.fullTime.away;
  const hasScore = home !== null && home !== undefined;

  let statusHtml;
  if (isLive) {
    statusHtml = `<div class="match-status live"><span class="live-dot"></span>${STATUS_KO[m.status]}</div>`;
  } else if (isFinished) {
    statusHtml = `<div class="match-status finished">종료</div>`;
  } else if (["POSTPONED", "SUSPENDED", "CANCELLED"].includes(m.status)) {
    statusHtml = `<div class="match-status finished">${STATUS_KO[m.status]}</div>`;
  } else {
    statusHtml = `<div class="match-status scheduled">${formatKickoff(m.utcDate)}</div>`;
  }

  const scoreHtml = hasScore
    ? `<div class="score-box ${isLive ? "live-score" : ""}">${home}<span class="score-dash">:</span>${away}</div>`
    : `<div class="score-box">vs</div>`;

  row.innerHTML = `
    ${statusHtml}
    <div class="team home" data-team-id="${m.homeTeam.id}">
      ${crestImg(m.homeTeam, "team-crest")}
      <span class="team-name">${m.homeTeam.shortName || m.homeTeam.name}</span>
    </div>
    ${scoreHtml}
    <div class="team away" data-team-id="${m.awayTeam.id}">
      ${crestImg(m.awayTeam, "team-crest")}
      <span class="team-name">${m.awayTeam.shortName || m.awayTeam.name}</span>
    </div>
  `;

  row.querySelectorAll("[data-team-id]").forEach((teamEl) => {
    teamEl.addEventListener("click", (e) => {
      e.stopPropagation();
      goToTeam(teamEl.dataset.teamId);
    });
  });

  row.addEventListener("click", () => loadMatchDetail(m.id));
  return row;
}

async function loadMatchDetail(matchId) {
  pushDetail("detail");
  el.detailContent.innerHTML = '<div class="loading">불러오는 중...</div>';
  try {
    const data = await fetchJSON(`/matches/${matchId}`);
    renderMatchDetail(data.match || data);
  } catch (err) {
    el.detailContent.innerHTML = `<div class="error-state">경기 상세 정보를 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

function renderMatchDetail(m) {
  const isLive = LIVE_STATUSES.has(m.status);
  const isFinished = m.status === "FINISHED";
  const home = m.score.fullTime.home;
  const away = m.score.fullTime.away;
  const hasScore = home !== null && home !== undefined;

  const statusClass = isLive ? "live" : isFinished ? "finished" : "";
  const statusText = isLive
    ? `🔴 ${STATUS_KO[m.status]}`
    : isFinished
    ? "경기 종료"
    : `${new Date(m.utcDate).toLocaleString("ko-KR")} 예정`;

  const ht = m.score.halfTime;
  const htHtml =
    ht && ht.home !== null && ht.home !== undefined
      ? `<div class="detail-halftime">전반전 ${ht.home} : ${ht.away}</div>`
      : "";

  el.detailContent.innerHTML = `
    <div class="scoreboard-card">
      <div class="scoreboard-competition">${m.competition?.name || ""} · ${m.matchday ? `Matchday ${m.matchday}` : ""}</div>
      <div class="scoreboard-teams">
        <div class="scoreboard-team" data-team-id="${m.homeTeam.id}">
          ${crestImg(m.homeTeam, "scoreboard-crest")}
          <div class="scoreboard-team-name">${m.homeTeam.name}</div>
        </div>
        <div class="scoreboard-score">${hasScore ? `${home} : ${away}` : "vs"}</div>
        <div class="scoreboard-team" data-team-id="${m.awayTeam.id}">
          ${crestImg(m.awayTeam, "scoreboard-crest")}
          <div class="scoreboard-team-name">${m.awayTeam.name}</div>
        </div>
      </div>
      <div class="scoreboard-status ${statusClass}">${statusText}</div>
      ${htHtml}
    </div>
    <div class="detail-info-grid">
      <div class="detail-info-item">
        <div class="detail-info-label">경기장</div>
        <div class="detail-info-value">${m.venue || "정보 없음"}</div>
      </div>
      <div class="detail-info-item">
        <div class="detail-info-label">대회</div>
        <div class="detail-info-value">${m.competition?.name || "-"}</div>
      </div>
      <div class="detail-info-item">
        <div class="detail-info-label">심판</div>
        <div class="detail-info-value">${(m.referees || []).map((r) => r.name).join(", ") || "정보 없음"}</div>
      </div>
    </div>
  `;

  el.detailContent.querySelectorAll("[data-team-id]").forEach((teamEl) => {
    teamEl.style.cursor = "pointer";
    teamEl.addEventListener("click", () => goToTeam(teamEl.dataset.teamId));
  });
}

el.prevDay.addEventListener("click", () => {
  state.dayOffset -= 1;
  loadMatches();
});
el.nextDay.addEventListener("click", () => {
  state.dayOffset += 1;
  loadMatches();
});
el.refreshBtn.addEventListener("click", () => {
  el.refreshBtn.classList.add("spinning");
  loadMatches().finally(() => {
    setTimeout(() => el.refreshBtn.classList.remove("spinning"), 600);
  });
});

onTabChange("matches", loadMatches);
