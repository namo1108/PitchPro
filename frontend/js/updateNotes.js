// 앱 시작 시 "업데이트 소식" 팝업 - 아래 UPDATE_NOTES_VERSION을 바꾸고 NOTES 내용을 갱신하면,
// 이미 이 버전을 본 사용자를 제외한 모두에게(신규 유저 포함) 한 번씩 다시 떠서 새 소식을 알려준다.
// X 버튼 또는 배경 클릭으로 닫으면 그 버전은 다시 안 보여준다.
const SEEN_KEY_PREFIX = "update-notes-seen-";
const UPDATE_NOTES_VERSION = "2026-09-02-2";

const NOTES = [
  "⚡ 팀/선수 정보를 누르면 로딩 화면 없이 바로 화면이 전환돼요",
  "⚽ K3/K4 경기 중계에 슈팅·유효슈팅·코너킥·반칙·점유율 스탯이 더 자세히 나와요",
  "🛠 경기 상세 화면이 가끔 안 열리던 문제, 팀/경기 정보 로딩 속도를 고쳤어요",
  "👥 닉네임 옆에 친구추가 버튼이 생겼어요 (커뮤니티, 명예의 전당)",
  "💬 글/댓글 작성 중 '@'를 입력하면 가입된 닉네임이 자동완성으로 떠요 - 태그하면 그 사람에게 알림이 가요",
  "🔁 이적시장 탭이 더 빨라졌어요 (관심 팀·주요 리그 위주로 먼저 갱신)",
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
