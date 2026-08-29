// 앱 시작 시 "업데이트 소식" 팝업 - 아래 UPDATE_NOTES_VERSION을 바꾸고 NOTES 내용을 갱신하면,
// 이미 이 버전을 본 사용자를 제외한 모두에게(신규 유저 포함) 한 번씩 다시 떠서 새 소식을 알려준다.
// X 버튼 또는 배경 클릭으로 닫으면 그 버전은 다시 안 보여준다.
const SEEN_KEY_PREFIX = "update-notes-seen-";
const UPDATE_NOTES_VERSION = "2026-08-29";

const NOTES = [
  "🎨 K리그·프리미어리그·라리가 등 리그별로 화면 테마(배경·엠블럼)가 달라져요",
  "🕐 경기 탭에 '시간순 보기' 버튼이 생겼어요 - 리그 상관없이 오늘 경기를 킥오프 순서대로 쭉 볼 수 있어요",
  "🏆 FA컵이 새로 추가됐어요",
  "🤖 AI 분석이 실제로 자주 챙겨보는 주요 대회 위주로 더 정확해졌어요",
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
