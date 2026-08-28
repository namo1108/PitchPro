import { fetchJSON } from "../api.js";
import { onTabChange, pushSubView, setLeagueStandingsOpener } from "../router.js";
import { crestImg, emblemImg, playerAvatarImg, fadeIn, skeletonList } from "../format.js";
import { goToTeam } from "./teamDetail.js";
import { goToPlayer } from "./playerDetail.js";
import { loadMatchDetail } from "./matches.js";
import { isFavorite } from "../favorites.js";

// 대회 27개를 한 줄짜리 긴 리스트로 두면 원하는 리그를 찾기 힘들어서, 지역/성격별로 묶어
// 트리(아코디언)로 접었다 펼치게 한다. 코드에 없는 대회는 자동으로 "기타"에 담긴다.
const LEAGUE_GROUPS = [
  { title: "국제대회", codes: ["WC", "EC", "CL", "ACL", "ACL2", "ACUP"] },
  // theme: 이 그룹을 펼치면 리그 탭 화면 전체에 그 리그 톤의 배경 연출을 입힌다(2026-08-28 사용자
  // 요청, K리그 공식 대진표 그래픽 참고 - 대각선 레드 스트라이프+스타버스트). 카드 하나가 아니라
  // 화면 전체 배경이라 style.css의 #view-leagues[data-theme] 규칙으로 처리한다(syncViewTheme 참고).
  { title: "국내(K리그)", codes: ["KL1", "KL2", "KFA", "K3", "K4"], theme: "kleague" },
  { title: "유럽 5대리그", codes: ["PL", "PD", "BL1", "SA", "FL1"] },
  { title: "유럽 기타", codes: ["DED", "PPL", "ELC", "NOR", "DEN", "SCO"] },
  { title: "아시아", codes: ["J1", "J2", "J3"] },
  { title: "아메리카·기타", codes: ["BSA", "MLS", "AUS", "KSA", "CHN"] },
];
const THEME_BY_TITLE = new Map(LEAGUE_GROUPS.filter((g) => g.theme).map((g) => [g.title, g.theme]));

// 첫 방문엔 국내(K리그) 그룹만 펼쳐두고 나머지는 접어서 시작한다.
const state = { competitions: [], openCode: null, pollTimer: null, query: "", openGroups: new Set(["국내(K리그)"]), loaded: false };

const el = {
  view: document.getElementById("view-leagues"),
  list: document.getElementById("league-list"),
  searchInput: document.getElementById("league-search-input"),
  teamResults: document.getElementById("league-team-results"),
  detailWrap: document.getElementById("league-detail-wrap"),
  detailHeader: document.getElementById("league-detail-header"),
  bracketWrap: document.getElementById("bracket-wrap"),
  standingsWrap: document.getElementById("standings-table-wrap"),
  topPlayersWrap: document.getElementById("top-players-wrap"),
  backBtn: document.getElementById("league-back-btn"),
};

// 이번 세션에 한 번 그려본 뒤로는(state.loaded) 탭을 다시 눌러도 스켈레톤으로 비우지 않고 화면에
// 남겨둔 채 조용히 새로 받아와서 갈아끼운다 - 매번 탭 전환마다 깜빡이며 로딩되는 느낌을 없앤다.
async function loadCompetitions() {
  if (!state.loaded) el.list.innerHTML = skeletonList(8);
  try {
    const data = await fetchJSON("/competitions");
    state.competitions = data.competitions || [];
    renderList(!state.loaded);
    state.loaded = true;
  } catch (err) {
    if (!state.loaded) el.list.innerHTML = `<div class="error-state">리그 목록을 불러오지 못했습니다.<br>${err.message}</div>`;
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

function renderList(animate = true) {
  const q = state.query.trim().toLowerCase();

  // 검색 중일 땐 그룹 구분 없이 매칭되는 대회만 평평한 목록으로 보여준다.
  if (q) {
    const filtered = state.competitions.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
    if (!filtered.length) {
      el.list.innerHTML = '<div class="empty-state">일치하는 리그가 없습니다.</div>';
      return;
    }
    el.list.innerHTML = filtered.map(leagueRowHtml).join("");
    if (animate) fadeIn(el.list);
    bindLeagueRows(el.list);
    return;
  }

  const byCode = new Map(state.competitions.map((c) => [c.code, c]));
  const grouped = LEAGUE_GROUPS.map((g) => ({
    title: g.title,
    theme: g.theme,
    items: g.codes.map((code) => byCode.get(code)).filter(Boolean),
  })).filter((g) => g.items.length);
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

  if (animate) fadeIn(el.list);
  bindLeagueRows(el.list);
  el.list.querySelectorAll("[data-group]").forEach((btn) => {
    btn.addEventListener("click", () => toggleGroup(btn.dataset.group, btn));
  });
  syncViewTheme();
}

// 테마가 있는 그룹(지금은 국내(K리그))이 펼쳐져 있는 동안만 리그 탭 화면 전체에 그 테마 배경을
// 입힌다 - 카드 하나가 아니라 화면 전체 연출이라 뷰 루트(#view-leagues)에 data-theme를 얹는다.
function syncViewTheme() {
  if (!el.view) return;
  const activeTheme = [...state.openGroups].map((title) => THEME_BY_TITLE.get(title)).find(Boolean);
  if (activeTheme) el.view.dataset.theme = activeTheme;
  else delete el.view.dataset.theme;
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
  syncViewTheme();
}

function bindLeagueRows(container) {
  container.querySelectorAll("[data-code]").forEach((row) => {
    row.addEventListener("click", () => openLeague(row.dataset.code));
  });
}

el.searchInput.addEventListener("input", () => {
  state.query = el.searchInput.value;
  renderList();
  queueTeamSearch(state.query.trim());
});

// ---------- 리그 검색창에 팀 검색도 같이 - 국가대표팀 포함 ----------
// 리그 이름과 겹치지 않는 팀 이름(예: 손흥민 소속팀을 몰라도 "토트넘", "대한민국")을 쳐도 바로 팀
// 상세로 넘어갈 수 있게, 같은 검색창에서 팀 검색(myTeam.js의 최애팀 검색과 동일한 API)도 같이 돈다.
let teamSearchTimer = null;
let teamSearchRequestId = 0;

function queueTeamSearch(q) {
  clearTimeout(teamSearchTimer);
  if (q.length < 1) {
    teamSearchRequestId++;
    el.teamResults.innerHTML = ""; // 비어있으면 style.css의 .team-search-results:empty가 자동으로 숨긴다.
    return;
  }
  const requestId = ++teamSearchRequestId;
  teamSearchTimer = setTimeout(async () => {
    try {
      const data = await fetchJSON(`/teams/search?q=${encodeURIComponent(q)}`);
      if (requestId !== teamSearchRequestId) return;
      renderTeamResults(data.teams || []);
    } catch {
      if (requestId === teamSearchRequestId) el.teamResults.innerHTML = "";
    }
  }, 300);
}

function renderTeamResults(teams) {
  if (!teams.length) {
    el.teamResults.innerHTML = "";
    return;
  }
  el.teamResults.innerHTML = teams
    .map(
      (t) => `
    <div class="team-search-row" data-team-id="${t.id}">
      ${crestImg(t, "team-search-crest")}
      <span class="team-search-name">${t.name}</span>
      <span class="team-search-comp">${t.competitionName}</span>
    </div>
  `
    )
    .join("");
  el.teamResults.querySelectorAll("[data-team-id]").forEach((row) => {
    row.addEventListener("click", () => {
      el.searchInput.value = "";
      state.query = "";
      el.teamResults.innerHTML = "";
      renderList();
      goToTeam(row.dataset.teamId);
    });
  });
}

// 목록으로 되돌리는 동작 - 뒤로가기 버튼 클릭과 하드웨어/제스처 뒤로가기 둘 다 결국 이 함수로
// 귀결되게 해서(history.back() -> popstate -> 이 콜백) 실제 기록과 화면이 항상 일치하게 한다.
function showLeagueList() {
  el.detailWrap.style.display = "none";
  el.list.style.display = "flex";
  el.searchInput.style.display = "block";
  state.openCode = null;
  stopStandingsPoll();
}

// 경기 탭의 대회 헤더를 눌러 리그 순위로 바로 넘어오는 진입점 - 리그 탭을 안 거쳐도(첫 방문이라
// state.competitions가 비어있어도) 목록을 먼저 채운 뒤 곧바로 해당 리그 상세를 연다.
async function goToLeagueStandings(code) {
  if (!state.loaded) await loadCompetitions();
  openLeague(code);
}
setLeagueStandingsOpener(goToLeagueStandings);

function openLeague(code) {
  const comp = state.competitions.find((c) => c.code === code);
  // 친선경기류(FRIENDLY/INTFRIENDLY/WCQAFC 등 hideFromLeagueTab)는 /api/competitions 응답 자체에서
  // 빠져있어 순위표 개념이 없다 - 경기 탭 헤더 클릭이 goToLeagueStandings로 아무 코드나 넘길 수
  // 있으니, 못 찾으면 그냥 조용히 무시한다(TypeError로 화면을 깨뜨리지 않음).
  if (!comp) return;
  el.detailHeader.innerHTML = `${emblemImg(comp, "league-detail-emblem")}<span>${comp.name}</span>`;
  el.list.style.display = "none";
  el.searchInput.style.display = "none";
  el.detailWrap.style.display = "block";
  state.openCode = code;
  pushSubView(showLeagueList);

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

// 실제 되돌리기는 pushSubView가 등록해둔 콜백(showLeagueList)이 popstate 시점에 처리한다 - 여기서
// 직접 DOM을 되돌리면 history 기록과 어긋나서 다음 뒤로가기 때 엉뚱한 곳으로 갈 수 있다.
el.backBtn.addEventListener("click", () => history.back());

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
    const comp = state.competitions.find((c) => c.code === code);
    renderTables(data.standings || [], opts.silent, comp);
  } catch (err) {
    if (!opts.silent) el.standingsWrap.innerHTML = `<div class="error-state">순위 정보를 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

// 승격/강등/대륙컵 진출 구간은 리그마다 규정이 달라서, config.js에 리그별로 명시해둔 값
// (promotionSpots/relegationSpots)이 있으면 그걸 쓰고, 없는 리그는 기존 근사 규칙(상위 4=진출권,
// 하위 3=강등권 - 유럽 5대리그 기준 근사치)을 그대로 쓴다.
function tableRowsHtml(table, comp) {
  const promotionSpots = comp?.promotionSpots;
  const relegationSpots = comp?.relegationSpots;
  return table.table
    .map((row) => {
      const isQualify = promotionSpots != null ? row.position <= promotionSpots : row.position <= 4;
      const isRelegate = relegationSpots != null ? row.position > table.table.length - relegationSpots : row.position > table.table.length - 3;
      const badgeClass = isQualify ? "qualify" : isRelegate ? "relegate" : "";
      const dotClass = row.live ? `live-dot result-${row.liveResult}` : "";
      const ptsClass = row.live ? `pts live-${row.liveResult}` : "pts";
      const mine = isFavorite(row.team.id);
      return `
        <tr class="${row.live ? "live-row" : ""}">
          <td><div class="pos-cell"><span class="pos-badge ${badgeClass}"></span>${row.position}</div></td>
          <td><div class="team-cell ${mine ? "mine" : ""}" data-team-id="${row.team.id}">${crestImg(row.team, "team-crest")}<span class="team-name-text">${row.team.shortName || row.team.name}</span>${mine ? '<span class="mine-star" title="나의 팀">★</span>' : ""}${row.live ? `<span class="${dotClass}" title="경기 진행 중(실시간 반영)"></span>` : ""}</div></td>
          <td class="num">${row.playedGames}</td>
          <td class="num">${row.won}</td>
          <td class="num">${row.draw}</td>
          <td class="num">${row.lost}</td>
          <td class="num">${row.goalsFor ?? "-"}</td>
          <td class="num">${row.goalsAgainst ?? "-"}</td>
          <td class="num">${row.goalDifference}</td>
          <td class="${ptsClass}">${row.points}</td>
        </tr>
      `;
    })
    .join("");
}

// 2026시즌 기준(K리그 하나로 승강제 개편안) 요약 - 리그마다 규정이 달라 표 위에 한 줄로 간단히
// 알려준다. 정확한 세부 조건(라이선스 보유 여부 등)은 생략하고 사용자가 궁금해할 핵심만 담는다.
const PROMOTION_RULE_NOTE = {
  KL2: "⬆ 1~2위 자동 승격, 3~6위는 승격 플레이오프로 K리그1 진출을 다퉈요.",
  K3: "⬆ 우승팀이 K리그2 클럽 라이선스를 보유하면 K리그2 최하위팀과 승강전을 치러요.",
  K4: "⬆ 우승 시 자동 승격, 2위는 K3리그 최하위팀과 승격 플레이오프를 치러요.",
};

// MLS처럼 리그가 컨퍼런스(조)로 나뉘어 있으면 표가 여러 개 온다 - 그룹명 소제목과 함께 각각 따로 그린다.
// 대부분의 리그는 그룹이 하나뿐이라 이 경우엔 기존과 동일하게 소제목 없이 표 하나만 보여준다.
function renderTables(tables, silent, comp) {
  const nonEmpty = tables.filter((t) => t.table?.length);
  if (!nonEmpty.length) {
    el.standingsWrap.innerHTML = '<div class="empty-state">순위 정보가 없습니다.</div>';
    return;
  }

  const showGroupTitle = nonEmpty.length > 1;
  const ruleNote = PROMOTION_RULE_NOTE[comp?.code];

  const tablesHtml = nonEmpty
    .map((table) => {
      const anyLive = table.table.some((row) => row.live);
      return `
        ${showGroupTitle ? `<div class="standings-group-title">${table.type}</div>` : ""}
        ${anyLive ? '<div class="live-standings-note">🟢 진행 중인 경기의 현재 스코어를 반영한 실시간 순위입니다.</div>' : ""}
        <table class="standings-table">
          <thead>
            <tr>
              <th>#</th><th>팀</th><th>경기</th><th>승</th><th>무</th><th>패</th><th>득점</th><th>실점</th><th>득실</th><th>승점</th>
            </tr>
          </thead>
          <tbody>${tableRowsHtml(table, comp)}</tbody>
        </table>
      `;
    })
    .join("");

  el.standingsWrap.innerHTML = (ruleNote ? `<div class="promotion-rule-note">${ruleNote}</div>` : "") + tablesHtml;

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

// 다른 탭으로 옮겼다가 돌아오면 항상 목록부터 보여준다 - 탭을 벗어날 때 router.js의 backStack이
// 초기화되면서 리그 상세로 돌아가는 뒤로가기 경로가 끊기는데, 상세 화면 자체(el.detailWrap)는
// DOM에 그대로 남아있어서 "리그 목록" 버튼을 눌러도 히스토리가 어긋나 엉뚱한 탭으로 튀는 버그가
// 있었다(사용자 제보, 2026-08-08). 탭 재진입 시점에 항상 목록으로 리셋해두면 이 어긋남 자체가 안 생긴다.
onTabChange("leagues", () => {
  showLeagueList();
  if (!state.competitions.length) loadCompetitions();
});
