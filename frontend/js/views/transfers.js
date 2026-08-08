import { fetchJSON } from "../api.js";
import { onTabChange, pushSubView } from "../router.js";
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

// "€ 55M"처럼 실제 이적료 문구가 오면 그대로 보여준다(API-Football이 드물게 제공). "Return from
// loan"(임대 복귀)이 /loan/i에 걸려 새 임대처럼 보이던 것과, 금액 없는 "Transfer"가 의미있는 이적료인
// 것처럼 그대로 노출되던 걸 고쳤다(src/scheduled/refreshTransferMarket.js formatMoveType와 동일 로직).
function feeLabel(moveType) {
  if (!moveType) return "";
  if (/return/i.test(moveType) && /loan/i.test(moveType)) return "임대 복귀";
  if (/free/i.test(moveType)) return "자유계약";
  if (/loan/i.test(moveType)) return "임대";
  if (/n\/?a/i.test(moveType)) return "";
  if (/^transfer$/i.test(moveType.trim())) return "";
  return moveType;
}

// 이번 세션에 한 번 그려본 뒤로는(state.loaded) 탭을 다시 눌러도 스켈레톤으로 비우지 않고 화면에
// 남겨둔 채 조용히 새로 받아와서 갈아끼운다 - 매번 탭 전환마다 깜빡이며 로딩되는 느낌을 없앤다.
async function loadTransfers() {
  if (!state.loaded) el.list.innerHTML = skeletonList(8);
  try {
    const data = await fetchJSON("/transfers");
    state.leagues = data.leagues || [];
    renderLeagueList(!state.loaded);
    state.loaded = true;
  } catch (err) {
    if (!state.loaded) el.list.innerHTML = `<div class="error-state">이적 소식을 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

// 리그를 통째로 하나의 긴 목록으로 다 그리면(수백 건) 렉이 걸려서, 리그 목록 -> 리그별 팀 아코디언
// 순으로 화면을 나눠 한 번에 그리는 양을 크게 줄인다(리그 화면(leagues.js)과 같은 구조).
function renderLeagueList(animate) {
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

  if (animate) fadeIn(el.list);
  el.list.querySelectorAll("[data-code]").forEach((row) => {
    row.addEventListener("click", () => openLeague(row.dataset.code));
  });
}

// 목록으로 되돌리는 동작 - 뒤로가기 버튼과 하드웨어/제스처 뒤로가기 둘 다 결국 이 함수로 귀결된다.
function showTransfersList() {
  el.detailWrap.style.display = "none";
  el.list.style.display = "flex";
}

function openLeague(code) {
  const league = state.leagues.find((l) => l.code === code);
  if (!league) return;

  el.detailHeader.innerHTML = `${emblemImg(league, "league-detail-emblem")}<span>${league.name}</span>`;
  el.list.style.display = "none";
  el.detailWrap.style.display = "block";
  pushSubView(showTransfersList);
  renderTeams(league.teams);
}

// 실제 되돌리기는 pushSubView가 등록해둔 콜백(showTransfersList)이 popstate 시점에 처리한다.
el.backBtn.addEventListener("click", () => history.back());

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
  // Transfermarkt에서 찾아낸 실제 이적료(feeAmount)가 있으면 그걸 우선 보여준다 - API-Football이 준
  // 정성적 값(자유계약/임대 등)보다 구체적인 정보라서.
  const fee = t.feeAmount || feeLabel(t.moveType);
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

// leagues.js와 같은 이유로(탭을 벗어나면 router.js의 backStack은 비워지는데 상세 화면 DOM은
// 그대로 남아있음) 탭 재진입 시 항상 목록부터 보여준다.
onTabChange("transfers", () => {
  showTransfersList();
  if (!state.loaded) loadTransfers();
});
