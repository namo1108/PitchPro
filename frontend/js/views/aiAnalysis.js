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

async function loadAnalysis() {
  el.list.innerHTML = skeletonList(4);
  el.linkOnlyWrap.innerHTML = "";
  try {
    const data = await fetchJSON("/analysis");
    renderAnalysis(data.analysis || []);
    renderLinkOnly(data.linkOnly || []);
  } catch (err) {
    el.list.innerHTML = `<div class="error-state">분석 정보를 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

// 스포츠토토(베트맨) 승무패 대상이 아닌 리그/컵대회/친선경기는 억지로 분석 문구를 만들지 않고,
// 경기 상세로 바로 넘어가는 링크 목록으로만 간단히 보여준다.
function renderLinkOnly(matches) {
  if (!matches.length) {
    el.linkOnlyWrap.innerHTML = "";
    return;
  }

  el.linkOnlyWrap.innerHTML = `
    <div class="ai-link-only-title">그 외 예정 경기 <span class="ai-link-only-hint">(베트맨 승무패 미대상 · 분석 없이 경기 정보만)</span></div>
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

function oddsBlock(odds) {
  if (!odds) return "";
  const row = (label, value) => (value ? `<div class="odds-cell"><span>${label}</span><b>${value.toFixed(2)}</b></div>` : "");
  return `
    <div class="ai-section ai-odds">
      <div class="ai-section-title">💰 해외 북메이커 배당률 <span class="odds-source">(${odds.bookmaker} 기준, 국내 정식 배당률 아님)</span></div>
      <div class="odds-row">
        ${row("승", odds.home)}
        ${row("무", odds.draw)}
        ${row("패", odds.away)}
      </div>
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

function renderAnalysis(cards) {
  if (!cards.length) {
    el.list.innerHTML = '<div class="empty-state">베트맨 승무패 대상 예정 경기가 없습니다.</div>';
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
      ${noteList("최근 폼", "📈", c.formNotes)}
      ${noteList("순위", "📊", c.standingsNotes)}
      ${noteList("결장 이슈", "⚕", c.injuryNotes)}
      ${predictionBar(c.prediction)}
      ${oddsBlock(c.odds)}
    </div>
  `
    )
    .join("");

  fadeIn(el.list);
  el.list.querySelectorAll("[data-team-id]").forEach((elm) => {
    elm.addEventListener("click", () => goToTeam(elm.dataset.teamId));
  });
}

onTabChange("ai", loadAnalysis);
