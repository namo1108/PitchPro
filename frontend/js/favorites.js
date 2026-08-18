const STORAGE_KEY = "pitchpro.favoriteTeams";
// 2026-08-17 사용자 요청 - "나의 팀"은 최대 2개까지만, 국가대표팀은 아예 포함할 수 없게 한다.
export const MAX_FAVORITES = 2;

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

export function listFavorites() {
  return readAll();
}

export function isFavorite(teamId) {
  return readAll().some((t) => t.id === teamId);
}

// team.isNational(팀 상세 조회 결과) 또는 team.competitionName === "국가대표"(팀 검색 결과, 둘 중
// 어느 화면에서 왔는지에 따라 필드가 다름) 둘 다 확인해서 국가대표팀을 걸러낸다.
function isNationalTeam(team) {
  return !!team.isNational || team.competitionName === "국가대표";
}

// 반환값: { favorited: boolean, blocked: "national" | "limit" | null }
// blocked가 있으면 favorited는 항상 false(추가가 안 된 것) - 호출부는 blocked를 보고 안내 문구를 띄운다.
export function toggleFavorite(team) {
  const all = readAll();
  const idx = all.findIndex((t) => t.id === team.id);

  if (idx >= 0) {
    all.splice(idx, 1);
    writeAll(all);
    window.dispatchEvent(new Event("favorites-changed"));
    return { favorited: false, blocked: null };
  }

  if (isNationalTeam(team)) {
    return { favorited: false, blocked: "national" };
  }
  if (all.length >= MAX_FAVORITES) {
    return { favorited: false, blocked: "limit" };
  }

  all.push(team);
  writeAll(all);
  window.dispatchEvent(new Event("favorites-changed"));
  return { favorited: true, blocked: null };
}
