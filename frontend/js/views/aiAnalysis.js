import { fetchJSON } from "../api.js";
import { onTabChange } from "../router.js";
import { crestImg, KST_TIME_ZONE, fadeIn, skeletonList } from "../format.js";
import { goToTeam } from "./teamDetail.js";
import { loadMatchDetail } from "./matches.js";

const el = {
  list: document.getElementById("ai-list"),
  linkOnlyWrap: document.getElementById("ai-link-only-wrap"),
};

function formatKickoff(utcDate) {
  const d = new Date(utcDate);
  return d.toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: KST_TIME_ZONE });
}

// 이번 세션에 한 번 그려본 뒤로는 탭을 다시 눌러도 스켈레톤으로 비우지 않고 화면에 남겨둔 채
// 조용히 새로 받아와서 갈아끼운다 - 매번 탭 전환마다 깜빡이며 로딩되는 느낌을 없앤다.
let loadedOnce = false;

async function loadAnalysis() {
  if (!loadedOnce) {
    el.list.innerHTML = skeletonList(4);
    el.linkOnlyWrap.innerHTML = "";
  }
  try {
    const data = await fetchJSON("/analysis");
    renderAnalysis(data.analysis || [], !loadedOnce);
    renderLinkOnly(data.linkOnly || []);
    loadedOnce = true;
  } catch (err) {
    if (!loadedOnce) el.list.innerHTML = `<div class="error-state">분석 정보를 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

// 주요 대회가 아닌 리그/컵대회/친선경기는 억지로 분석 문구를 만들지 않고,
// 경기 상세로 바로 넘어가는 링크 목록으로만 간단히 보여준다.
function renderLinkOnly(matches) {
  if (!matches.length) {
    el.linkOnlyWrap.innerHTML = "";
    return;
  }

  el.linkOnlyWrap.innerHTML = `
    <div class="ai-link-only-title">그 외 예정 경기 <span class="ai-link-only-hint">(분석 없이 경기 정보만)</span></div>
    <div class="ai-link-only-list">
      ${matches
        .map(
          (m) => `
        <div class="ai-link-row" data-match-id="${m.matchId}">
          <span class="ai-link-comp">${m.competition.name}</span>
          <span class="ai-link-teams">${m.homeTeam.shortName || m.homeTeam.name} vs ${m.awayTeam.shortName || m.awayTeam.name}</span>
          <span class="ai-link-date">${formatKickoff(m.utcDate)}</span>
          <span class="ai-link-arrow">›</span>
        </div>
      `
        )
        .join("")}
    </div>
  `;

  el.linkOnlyWrap.querySelectorAll("[data-match-id]").forEach((row) => {
    row.addEventListener("click", () => loadMatchDetail(row.dataset.matchId));
  });
}

function predictionBar(prediction) {
  if (!prediction) return "";
  const { home, draw, away, note } = prediction;
  return `
    <div class="ai-section ai-prediction">
      <div class="ai-section-title">🔮 승부예측 (참고용)</div>
      <div class="prediction-bar">
        <div class="prediction-seg home" style="width:${home}%">${home}%</div>
        <div class="prediction-seg draw" style="width:${draw}%">${draw}%</div>
        <div class="prediction-seg away" style="width:${away}%">${away}%</div>
      </div>
      <div class="prediction-note">${note}</div>
    </div>
  `;
}

function noteList(title, icon, notes) {
  if (!notes || !notes.length) return "";
  return `
    <div class="ai-section">
      <div class="ai-section-title">${icon} ${title}</div>
      ${notes.map((n) => `<p class="ai-note">${n}</p>`).join("")}
    </div>
  `;
}

// 카드를 6장에서 20장까지 늘리기로 하면서(2026-08-11) 전부 펼쳐두면 스크롤이 너무 길어져,
// 팀/예측만 기본으로 보여주고 나머지 세부 근거(폼/상대전적/순위/결장 등)는 접어뒀다가 눌러서
// 펼치는 방식으로 바꿨다 - 여러 경기를 훑어보다가 관심 가는 것만 깊게 파고들 수 있게.
function renderAnalysis(cards, animate) {
  if (!cards.length) {
    el.list.innerHTML = '<div class="empty-state">분석 가능한 예정 경기가 없습니다.</div>';
    return;
  }

  el.list.innerHTML = cards
    .map(
      (c) => `
    <div class="ai-card">
      <div class="ai-card-header">
        <span class="ai-card-competition">${c.competition.name}</span>
        <span class="ai-card-date">${formatKickoff(c.utcDate)}</span>
      </div>
      <div class="ai-card-teams">
        <div class="ai-card-team" data-team-id="${c.homeTeam.id}">${crestImg(c.homeTeam, "team-crest")}<span>${c.homeTeam.shortName || c.homeTeam.name}</span></div>
        <span class="ai-card-vs">vs</span>
        <div class="ai-card-team" data-team-id="${c.awayTeam.id}">${crestImg(c.awayTeam, "team-crest")}<span>${c.awayTeam.shortName || c.awayTeam.name}</span></div>
      </div>
      ${predictionBar(c.prediction)}
      <button type="button" class="ai-card-toggle">
        <span class="ai-card-toggle-label">자세히 보기</span>
        <span class="ai-card-toggle-arrow">▾</span>
      </button>
      <div class="ai-card-details">
        ${noteList("K리그 공식 파워랭킹", "🏆", c.officialNotes)}
        ${noteList("K리그 공식 최근 기록", "📋", c.kleagueOfficialNotes)}
        ${noteList("최근 폼", "📈", c.formNotes)}
        ${noteList("상대전적", "🆚", c.h2hNotes)}
        ${noteList("순위", "📊", c.standingsNotes)}
        ${noteList("결장 이슈", "⚕", c.injuryNotes)}
      </div>
    </div>
  `
    )
    .join("");

  if (animate) fadeIn(el.list);
  el.list.querySelectorAll("[data-team-id]").forEach((elm) => {
    elm.addEventListener("click", () => goToTeam(elm.dataset.teamId));
  });
  el.list.querySelectorAll(".ai-card-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".ai-card");
      const expanded = card.classList.toggle("expanded");
      btn.querySelector(".ai-card-toggle-label").textContent = expanded ? "접기" : "자세히 보기";
    });
  });
}

onTabChange("ai", loadAnalysis);
