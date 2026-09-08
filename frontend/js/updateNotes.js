// 앱 시작 시 "업데이트 소식" 팝업 - 아래 UPDATE_NOTES_VERSION을 바꾸고 NOTES 내용을 갱신하면,
// 이미 이 버전을 본 사용자를 제외한 모두에게(신규 유저 포함) 한 번씩 다시 떠서 새 소식을 알려준다.
// X 버튼 또는 배경 클릭으로 닫으면 그 버전은 다시 안 보여준다.
const SEEN_KEY_PREFIX = "update-notes-seen-";
const UPDATE_NOTES_VERSION = "2026-09-08";

const NOTES = [
  "🟥 퇴장 표시가 이제 모든 라이브 경기에서 보여요 (이전엔 일부 경기에서만 표시됐어요)",
  "⏱️ 전후반 추가시간에는 90+3'처럼 몇 분 추가됐는지 같이 표기돼요",
  "⚽ 프리미어리그 20개 구단 감독/스쿼드 정보를 최신 이적 소식 기준으로 업데이트했어요",
  "🔄 팀/선수 정보가 가끔 최신으로 안 바뀌고 예전 내용 그대로 보이던 문제를 고쳤어요",
  "🔔 알림을 누르면 그 내용에 맞는 화면으로 바로 이동해요 (골 알림 → 경기 정보, 라인업 알림 → 라인업 등)",
  "🟥 경기 목록에서 퇴장당한 팀 옆에 레드카드 표시가 떠요",
  "📊 순위표 승점/득실은 이제 항상 공식 확정 기록과 똑같이 나와요 - 진행 중인 경기는 팀명 옆 점 색깔(초록/회색/빨강)로만 지금 이기는지/비기는지/지는지 알려드려요",
  "🔔 골/카드 알림이 가끔 끊기던 문제를 개선했어요",
  "⚡ 팀/선수 정보를 누르면 로딩 화면 없이 바로 화면이 전환돼요",
  "⚽ K3/K4 경기 중계에 슈팅·유효슈팅·코너킥·반칙·점유율 스탯이 더 자세히 나와요",
  "👥 닉네임 옆에 친구추가 버튼이 생겼어요 (커뮤니티, 명예의 전당)",
  "💬 글/댓글 작성 중 '@'를 입력하면 가입된 닉네임이 자동완성으로 떠요 - 태그하면 그 사람에게 알림이 가요",
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
