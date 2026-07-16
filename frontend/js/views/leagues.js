import { fetchJSON } from "../api.js";
import { onTabChange } from "../router.js";
import { crestImg, emblemImg, playerAvatarImg, fadeIn, skeletonList } from "../format.js";
import { goToTeam } from "./teamDetail.js";
import { goToPlayer } from "./playerDetail.js";
import { loadMatchDetail } from "./matches.js";

// 대회 27개를 한 줄짜리 긴 리스트로 두면 원하는 리그를 찾기 힘들어서, 지역/성격별로 묶어
// 트리(아코디언)로 접었다 펼치게 한다. 코드에 없는 대회는 자동으로 "기타"에 담긴다.
const LEAGUE_GROUPS = [
  { title: "국제대회", codes: ["WC", "EC", "CL"] },
  { title: "국내(K리그)", codes: ["KL1", "KL2", "KFA", "K3", "K4"] },
  { title: "유럽 5대리그", codes: ["PL", "PD", "BL1", "SA", "FL1"] },
  { title: "유럽 기타", codes: ["DED", "PPL", "ELC", "NOR", "DEN", "SCO"] },
  { title: "아시아", codes: ["J1", "J2", "J3"] },
  { title: "아메리카·기타", codes: ["BSA", "MLS", "AUS", "KSA", "CHN"] },
];

// 첫 방문엔 국내(K리그) 그룹만 펼쳐두고 나머지는 접어서 시작한다.
const state = { competitions: [], openCode: null, pollTimer: null, query: "", openGroups: new Set(["국내(K리그)"]) };

const el = {
  list: document.getElementById("league-list"),
  searchInput: document.getElementById("league-search-input"),
  detailWrap: document.getElementById("league-detail-wrap"),
  detailHeader: document.getElementById("league-detail-header"),
  bracketWrap: document.getElementById("bracket-wrap"),
  standingsWrap: document.getElementById("standings-table-wrap"),
  topPlayersWrap: document.getElementById("top-players-wrap"),
  backBtn: document.getElementById("league-back-btn"),
};

async function loadCompetitions() {
  el.list.innerHTML = skeletonList(8);
  try {
    const data = await fetchJSON("/competitions");
    state.competitions = data.competitions || [];
    renderList();
  } catch (err) {
    el.list.innerHTML = `<div class="error-state">리그 목록을 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

function leagueRowHtml(c) {
  return `
    <div class="league-row" data-code="${c.code}">
      ${emblemImg(c, "league-row-emblem")}
      <span class="league-row-name">${c.name}</span>
      <span class="league-row-arrow">›</span>
    </div>
  `;
}

function renderList() {
  const q = state.query.trim().toLowerCase();

  // 검색 중일 땐 그룹 구분 없이 매칭되는 대회만 평평한 목록으로 보여준다.
  if (q) {
    const filtered = state.competitions.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
    if (!filtered.length) {
      el.list.innerHTML = '<div class="empty-state">일치하는 리그가 없습니다.</div>';
      return;
    }
    el.list.innerHTML = filtered.map(leagueRowHtml).join("");
    fadeIn(el.list);
    bindLeagueRows(el.list);
    return;
  }

  const byCode = new Map(state.competitions.map((c) => [c.code, c]));
  const grouped = LEAGUE_GROUPS.map((g) => ({ title: g.title, items: g.codes.map((code) => byCode.get(code)).filter(Boolean) })).filter(
    (g) => g.items.length
  );
  const groupedCodes = new Set(LEAGUE_GROUPS.flatMap((g) => g.codes));
  const others = state.competitions.filter((c) => !groupedCodes.has(c.code));
  if (others.length) grouped.push({ title: "기타", items: others });

  if (!grouped.length) {
    el.list.innerHTML = '<div class="empty-state">리그 목록을 불러오지 못했습니다.</div>';
    return;
  }

  el.list.innerHTML = grouped
    .map((g) => {
      const isOpen = state.openGroups.has(g.title);
      return `
      <div class="league-group">
        <button class="league-group-toggle ${isOpen ? "open" : ""}" data-group="${g.title}">
          <span class="league-group-toggle-name">${g.title}</span>
          <span class="league-group-count">${g.items.length}</span>
          <span class="league-group-toggle-arrow">▾</span>
        </button>
        <div class="league-group-body" data-group-body="${g.title}" style="display: ${isOpen ? "flex" : "none"};">
          ${g.items.map(leagueRowHtml).join("")}
        </div>
      </div>
    `;
    })
    .join("");

  fadeIn(el.list);
  bindLeagueRows(el.list);
  el.list.querySelectorAll("[data-group]").forEach((btn) => {
    btn.addEventListener("click", () => toggleGroup(btn.dataset.group, btn));
  });
}

function toggleGroup(title, btn) {
  const body = el.list.querySelector(`[data-group-body="${title}"]`);
  const isOpen = state.openGroups.has(title);
  if (isOpen) {
    state.openGroups.delete(title);
    body.style.display = "none";
    btn.classList.remove("open");
  } else {
    state.openGroups.add(title);
    body.style.display = "flex";
    btn.classList.add("open");
  }
}

function bindLeagueRows(container) {
  container.querySelectorAll("[data-code]").forEach((row) => {
    row.addEventListener("click", () => openLeague(row.dataset.code));
  });
}

el.searchInput.addEventListener("input", () => {
  state.query = el.searchInput.value;
  renderList();
});

function openLeague(code) {
  const comp = state.competitions.find((c) => c.code === code);
  el.detailHeader.innerHTML = `${emblemImg(comp, "league-detail-emblem")}<span>${comp.name}</span>`;
  el.list.style.display = "none";
  el.searchInput.style.display = "none";
  el.detailWrap.style.display = "block";
  state.openCode = code;

  if (comp.hasBracket) {
    el.bracketWrap.style.display = "block";
    el.standingsWrap.style.display = "none";
    loadBracket(code);
  } else {
    el.bracketWrap.style.display = "none";
    el.standingsWrap.style.display = "block";
    loadStandings(code);
    startStandingsPoll();
  }
  loadTopPlayers(code);
}

async function loadBracket(code) {
  el.bracketWrap.innerHTML = skeletonList(4);
  try {
    const data = await fetchJSON(`/leagues/${code}/bracket`);
    renderBracket(data.rounds || []);
  } catch (err) {
    el.bracketWrap.innerHTML = `<div class="error-state">대진표를 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

function bracketMatchCard(m) {
  const home = m.score.fullTime.home;
  const away = m.score.fullTime.away;
  const hasScore = home !== null && home !== undefined;
  const isLive = m.status === "IN_PLAY" || m.status === "PAUSED";
  return `
    <div class="bracket-match" data-match-id="${m.id}">
      <div class="bracket-team ${hasScore && home > away ? "winner" : ""}">
        ${crestImg(m.homeTeam, "team-crest")}<span>${m.homeTeam.shortName || m.homeTeam.name}</span>
        <span class="bracket-score ${isLive ? "live" : ""}">${hasScore ? home : ""}</span>
      </div>
      <div class="bracket-team ${hasScore && away > home ? "winner" : ""}">
        ${crestImg(m.awayTeam, "team-crest")}<span>${m.awayTeam.shortName || m.awayTeam.name}</span>
        <span class="bracket-score ${isLive ? "live" : ""}">${hasScore ? away : ""}</span>
      </div>
    </div>
  `;
}

function renderBracket(rounds) {
  if (!rounds.length) {
    el.bracketWrap.innerHTML = '<div class="empty-state">대진표 정보가 없습니다.</div>';
    return;
  }

  el.bracketWrap.innerHTML = `
    <div class="bracket-scroll">
      ${rounds
        .map(
          (r) => `
        <div class="bracket-column">
          <div class="bracket-round-title">${r.round}</div>
          ${r.matches.map(bracketMatchCard).join("")}
        </div>
      `
        )
        .join("")}
    </div>
  `;

  fadeIn(el.bracketWrap);
  el.bracketWrap.querySelectorAll("[data-match-id]").forEach((cardEl) => {
    cardEl.addEventListener("click", () => loadMatchDetail(cardEl.dataset.matchId));
  });
}

el.backBtn.addEventListener("click", () => {
  el.detailWrap.style.display = "none";
  el.list.style.display = "flex";
  el.searchInput.style.display = "block";
  state.openCode = null;
  stopStandingsPoll();
});

function startStandingsPoll() {
  stopStandingsPoll();
  state.pollTimer = setInterval(() => {
    if (!state.openCode) return;
    if (document.visibilityState !== "visible") return;
    if (!document.getElementById("view-leagues")?.classList.contains("active")) return;
    loadStandings(state.openCode, { silent: true });
  }, 20000);
}

function stopStandingsPoll() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

async function loadStandings(code, opts = {}) {
  if (!opts.silent) el.standingsWrap.innerHTML = skeletonList(6);
  try {
    const data = await fetchJSON(`/standings/${code}`);
    renderTables(data.standings || [], opts.silent);
  } catch (err) {
    if (!opts.silent) el.standingsWrap.innerHTML = `<div class="error-state">순위 정보를 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

function tableRowsHtml(table) {
  return table.table
    .map((row) => {
      const isQualify = row.position <= 4;
      const isRelegate = row.position > table.table.length - 3;
      const badgeClass = isQualify ? "qualify" : isRelegate ? "relegate" : "";
      const dotClass = row.live ? `live-dot result-${row.liveResult}` : "";
      const ptsClass = row.live ? `pts live-${row.liveResult}` : "pts";
      return `
        <tr class="${row.live ? "live-row" : ""}">
          <td><div class="pos-cell"><span class="pos-badge ${badgeClass}"></span>${row.position}</div></td>
          <td><div class="team-cell" data-team-id="${row.team.id}">${crestImg(row.team, "team-crest")}${row.team.shortName || row.team.name}${row.live ? `<span class="${dotClass}" title="경기 진행 중(실시간 반영)"></span>` : ""}</div></td>
          <td class="num">${row.playedGames}</td>
          <td class="num">${row.won}</td>
          <td class="num">${row.draw}</td>
          <td class="num">${row.lost}</td>
          <td class="num">${row.goalDifference}</td>
          <td class="${ptsClass}">${row.points}</td>
        </tr>
      `;
    })
    .join("");
}

// MLS처럼 리그가 컨퍼런스(조)로 나뉘어 있으면 표가 여러 개 온다 - 그룹명 소제목과 함께 각각 따로 그린다.
// 대부분의 리그는 그룹이 하나뿐이라 이 경우엔 기존과 동일하게 소제목 없이 표 하나만 보여준다.
function renderTables(tables, silent) {
  const nonEmpty = tables.filter((t) => t.table?.length);
  if (!nonEmpty.length) {
    el.standingsWrap.innerHTML = '<div class="empty-state">순위 정보가 없습니다.</div>';
    return;
  }

  const showGroupTitle = nonEmpty.length > 1;

  el.standingsWrap.innerHTML = nonEmpty
    .map((table) => {
      const anyLive = table.table.some((row) => row.live);
      return `
        ${showGroupTitle ? `<div class="standings-group-title">${table.type}</div>` : ""}
        ${anyLive ? '<div class="live-standings-note">🟢 진행 중인 경기의 현재 스코어를 반영한 실시간 순위입니다.</div>' : ""}
        <table class="standings-table">
          <thead>
            <tr>
              <th>#</th><th>팀</th><th>경기</th><th>승</th><th>무</th><th>패</th><th>득실</th><th>승점</th>
            </tr>
          </thead>
          <tbody>${tableRowsHtml(table)}</tbody>
        </table>
      `;
    })
    .join("");

  if (!silent) fadeIn(el.standingsWrap);
  el.standingsWrap.querySelectorAll("[data-team-id]").forEach((cell) => {
    cell.addEventListener("click", () => goToTeam(cell.dataset.teamId));
  });
}

async function loadTopPlayers(code) {
  el.topPlayersWrap.innerHTML = '<div class="loading">선수 순위를 불러오는 중...</div>';
  try {
    const data = await fetchJSON(`/leagues/${code}/top-players`);
    renderTopPlayers(data);
  } catch {
    // 무료 시즌 밖 대회 등 데이터가 없을 수 있음 -> 조용히 비워둔다
    el.topPlayersWrap.innerHTML = "";
  }
}

function topPlayerRow(p) {
  return `
    <div class="top-player-row" ${p.id ? `data-player-id="${p.id}"` : ""}>
      ${playerAvatarImg({ ...p, photo: p.photo }, p.team || p.name, "top-player-photo")}
      <div class="top-player-info">
        <div class="top-player-name">${p.name}</div>
        <div class="top-player-team">
          ${p.teamCrest ? `<img class="team-crest-tiny" src="${p.teamCrest}" alt="" />` : ""}${p.team || ""}
        </div>
      </div>
      <div class="top-player-value">${p.value}</div>
    </div>
  `;
}

function renderTopPlayers(data) {
  const scorers = data.topScorers || [];
  const assists = data.topAssists || [];

  if (!scorers.length && !assists.length) {
    el.topPlayersWrap.innerHTML = "";
    return;
  }

  el.topPlayersWrap.innerHTML = `
    <div class="team-section">
      <h3 class="team-section-title">득점왕</h3>
      ${scorers.length ? scorers.map(topPlayerRow).join("") : '<div class="empty-state">득점왕 정보가 없습니다.</div>'}
    </div>
    <div class="team-section">
      <h3 class="team-section-title">도움왕</h3>
      ${assists.length ? assists.map(topPlayerRow).join("") : '<div class="empty-state">도움왕 정보가 없습니다.</div>'}
    </div>
  `;

  el.topPlayersWrap.querySelectorAll("[data-player-id]").forEach((row) => {
    row.addEventListener("click", () => goToPlayer(row.dataset.playerId));
  });
}

onTabChange("leagues", () => {
  if (!state.competitions.length) loadCompetitions();
});
