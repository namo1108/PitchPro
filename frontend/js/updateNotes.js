// 앱 시작 시 "업데이트 소식" 팝업 - 날짜별로 묶어서 관리한다. 배열 맨 앞(UPDATE_NOTES[0])이 최신이고,
// 팝업엔 그 날짜 항목 하나만 보여준다 - 예전엔 모든 업데이트 내용을 한 리스트에 계속 누적해서 보여줘서
// 팝업이 너무 길어졌다(사용자 요청, 2026-09-17). 새 업데이트가 생기면 배열 맨 앞에 새
// { date, notes } 항목을 추가하면 된다 - 예전 항목은 기록용으로 남겨둬도(지울 필요 없음) 팝업에는
// 영향 없다(아래 로직이 [0]만 보여준다). "이미 이 날짜를 봤는지"도 날짜 문자열 기준으로 저장해서,
// 새 날짜가 추가되면 그 항목을 아직 안 본 사용자 전원에게(신규 유저 포함) 한 번씩 다시 띄운다.
const SEEN_KEY_PREFIX = "update-notes-seen-";

const UPDATE_NOTES = [
  {
    date: "2026-09-17",
    notes: [
      "🏅 아시안게임을 리그 목록에 추가했어요",
      "🇰🇷 국가대표팀 엠블럼이 태극기 대신 정식 KFA 엠블럼으로 나와요",
    ],
  },
  {
    date: "2026-09-14",
    notes: [
      "🏅 경기 상세 화면에 '순위' 탭이 생겼어요 - 그 경기가 속한 리그 순위를 바로 볼 수 있어요",
      "📅 팀 정보의 최근/예정 경기가 이제 시즌 전체 일정으로 넉넉하게 보여요",
      "🏆 챔피언스리그 등 리그 페이즈가 있는 대회는 대진표 대신 순위표로 보여요",
    ],
  },
  {
    date: "2026-09-10",
    notes: [
      "⚡ 챔피언스리그 등 여러 경기가 동시에 열릴 때, 경기 종료 결과가 늦게 반영되던 문제를 개선했어요",
      "🔔 같은 계정으로 여러 기기(폰+태블릿 등)에 로그인해도 이제 모든 기기에 알림이 와요",
    ],
  },
  {
    date: "2026-09-08",
    notes: [
      "🟥 퇴장 표시가 이제 모든 라이브 경기에서 보여요 (이전엔 일부 경기에서만 표시됐어요)",
      "⏱️ 전후반 추가시간에는 90+3'처럼 몇 분 추가됐는지 같이 표기돼요",
      "⚽ 프리미어리그 20개 구단 감독/스쿼드 정보를 최신 이적 소식 기준으로 업데이트했어요",
    ],
  },
  {
    date: "2026-09-06",
    notes: [
      "🔄 팀/선수 정보가 가끔 최신으로 안 바뀌고 예전 내용 그대로 보이던 문제를 고쳤어요",
      "🔔 알림을 누르면 그 내용에 맞는 화면으로 바로 이동해요 (골 알림 → 경기 정보, 라인업 알림 → 라인업 등)",
      "🟥 경기 목록에서 퇴장당한 팀 옆에 레드카드 표시가 떠요",
      "📊 순위표 승점/득실은 이제 항상 공식 확정 기록과 똑같이 나와요 - 진행 중인 경기는 팀명 옆 점 색깔(초록/회색/빨강)로만 지금 이기는지/비기는지/지는지 알려드려요",
      "🔔 골/카드 알림이 가끔 끊기던 문제를 개선했어요",
      "⚡ 팀/선수 정보를 누르면 로딩 화면 없이 바로 화면이 전환돼요",
      "⚽ K3/K4 경기 중계에 슈팅·유효슈팅·코너킥·반칙·점유율 스탯이 더 자세히 나와요",
      "👥 닉네임 옆에 친구추가 버튼이 생겼어요 (커뮤니티, 명예의 전당)",
      "💬 글/댓글 작성 중 '@'를 입력하면 가입된 닉네임이 자동완성으로 떠요 - 태그하면 그 사람에게 알림이 가요",
    ],
  },
];

const latest = UPDATE_NOTES[0];
const UPDATE_NOTES_VERSION = latest.date;

function modalEl() {
  return document.getElementById("update-notes-modal");
}

function show() {
  const modal = modalEl();
  if (!modal) return;
  const dateEl = document.getElementById("update-notes-date");
  if (dateEl) dateEl.textContent = latest.date;
  document.getElementById("update-notes-list").innerHTML = latest.notes.map((n) => `<li>${n}</li>`).join("");
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
