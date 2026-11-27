// 리그/대회 전체를 한 번에 즐겨찾기(알림)하는 "전부 다" 방식 대신, 오늘 그 대회에서 열리는 경기
// 중에서 원하는 경기만 골라 알림을 켤 수 있는 체크리스트 모달 - 경기 탭의 대회 헤더, 리그 탭의
// 순위 화면 둘 다에서 재사용한다. matches.js/leagues.js 양쪽에서 쓰이는데 두 모듈이 서로를 직접
// import하면 순환 참조가 생겨서(router.js가 콜백으로 중개하는 것과 같은 이유), 어느 쪽도 의존하지
// 않는 이 독립 모듈에 둔다.
//
// 처음엔 "팀" 단위로 골라서 그 팀의 알림 종류(골/카드 등)까지 팀별로 따로 설정하는 방식으로
// 만들었는데(2026-11-24), 국제대회처럼 팀이 많은 조별리그에서는 체크한 팀마다 설정을 또 들어가야
// 해서 여전히 번거로웠다. 사용자가 "팀말고 경기만 보여줘"라고 더 단순하게 요청해서(2026-11-27),
// 이미 잘 동작하던 "경기 하나만 따로 지정하는 벨"(watchlist.js의 matchIds 방식, 각 경기 행에
// 있는 🔔 버튼과 완전히 같은 메커니즘)을 이 모달에서 경기 목록 형태로 한 번에 여러 개 누를 수 있게
// 만든 것뿐이다 - 새로운 저장 방식이 아니라 기존 방식을 모아서 보여주는 UI.
import { crestImg, escapeHtml } from "./format.js";
import { isWatched, toggleWatch } from "./watchlist.js";
import { setMatchWatch } from "./push.js";

// matches: [{id, homeTeam, awayTeam}, ...] (오늘 이 대회에서 열리는 경기 목록)
export function openNotifyMatchesPicker(title, matches) {
  if (!matches.length) {
    alert("오늘 열리는 경기가 없어요.");
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "points-info-modal";
  wrap.innerHTML = `
    <div class="points-info-backdrop"></div>
    <div class="points-info-card notify-picker-card">
      <div class="points-info-header"><h3>🔔 ${escapeHtml(title)}</h3></div>
      <p class="notify-picker-hint">알림 받을 경기를 골라서 켜세요.</p>
      <div class="notify-picker-list">
        ${matches
          .map(
            (m) => `
          <label class="notify-match-row">
            <span class="notify-match-team">${crestImg(m.homeTeam, "team-crest")}<span>${escapeHtml(
              m.homeTeam.shortName || m.homeTeam.name || ""
            )}</span></span>
            <span class="notify-match-vs">vs</span>
            <span class="notify-match-team away"><span>${escapeHtml(
              m.awayTeam.shortName || m.awayTeam.name || ""
            )}</span>${crestImg(m.awayTeam, "team-crest")}</span>
            <input type="checkbox" data-notify-match-id="${m.id}" ${isWatched(m.id) ? "checked" : ""} />
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

  wrap.querySelectorAll("[data-notify-match-id]").forEach((input) => {
    input.addEventListener("change", async () => {
      const matchId = input.dataset.notifyMatchId;
      const nowWatched = toggleWatch(matchId);
      input.checked = nowWatched;

      // setMatchWatch 내부 네트워크 에러 등으로 예외가 던져져도 체크박스 상태는 반드시 되돌려야
      // 한다(경기 목록의 개별 벨과 동일한 복구 로직).
      const ok = await setMatchWatch(matchId, nowWatched).catch(() => false);
      if (!ok) {
        const reverted = toggleWatch(matchId);
        input.checked = reverted;
        alert("알림을 받으려면 브라우저 알림 권한이 필요합니다.");
      }
    });
  });
}
