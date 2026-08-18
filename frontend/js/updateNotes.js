// 앱 시작 시 "업데이트 소식" 팝업 - 아래 UPDATE_NOTES_VERSION을 바꾸고 NOTES 내용을 갱신하면,
// 이미 이 버전을 본 사용자를 제외한 모두에게(신규 유저 포함) 한 번씩 다시 떠서 새 소식을 알려준다.
// X 버튼 또는 배경 클릭으로 닫으면 그 버전은 다시 안 보여준다.
const SEEN_KEY_PREFIX = "update-notes-seen-";
const UPDATE_NOTES_VERSION = "2026-08-18";

const NOTES = [
  "⚽ AFC 챔피언스리그, 코리아컵 등 AI 분석 대상 대회를 늘렸어요",
  "📊 경기 화면에서 대회명을 누르면 바로 리그 순위로 이동해요",
  "🔔 알림이 골/실점/킥오프/하프타임 등 종류별로 다른 아이콘으로 와요",
  "🏅 무승부 포인트가 최종 +2P로 정리되고, 레벨 안내가 추가됐어요",
  "⭐ '나의 팀'은 최대 2팀까지, 국가대표팀은 즐겨찾기에서 제외돼요",
];

function modalEl() {
  return document.getElementById("update-notes-modal");
}

function show() {
  const modal = modalEl();
  if (!modal) return;
  document.getElementById("update-notes-list").innerHTML = NOTES.map((n) => `<li>${n}</li>`).join("");
  modal.style.display = "flex";
}

function hide() {
  localStorage.setItem(SEEN_KEY_PREFIX + UPDATE_NOTES_VERSION, "1");
  const modal = modalEl();
  if (modal) modal.style.display = "none";
}

export function initUpdateNotes() {
  document.getElementById("update-notes-close")?.addEventListener("click", hide);
  document.querySelector("#update-notes-modal .points-info-backdrop")?.addEventListener("click", hide);

  if (localStorage.getItem(SEEN_KEY_PREFIX + UPDATE_NOTES_VERSION)) return;
  setTimeout(show, 600);
}
