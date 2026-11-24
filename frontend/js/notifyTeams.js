// "나의 팀"(favorites.js)은 집관인증/폼배지/포인트 기능까지 딸려있어서 의도적으로 최대 2개까지만
// 등록할 수 있게 막혀있다(2026-08-17 결정). 반면 "리그 하나를 고르면 그 리그 전체 팀을 한 번에
// 알림 구독"(2026-11-24 요청)은 많게는 20팀 가까이 될 수 있어 저 2개 제한과 정면으로 부딪힌다 -
// "나의 팀"을 건드리지 않고, 순수하게 골/카드 등 경기 알림만 받는 별도 목록을 둔다(개수 제한 없음,
// 집관인증 같은 "나의 팀" 전용 기능과는 무관). push.js가 구독 시 이 목록도 teamIds에 합쳐 보낸다.
const STORAGE_KEY = "pitchpro.notifyTeams";

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function listNotifyTeams() {
  return readAll();
}

export function isNotifyTeam(teamId) {
  return readAll().some((t) => t.id === teamId);
}

// team: {id, name, shortName, crest}. 이미 있는 팀은 건너뛰고, 새로 추가된 개수를 돌려준다.
// push.js의 favorites-changed 리스너가 이 이벤트로 구독 teamIds를 다시 서버에 등록한다("나의 팀"
// 즐겨찾기와 이벤트를 공유 - 어차피 둘 다 "구독 대상 팀 목록이 바뀌었다"는 같은 의미).
export function addNotifyTeams(teams) {
  const all = readAll();
  const existingIds = new Set(all.map((t) => t.id));
  const added = teams.filter((t) => !existingIds.has(t.id));
  if (added.length) {
    writeAll([...all, ...added]);
    window.dispatchEvent(new Event("favorites-changed"));
  }
  return added.length;
}

// teamIds(배열) - 리그 전체 알림 해제처럼 여러 팀을 한 번에 지울 때 쓴다.
export function removeNotifyTeams(teamIds) {
  const idSet = new Set(teamIds);
  writeAll(readAll().filter((t) => !idSet.has(t.id)));
  window.dispatchEvent(new Event("favorites-changed"));
}
