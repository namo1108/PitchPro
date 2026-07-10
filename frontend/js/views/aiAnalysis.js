import { fetchJSON } from "../api.js";
import { onTabChange } from "../router.js";
import { crestImg } from "../format.js";
import { goToTeam } from "./teamDetail.js";

const el = { list: document.getElementById("ai-list") };

function formatKickoff(utcDate) {
  const d = new Date(utcDate);
  return d.toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function loadAnalysis() {
  el.list.innerHTML = '<div class="loading">분석을 불러오는 중...</div>';
  try {
    const data = await fetchJSON("/analysis");
    renderAnalysis(data.analysis || []);
  } catch (err) {
    el.list.innerHTML = `<div class="error-state">분석 정보를 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

function renderAnalysis(cards) {
  if (!cards.length) {
    el.list.innerHTML = '<div class="empty-state">분석할 예정 경기가 없습니다.</div>';
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
      <div class="ai-card-summary">✨ ${c.summary}</div>
    </div>
  `
    )
    .join("");

  el.list.querySelectorAll("[data-team-id]").forEach((elm) => {
    elm.addEventListener("click", () => goToTeam(elm.dataset.teamId));
  });
}

onTabChange("ai", loadAnalysis);
