// 앱 시작 시 "업데이트 소식" 팝업 - 아래 UPDATE_NOTES_VERSION을 바꾸고 NOTES 내용을 갱신하면,
// 이미 이 버전을 본 사용자를 제외한 모두에게(신규 유저 포함) 한 번씩 다시 떠서 새 소식을 알려준다.
// X 버튼 또는 배경 클릭으로 닫으면 그 버전은 다시 안 보여준다.
const SEEN_KEY_PREFIX = "update-notes-seen-";
const UPDATE_NOTES_VERSION = "2026-08-24";

const NOTES = [
  "⚽ MLS 경기 라인업과 통계(슈팅·점유율 등)를 볼 수 있어요",
  "📊 K3·K4 경기에도 실시간 슈팅·유효슈팅·점유율 통계가 추가됐어요",
  "🌍 오늘의 경기 목록에서 낯선 해외 하부리그는 기본으로 숨기고, '다른 리그 보기'에서 원할 때만 골라볼 수 있어요",
  "🔔 실시간 골 알림의 정확도를 개선했어요(레이트리밋 상황에서의 오탐 수정)",
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
