// 리그/대회 전체를 한 번에 즐겨찾기(알림)하는 "전부 다" 방식 대신, 그 대회 소속 팀 중에서 원하는
// 팀만 골라 알림을 켤 수 있는 체크리스트 모달 - 경기 탭의 대회 헤더, 리그 탭의 순위 화면 둘 다에서
// 재사용한다(2026-11-24 사용자 요청 - "알림을...그 리그나 대회 탭 클릭하면 알림 설정할 수 있게해줘
// 모든 팀이 아니고"). matches.js/leagues.js 양쪽에서 쓰이는데 두 모듈이 서로를 직접 import하면
// 순환 참조가 생겨서(router.js가 콜백으로 중개하는 것과 같은 이유), 어느 쪽도 의존하지 않는 이
// 독립 모듈에 둔다.
import { crestImg, escapeHtml } from "./format.js";
import { addNotifyTeams, removeNotifyTeams, isNotifyTeam } from "./notifyTeams.js";

// teams: [{id, name, shortName, crest}, ...] (중복 id는 호출부에서 이미 제거된 상태로 넘겨준다)
export function openNotifyTeamsPicker(title, teams) {
  if (!teams.length) {
    alert("알림을 설정할 팀 정보가 없어요.");
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "points-info-modal";
  wrap.innerHTML = `
    <div class="points-info-backdrop"></div>
    <div class="points-info-card notify-picker-card">
      <div class="points-info-header"><h3>🔔 ${escapeHtml(title)}</h3></div>
      <p class="notify-picker-hint">알림 받을 팀만 골라서 켜세요. 골/카드 등 알림 종류는 설정 탭에서 전체 공통으로 조정할 수 있어요.</p>
      <div class="notify-picker-list">
        ${teams
          .map(
            (t) => `
          <label class="notify-picker-row">
            ${crestImg(t, "team-crest")}
            <span class="notify-picker-name">${escapeHtml(t.shortName || t.name || "")}</span>
            <input type="checkbox" data-notify-team-id="${t.id}" ${isNotifyTeam(t.id) ? "checked" : ""} />
          </label>
        `
          )
          .join("")}
      </div>
      <button type="button" class="career-start-btn" id="notify-picker-close">닫기</button>
    </div>
  `;
  document.body.appendChild(wrap);

  const close = () => wrap.remove();
  wrap.querySelector(".points-info-backdrop").addEventListener("click", close);
  wrap.querySelector("#notify-picker-close").addEventListener("click", close);
  wrap.querySelectorAll("[data-notify-team-id]").forEach((input) => {
    const team = teams.find((t) => String(t.id) === input.dataset.notifyTeamId);
    if (!team) return;
    input.addEventListener("change", () => {
      if (input.checked) addNotifyTeams([team]);
      else removeNotifyTeams([team.id]);
    });
  });
}
