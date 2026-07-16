import { fetchJSON } from "../api.js";
import { onTabChange } from "../router.js";
import { emblemImg, crestImg, transferAvatarImg, fadeIn, skeletonList, KST_TIME_ZONE } from "../format.js";
import { goToPlayer } from "./playerDetail.js";

const state = { leagues: [], loaded: false };

const el = {
  list: document.getElementById("transfers-list"),
  detailWrap: document.getElementById("transfers-detail-wrap"),
  detailHeader: document.getElementById("transfers-detail-header"),
  teamsWrap: document.getElementById("transfers-teams-wrap"),
  backBtn: document.getElementById("transfers-back-btn"),
};

function formatTransferDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("ko-KR", { timeZone: KST_TIME_ZONE, month: "long", day: "numeric" });
}

function feeLabel(moveType) {
  if (!moveType) return "";
  if (/free/i.test(moveType)) return "자유계약";
  if (/loan/i.test(moveType)) return "임대";
  if (/n\/?a/i.test(moveType)) return "";
  return moveType;
}

async function loadTransfers() {
  el.list.innerHTML = skeletonList(8);
  try {
    const data = await fetchJSON("/transfers");
    state.leagues = data.leagues || [];
    renderLeagueList();
    state.loaded = true;
  } catch (err) {
    el.list.innerHTML = `<div class="error-state">이적 소식을 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

// 리그를 통째로 하나의 긴 목록으로 다 그리면(수백 건) 렉이 걸려서, 리그 목록 -> 리그별 팀 아코디언
// 순으로 화면을 나눠 한 번에 그리는 양을 크게 줄인다(리그 화면(leagues.js)과 같은 구조).
function renderLeagueList() {
  if (!state.leagues.length) {
    el.list.innerHTML = '<div class="empty-state">최근 이적 소식이 아직 없습니다.</div>';
    return;
  }

  el.list.innerHTML = state.leagues
    .map(
      (l) => `
      <div class="league-row" data-code="${l.code}">
        ${emblemImg(l, "league-row-emblem")}
        <span class="league-row-name">${l.name}</span>
        <span class="transfer-count-badge">${l.totalItems}건</span>
        <span class="league-row-arrow">›</span>
      </div>
    `
    )
    .join("");

  fadeIn(el.list);
  el.list.querySelectorAll("[data-code]").forEach((row) => {
    row.addEventListener("click", () => openLeague(row.dataset.code));
  });
}

function openLeague(code) {
  const league = state.leagues.find((l) => l.code === code);
  if (!league) return;

  el.detailHeader.innerHTML = `${emblemImg(league, "league-detail-emblem")}<span>${league.name}</span>`;
  el.list.style.display = "none";
  el.detailWrap.style.display = "block";
  renderTeams(league.teams);
}

el.backBtn.addEventListener("click", () => {
  el.detailWrap.style.display = "none";
  el.list.style.display = "flex";
});

// 팀 목록만 먼저 그리고, 각 팀의 실제 이적 내역은 눌러서 펼칠 때 그때 그려서(+사진도 그때 불러옴)
// 리그 하나에 팀이 많아도(K리그 제외 대부분 15~20개) 초기 렌더링 부담이 없게 한다.
function renderTeams(teams) {
  el.teamsWrap.innerHTML = teams
    .map(
      (team, i) => `
      <div class="transfer-team-group">
        <button class="transfer-team-toggle" data-team-idx="${i}">
          <span class="transfer-team-toggle-name">${team.teamName}</span>
          <span class="transfer-count-badge">${team.items.length}건</span>
          <span class="transfer-team-toggle-arrow">▾</span>
        </button>
        <div class="transfer-team-body" data-team-body="${i}" style="display: none;"></div>
      </div>
    `
    )
    .join("");

  fadeIn(el.teamsWrap);
  el.teamsWrap.querySelectorAll("[data-team-idx]").forEach((btn) => {
    btn.addEventListener("click", () => toggleTeam(teams, Number(btn.dataset.teamIdx), btn));
  });
}

function transferRowHtml(t) {
  const fee = feeLabel(t.moveType);
  const directionBadge = t.direction === "in" ? '<span class="transfer-direction in">영입</span>' : '<span class="transfer-direction out">방출</span>';

  return `
    <div class="transfer-row" data-player-id="${t.playerId}">
      ${transferAvatarImg({ id: t.playerId, name: t.playerName, photo: t.playerPhoto }, "transfer-player-photo")}
      <div class="transfer-info">
        <div class="transfer-player-name">${t.playerName} ${directionBadge}</div>
        <div class="transfer-move">
          <span class="transfer-team">${crestImg({ crest: t.fromCrest, name: t.fromTeam }, "transfer-team-crest")}${t.fromTeam}</span>
          <span class="transfer-arrow">→</span>
          <span class="transfer-team">${crestImg({ crest: t.toCrest, name: t.toTeam }, "transfer-team-crest")}${t.toTeam}</span>
        </div>
        <div class="transfer-meta">${formatTransferDate(t.date)}${fee ? ` · ${fee}` : ""}</div>
      </div>
    </div>
  `;
}

function toggleTeam(teams, idx, btn) {
  const body = el.teamsWrap.querySelector(`[data-team-body="${idx}"]`);
  const isOpen = body.style.display !== "none";
  if (isOpen) {
    body.style.display = "none";
    btn.classList.remove("open");
    return;
  }

  btn.classList.add("open");
  body.style.display = "block";
  if (body.dataset.rendered) return;

  const team = teams[idx];
  body.innerHTML = team.items.map(transferRowHtml).join("");
  body.dataset.rendered = "1";
  body.querySelectorAll("[data-player-id]").forEach((row) => {
    row.style.cursor = "pointer";
    row.addEventListener("click", () => goToPlayer(row.dataset.playerId));
  });
  loadPhotosFor(team.items, body);
}

// API-Football의 이적 목록 응답 자체엔 선수 사진이 없어서, 실제로 펼쳐본 팀의 선수들만
// 별도 엔드포인트로 필요한 만큼만 가져와 채워 넣는다(실패해도 레고 아바타 폴백으로 보이니 조용히 무시).
async function loadPhotosFor(items, container) {
  const ids = [...new Set(items.map((t) => t.playerId).filter(Boolean))];
  if (!ids.length) return;
  try {
    const data = await fetchJSON(`/players/photos?ids=${ids.join(",")}`);
    const photos = data.photos || {};
    container.querySelectorAll("[data-player-id]").forEach((row) => {
      const url = photos[row.dataset.playerId];
      if (!url) return;
      const img = row.querySelector(".transfer-player-photo");
      if (img) img.src = url;
    });
  } catch {
    // 무시
  }
}

onTabChange("transfers", () => {
  if (!state.loaded) loadTransfers();
});
