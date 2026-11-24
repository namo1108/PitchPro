// 리그/대회 전체를 한 번에 즐겨찾기(알림)하는 "전부 다" 방식 대신, 그 대회 소속 팀 중에서 원하는
// 팀만 골라 알림을 켤 수 있는 체크리스트 모달 - 경기 탭의 대회 헤더, 리그 탭의 순위 화면 둘 다에서
// 재사용한다(2026-11-24 사용자 요청 - "알림을...그 리그나 대회 탭 클릭하면 알림 설정할 수 있게해줘
// 모든 팀이 아니고"). matches.js/leagues.js 양쪽에서 쓰이는데 두 모듈이 서로를 직접 import하면
// 순환 참조가 생겨서(router.js가 콜백으로 중개하는 것과 같은 이유), 어느 쪽도 의존하지 않는 이
// 독립 모듈에 둔다.
//
// 2026-11-24 추가 - "팀마다 알림 종류를 다르게" 요청을 받아, 팀 on/off 체크박스 아래에 그 팀 전용
// 알림 종류 토글(골/카드/라인업 등)을 같이 넣었다. 서버는 이 팀에 대해 명시적으로 켜고 끈 종류만
// sparse하게 저장하고(teamTypePrefs), 따로 안 건드린 종류는 설정 탭의 전체 공통값을 그대로 따른다.
import { crestImg, escapeHtml } from "./format.js";
import { addNotifyTeams, removeNotifyTeams, isNotifyTeam } from "./notifyTeams.js";
import { getCurrentSubscription } from "./push.js";
import { fetchJSON } from "./api.js";

// settings.js의 NOTIFICATION_TYPES와 id를 반드시 맞춰서 관리한다(서버 config.js NOTIFICATION_TYPES가
// 원본 - 프론트는 별도 정적 자산이라 그 코드를 직접 import할 수 없어 라벨/아이콘을 여기서도 다시 정의).
const TEAM_NOTIFICATION_TYPES = [
  { id: "goal", icon: "⚽", label: "골" },
  { id: "concede", icon: "😢", label: "실점" },
  { id: "var_cancel", icon: "🚫", label: "골 취소(VAR)" },
  { id: "shootout", icon: "🥅", label: "승부차기" },
  { id: "penaltymiss", icon: "😮", label: "페널티 실축" },
  { id: "kickoff_soon", icon: "⏱", label: "경기 시작 5분 전" },
  { id: "kickoff", icon: "⚽💨", label: "경기 시작" },
  { id: "halftime", icon: "⏸", label: "전반전 종료" },
  { id: "fulltime", icon: "🏁", label: "경기 종료" },
  { id: "yellowcard", icon: "🟨", label: "경고" },
  { id: "redcard", icon: "🟥", label: "퇴장" },
  { id: "lineup", icon: "📋", label: "라인업 발표" },
  { id: "transfer", icon: "🔁", label: "이적 소식" },
];

// teams: [{id, name, shortName, crest}, ...] (중복 id는 호출부에서 이미 제거된 상태로 넘겨준다)
export async function openNotifyTeamsPicker(title, teams) {
  if (!teams.length) {
    alert("알림을 설정할 팀 정보가 없어요.");
    return;
  }

  // 알림 종류는 서버의 구독 레코드에 저장되는 거라, 알림을 아직 한 번도 켠 적 없으면(구독 없음)
  // 팀 on/off만 가능하고 종류별 토글은 숨긴다(설정 탭의 renderNoSubscription과 같은 이유).
  const subscription = await getCurrentSubscription().catch(() => null);
  let globalPrefs = null;
  let teamTypePrefs = {};
  if (subscription) {
    try {
      const data = await fetchJSON(`/push/preferences?endpoint=${encodeURIComponent(subscription.endpoint)}`);
      globalPrefs = data.prefs;
      teamTypePrefs = data.teamTypePrefs || {};
    } catch {
      // 조회 실패해도 팀 on/off 토글은 그대로 쓸 수 있게 조용히 넘어간다 - 종류별 토글만 숨긴다.
    }
  }

  const typesHtml = (team) => {
    if (!subscription) return "";
    const watched = isNotifyTeam(team.id);
    const chips = TEAM_NOTIFICATION_TYPES.map((nt) => {
      const on = teamTypePrefs?.[team.id]?.[nt.id] ?? globalPrefs?.types?.[nt.id] ?? true;
      return `<button type="button" class="notify-type-chip ${on ? "on" : ""}" data-type-team="${team.id}" data-type="${nt.id}" title="${escapeHtml(
        nt.label
      )}">${nt.icon}</button>`;
    }).join("");
    return `<div class="notify-picker-types" data-types-for="${team.id}" ${watched ? "" : 'style="display:none"'}>${chips}</div>`;
  };

  const wrap = document.createElement("div");
  wrap.className = "points-info-modal";
  wrap.innerHTML = `
    <div class="points-info-backdrop"></div>
    <div class="points-info-card notify-picker-card">
      <div class="points-info-header"><h3>🔔 ${escapeHtml(title)}</h3></div>
      <p class="notify-picker-hint">${
        subscription
          ? "알림 받을 팀을 켜고, 팀마다 어떤 알림을 받을지도 눌러서 고를 수 있어요."
          : "설정 탭에서 먼저 알림을 켜면 팀마다 알림 종류도 고를 수 있어요. 지금은 팀 선택만 가능해요."
      }</p>
      <div class="notify-picker-list">
        ${teams
          .map(
            (t) => `
          <div class="notify-picker-row-wrap">
            <label class="notify-picker-row">
              ${crestImg(t, "team-crest")}
              <span class="notify-picker-name">${escapeHtml(t.shortName || t.name || "")}</span>
              <input type="checkbox" data-notify-team-id="${t.id}" ${isNotifyTeam(t.id) ? "checked" : ""} />
            </label>
            ${typesHtml(t)}
          </div>
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
      const typesPanel = wrap.querySelector(`[data-types-for="${team.id}"]`);
      if (typesPanel) typesPanel.style.display = input.checked ? "" : "none";
    });
  });

  if (subscription) {
    wrap.querySelectorAll(".notify-type-chip").forEach((chip) => {
      chip.addEventListener("click", async () => {
        chip.classList.toggle("on");
        const teamId = chip.dataset.typeTeam;
        // 바뀐 칩 하나만 보내면 서버가 그 팀의 override 전체를 이걸로 덮어써서, 아직 안 건드린 다른
        // 종류 override가 날아간다 - 지금 화면에 떠 있는 이 팀의 모든 칩 상태를 매번 통째로 보낸다.
        const types = {};
        wrap.querySelectorAll(`.notify-type-chip[data-type-team="${teamId}"]`).forEach((c) => {
          types[c.dataset.type] = c.classList.contains("on");
        });
        try {
          await fetchJSON("/push/team-preferences", { method: "POST", body: { endpoint: subscription.endpoint, teamId, types } });
        } catch {
          // 저장 실패해도 조용히 무시 - 모달을 다시 열면 서버에 실제로 저장된 값으로 다시 맞춰진다.
        }
      });
    });
  }
}
