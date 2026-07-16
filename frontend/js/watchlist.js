const STORAGE_KEY = "pitchpro.watchedMatches";

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

export function isWatched(matchId) {
  return readAll().includes(matchId);
}

// localStorage 상태를 뒤집고, 이제 감시 중인지(true/false)를 반환한다.
export function toggleWatch(matchId) {
  const all = readAll();
  const idx = all.indexOf(matchId);
  if (idx >= 0) {
    all.splice(idx, 1);
  } else {
    all.push(matchId);
  }
  writeAll(all);
  return idx < 0;
}
