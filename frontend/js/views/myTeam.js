import { fetchJSON } from "../api.js";
import { onTabChange } from "../router.js";
import { crestImg, formatKickoff, formatDateLabel } from "../format.js";
import { listFavorites, toggleFavorite } from "../favorites.js";
import { goToTeam } from "./teamDetail.js";

const el = { list: document.getElementById("myteam-list") };

export async function loadMyTeam() {
  const favorites = listFavorites();
  if (!favorites.length) {
    el.list.innerHTML = '<div class="empty-state">팀 상세 화면에서 ★를 눌러 즐겨찾기하세요.</div>';
    return;
  }

  el.list.innerHTML = '<div class="loading">불러오는 중...</div>';
  const cards = await Promise.all(
    favorites.map(async (fav) => {
      try {
        const data = await fetchJSON(`/teams/${fav.id}`);
        return renderCard(fav, data);
      } catch {
        return renderCard(fav, null);
      }
    })
  );
  el.list.innerHTML = cards.join("");

  el.list.querySelectorAll("[data-team-id]").forEach((elm) => {
    elm.addEventListener("click", (e) => {
      if (e.target.closest("[data-remove]")) return;
      goToTeam(elm.dataset.teamId);
    });
  });
  el.list.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavorite({ id: btn.dataset.remove });
      loadMyTeam();
    });
  });
}

function renderCard(fav, data) {
  const next = data?.upcomingMatches?.[0];
  const nextHtml = next
    ? `<div class="myteam-next">다음 경기: ${next.homeTeam.shortName || next.homeTeam.name} vs ${next.awayTeam.shortName || next.awayTeam.name} · ${formatKickoff(next.utcDate)}</div>`
    : '<div class="myteam-next">예정된 경기 정보 없음</div>';

  const recent = data?.recentMatches || [];
  const form = recent
    .map((m) => {
      const isHome = m.homeTeam.id === fav.id;
      const my = isHome ? m.score.fullTime.home : m.score.fullTime.away;
      const opp = isHome ? m.score.fullTime.away : m.score.fullTime.home;
      if (my === null || my === undefined) return "";
      const result = my > opp ? "W" : my < opp ? "L" : "D";
      return `<span class="form-badge ${result.toLowerCase()}">${result}</span>`;
    })
    .join("");

  return `
    <div class="myteam-card" data-team-id="${fav.id}">
      <button class="myteam-remove" data-remove="${fav.id}" title="즐겨찾기 해제">✕</button>
      ${crestImg(fav, "myteam-crest")}
      <div class="myteam-info">
        <div class="myteam-name">${fav.name}</div>
        ${nextHtml}
        ${form ? `<div class="myteam-form">${form}</div>` : ""}
      </div>
    </div>
  `;
}

onTabChange("myteam", loadMyTeam);
