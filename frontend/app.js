const API = "/api";

const state = {
  view: "matches",
  dayOffset: 0,
  competitions: [],
  activeStandingsCode: null,
};

const el = {
  tabs: document.querySelectorAll(".tab-btn"),
  views: {
    matches: document.getElementById("view-matches"),
    standings: document.getElementById("view-standings"),
    detail: document.getElementById("view-detail"),
  },
  matchesList: document.getElementById("matches-list"),
  dateLabel: document.getElementById("current-date-label"),
  prevDay: document.getElementById("prev-day"),
  nextDay: document.getElementById("next-day"),
  refreshBtn: document.getElementById("refresh-btn"),
  competitionPicker: document.getElementById("competition-picker"),
  standingsWrap: document.getElementById("standings-table-wrap"),
  backBtn: document.getElementById("back-btn"),
  matchDetailContent: document.getElementById("match-detail-content"),
};

const STATUS_KO = {
  SCHEDULED: "예정",
  TIMED: "예정",
  IN_PLAY: "LIVE",
  PAUSED: "HT",
  FINISHED: "종료",
  POSTPONED: "연기",
  SUSPENDED: "중단",
  CANCELLED: "취소",
};

const LIVE_STATUSES = new Set(["IN_PLAY", "PAUSED"]);

async function fetchJSON(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || "요청 실패");
  }
  return data;
}

function dateWithOffset(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
}

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

function formatDateLabel(offset) {
  if (offset === 0) return "오늘";
  if (offset === -1) return "어제";
  if (offset === 1) return "내일";
  const d = dateWithOffset(offset);
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekday})`;
}

function formatKickoff(utcDate) {
  const d = new Date(utcDate);
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function crestImg(team, size) {
  const src = team.crest || "";
  const fallback = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ctext y='18' font-size='18'%3E%E2%9A%BD%3C/text%3E%3C/svg%3E";
  return `<img class="${size}" src="${src || fallback}" onerror="this.src='${fallback}'" alt="${team.shortName || team.name || ""}" />`;
}

/* ---------------- Tabs / Views ---------------- */

function showView(name) {
  state.view = name;
  Object.entries(el.views).forEach(([key, node]) => {
    node.classList.toggle("active", key === name);
  });
  el.tabs.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });
}

el.tabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    showView(btn.dataset.view);
    if (btn.dataset.view === "standings" && !state.competitions.length) {
      loadCompetitions();
    }
  });
});

el.backBtn.addEventListener("click", () => showView("matches"));

/* ---------------- Matches ---------------- */

async function loadMatches() {
  el.dateLabel.textContent = formatDateLabel(state.dayOffset);
  el.matchesList.innerHTML = '<div class="loading">경기 정보를 불러오는 중...</div>';
  try {
    const iso = toISODate(dateWithOffset(state.dayOffset));
    const data = await fetchJSON(`${API}/matches?date=${iso}`);
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
    if (!groups.has(key)) {
      groups.set(key, { info: m.competition, matches: [] });
    }
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
    <div class="team home">
      ${crestImg(m.homeTeam, "team-crest")}
      <span class="team-name">${m.homeTeam.shortName || m.homeTeam.name}</span>
    </div>
    ${scoreHtml}
    <div class="team away">
      ${crestImg(m.awayTeam, "team-crest")}
      <span class="team-name">${m.awayTeam.shortName || m.awayTeam.name}</span>
    </div>
  `;

  row.addEventListener("click", () => loadMatchDetail(m.id));
  return row;
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

/* ---------------- Standings ---------------- */

async function loadCompetitions() {
  try {
    const data = await fetchJSON(`${API}/competitions`);
    state.competitions = data.competitions || [];
    renderCompetitionPicker();
    if (state.competitions.length) {
      loadStandings(state.competitions[0].code);
    }
  } catch (err) {
    el.competitionPicker.innerHTML = "";
    el.standingsWrap.innerHTML = `<div class="error-state">리그 목록을 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

function renderCompetitionPicker() {
  el.competitionPicker.innerHTML = "";
  state.competitions.forEach((c) => {
    const chip = document.createElement("button");
    chip.className = "comp-chip";
    chip.textContent = `${c.emblem} ${c.name}`;
    chip.dataset.code = c.code;
    chip.addEventListener("click", () => loadStandings(c.code));
    el.competitionPicker.appendChild(chip);
  });
}

function setActiveChip(code) {
  el.competitionPicker.querySelectorAll(".comp-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.code === code);
  });
}

async function loadStandings(code) {
  state.activeStandingsCode = code;
  setActiveChip(code);
  el.standingsWrap.innerHTML = '<div class="loading">순위를 불러오는 중...</div>';
  try {
    const data = await fetchJSON(`${API}/standings/${code}`);
    const totalTable = (data.standings || []).find((s) => s.type === "TOTAL") || data.standings?.[0];
    renderStandingsTable(totalTable);
  } catch (err) {
    el.standingsWrap.innerHTML = `<div class="error-state">순위 정보를 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

function renderStandingsTable(table) {
  if (!table || !table.table?.length) {
    el.standingsWrap.innerHTML = '<div class="empty-state">순위 정보가 없습니다.</div>';
    return;
  }

  const rows = table.table
    .map((row) => {
      const isQualify = row.position <= 4;
      const isRelegate = row.position > table.table.length - 3;
      const badgeClass = isQualify ? "qualify" : isRelegate ? "relegate" : "";
      return `
        <tr>
          <td><div class="pos-cell"><span class="pos-badge ${badgeClass}"></span>${row.position}</div></td>
          <td><div class="team-cell">${crestImg(row.team, "team-crest")}${row.team.shortName || row.team.name}</div></td>
          <td class="num">${row.playedGames}</td>
          <td class="num">${row.won}</td>
          <td class="num">${row.draw}</td>
          <td class="num">${row.lost}</td>
          <td class="num">${row.goalDifference}</td>
          <td class="pts">${row.points}</td>
        </tr>
      `;
    })
    .join("");

  el.standingsWrap.innerHTML = `
    <table class="standings-table">
      <thead>
        <tr>
          <th>#</th>
          <th>팀</th>
          <th>경기</th>
          <th>승</th>
          <th>무</th>
          <th>패</th>
          <th>득실</th>
          <th>승점</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

/* ---------------- Match detail ---------------- */

async function loadMatchDetail(matchId) {
  showView("detail");
  el.matchDetailContent.innerHTML = '<div class="loading">불러오는 중...</div>';
  try {
    const data = await fetchJSON(`${API}/matches/${matchId}`);
    renderMatchDetail(data.match || data);
  } catch (err) {
    el.matchDetailContent.innerHTML = `<div class="error-state">경기 상세 정보를 불러오지 못했습니다.<br>${err.message}</div>`;
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

  el.matchDetailContent.innerHTML = `
    <div class="scoreboard-card">
      <div class="scoreboard-competition">${m.competition?.name || ""} · ${m.matchday ? `Matchday ${m.matchday}` : ""}</div>
      <div class="scoreboard-teams">
        <div class="scoreboard-team">
          ${crestImg(m.homeTeam, "scoreboard-crest")}
          <div class="scoreboard-team-name">${m.homeTeam.name}</div>
        </div>
        <div class="scoreboard-score">${hasScore ? `${home} : ${away}` : "vs"}</div>
        <div class="scoreboard-team">
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
}

/* ---------------- Init ---------------- */

loadMatches();
