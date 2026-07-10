const STORAGE_KEY = "pitchpro.favoriteTeams";

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

export function toggleFavorite(team) {
  const all = readAll();
  const idx = all.findIndex((t) => t.id === team.id);
  if (idx >= 0) {
    all.splice(idx, 1);
  } else {
    all.push(team);
  }
  writeAll(all);
  return idx < 0;
}
