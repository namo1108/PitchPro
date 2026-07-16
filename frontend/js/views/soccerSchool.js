import { pushDetail } from "../router.js";
import { fadeIn } from "../format.js";
import { RULE_SECTIONS, POSITIONS, FORMATIONS, MATCH_TERMS } from "../soccerSchoolData.js";

const el = { content: document.getElementById("soccerschool-content") };

export function openSoccerSchool() {
  pushDetail("soccerschool");
  renderTab("rules");
}

function ruleCardHtml(section) {
  return `
    <div class="rule-card ${section.highlight ? "highlight" : ""}">
      <div class="rule-card-icon">${section.icon}</div>
      <div class="rule-card-body">
        <div class="rule-card-title">${section.title}</div>
        <div class="rule-card-text">${section.body}</div>
      </div>
    </div>
  `;
}

function positionCardHtml(p) {
  return `
    <div class="position-card">
      <div class="position-code">${p.code}</div>
      <div class="position-body">
        <div class="position-name">${p.name}</div>
        <div class="position-desc">${p.desc}</div>
      </div>
    </div>
  `;
}

// 포메이션 숫자([수비,미드필더,공격])를 미니 피치 다이어그램으로 그려서 글보다 한눈에 들어오게 한다.
function formationDiagramHtml([def, mid, fwd]) {
  const row = (count, cls) => `<div class="formation-row">${Array.from({ length: count }, () => `<span class="formation-dot ${cls}"></span>`).join("")}</div>`;
  return `
    <div class="formation-pitch">
      ${row(fwd, "fwd")}
      ${row(mid, "mid")}
      ${row(def, "def")}
      <div class="formation-row">${row(1, "gk")}</div>
    </div>
  `;
}

function formationCardHtml(f) {
  return `
    <div class="formation-card">
      ${formationDiagramHtml(f.diagram)}
      <div class="formation-body">
        <div class="formation-name">${f.name}</div>
        <div class="formation-desc">${f.desc}</div>
      </div>
    </div>
  `;
}

function termRowHtml(t) {
  return `
    <div class="term-row">
      <div class="term-name">${t.term}</div>
      <div class="term-desc">${t.desc}</div>
    </div>
  `;
}

const TABS = {
  rules: () => RULE_SECTIONS.map(ruleCardHtml).join(""),
  positions: () => `<div class="position-grid">${POSITIONS.map(positionCardHtml).join("")}</div>`,
  formations: () => `<div class="formation-grid">${FORMATIONS.map(formationCardHtml).join("")}</div>`,
  terms: () => `<div class="term-list">${MATCH_TERMS.map(termRowHtml).join("")}</div>`,
};

function renderTab(tab) {
  el.content.querySelectorAll(".school-tab-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
  const body = el.content.querySelector("#school-tab-body");
  body.innerHTML = TABS[tab]();
  fadeIn(body);
}

el.content.addEventListener("click", (e) => {
  const tabBtn = e.target.closest(".school-tab-btn");
  if (tabBtn) renderTab(tabBtn.dataset.tab);
});
