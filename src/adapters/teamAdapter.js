export function normalizePlayer(raw) {
  return {
    id: raw.idPlayer,
    name: raw.strPlayer,
    position: raw.strPosition || null,
    nationality: raw.strNationality || null,
    number: raw.strNumber || null,
    photo: raw.strThumb || raw.strCutout || null,
  };
}

export function normalizeTeamInfoFD(raw) {
  return {
    id: `fd:${raw.id}`,
    name: raw.name,
    shortName: raw.shortName,
    crest: raw.crest,
    venue: raw.venue || null,
  };
}

export function normalizeTeamInfoTSDB(raw) {
  return {
    id: `kl:${raw.idTeam}`,
    name: raw.strTeam,
    shortName: raw.strTeam,
    crest: raw.strBadge,
    venue: raw.strStadium || null,
  };
}
