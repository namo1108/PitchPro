import { fetchJSON } from "../api.js";
import { onTabChange } from "../router.js";
import { crestImg } from "../format.js";
import { goToTeam } from "./teamDetail.js";

const state = { competitions: [], activeCode: null };

const el = {
  picker: document.getElementById("competition-picker"),
  wrap: document.getElementById("standings-table-wrap"),
};

async function loadCompetitions() {
  try {
    const data = await fetchJSON("/competitions");
    state.competitions = data.competitions || [];
    renderPicker();
    if (state.competitions.length) loadStandings(state.competitions[0].code);
  } catch (err) {
    el.picker.innerHTML = "";
    el.wrap.innerHTML = `<div class="error-state">리그 목록을 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

function renderPicker() {
  el.picker.innerHTML = "";
  state.competitions.forEach((c) => {
    const chip = document.createElement("button");
    chip.className = "comp-chip";
    chip.textContent = `${c.emblem} ${c.name}`;
    chip.dataset.code = c.code;
    chip.addEventListener("click", () => loadStandings(c.code));
    el.picker.appendChild(chip);
  });
}

function setActiveChip(code) {
  el.picker.querySelectorAll(".comp-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.code === code);
  });
}

async function loadStandings(code) {
  state.activeCode = code;
  setActiveChip(code);
  el.wrap.innerHTML = '<div class="loading">순위를 불러오는 중...</div>';
  try {
    const data = await fetchJSON(`/standings/${code}`);
    const table = (data.standings || []).find((s) => s.type === "TOTAL") || data.standings?.[0];
    renderTable(table);
  } catch (err) {
    el.wrap.innerHTML = `<div class="error-state">순위 정보를 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

function renderTable(table) {
  if (!table || !table.table?.length) {
    el.wrap.innerHTML = '<div class="empty-state">순위 정보가 없습니다.</div>';
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
          <td><div class="team-cell" data-team-id="${row.team.id}">${crestImg(row.team, "team-crest")}${row.team.shortName || row.team.name}</div></td>
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

  el.wrap.innerHTML = `
    <table class="standings-table">
      <thead>
        <tr>
          <th>#</th><th>팀</th><th>경기</th><th>승</th><th>무</th><th>패</th><th>득실</th><th>승점</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  el.wrap.querySelectorAll("[data-team-id]").forEach((cell) => {
    cell.addEventListener("click", () => goToTeam(cell.dataset.teamId));
  });
}

onTabChange("leagues", () => {
  if (!state.competitions.length) loadCompetitions();
});
