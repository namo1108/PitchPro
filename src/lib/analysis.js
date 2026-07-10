// 외부 API 호출 없이, 이미 캐시된 경기/순위 데이터만으로 규칙 기반 문장을 만든다.

function formLetter(myGoals, oppGoals) {
  if (myGoals === null || myGoals === undefined) return null;
  if (myGoals > oppGoals) return "W";
  if (myGoals < oppGoals) return "L";
  return "D";
}

function teamForm(recentMatches, teamId) {
  return recentMatches
    .map((m) => {
      const isHome = m.homeTeam.id === teamId;
      const my = isHome ? m.score.fullTime.home : m.score.fullTime.away;
      const opp = isHome ? m.score.fullTime.away : m.score.fullTime.home;
      return formLetter(my, opp);
    })
    .filter(Boolean);
}

function summarizeForm(letters) {
  const wins = letters.filter((l) => l === "W").length;
  const draws = letters.filter((l) => l === "D").length;
  const losses = letters.filter((l) => l === "L").length;
  return { wins, draws, losses, letters };
}

function formPhrase(name, summary) {
  if (!summary.letters.length) return `${name}은(는) 최근 경기 기록이 없습니다.`;
  const { wins, draws, losses } = summary;
  const tone = wins >= 3 ? "좋은 폼" : losses >= 3 ? "부진한 폼" : "기복 있는 폼";
  return `${name} 최근 ${summary.letters.length}경기 ${wins}승 ${draws}무 ${losses}패로 ${tone}을 보이고 있습니다.`;
}

function standingsPhrase(name, position, total) {
  if (!position) return null;
  if (position <= 4) return `${name}은(는) 현재 ${position}위로 상위권입니다.`;
  if (position > total - 3) return `${name}은(는) 현재 ${position}위로 강등권에 근접해 있습니다.`;
  return `${name}은(는) 현재 ${position}위입니다.`;
}

function findPosition(standingsTable, teamId) {
  const table = standingsTable?.table || [];
  const row = table.find((r) => r.team.id === teamId);
  return row ? { position: row.position, total: table.length } : null;
}

// match: canonical match object, teamRecents: {[teamId]: recentMatches[]}, standingsTable: {table:[...]}|null
export function buildMatchAnalysis(match, teamRecents, standingsTable) {
  const homeName = match.homeTeam.shortName || match.homeTeam.name;
  const awayName = match.awayTeam.shortName || match.awayTeam.name;

  const homeForm = summarizeForm(teamForm(teamRecents[match.homeTeam.id] || [], match.homeTeam.id));
  const awayForm = summarizeForm(teamForm(teamRecents[match.awayTeam.id] || [], match.awayTeam.id));

  const sentences = [formPhrase(homeName, homeForm), formPhrase(awayName, awayForm)];

  const homePos = findPosition(standingsTable, match.homeTeam.id);
  const awayPos = findPosition(standingsTable, match.awayTeam.id);
  const homeStandingPhrase = homePos && standingsPhrase(homeName, homePos.position, homePos.total);
  const awayStandingPhrase = awayPos && standingsPhrase(awayName, awayPos.position, awayPos.total);
  if (homeStandingPhrase) sentences.push(homeStandingPhrase);
  if (awayStandingPhrase) sentences.push(awayStandingPhrase);

  let lean = "박빙";
  const score = homeForm.wins - homeForm.losses - (awayForm.wins - awayForm.losses);
  if (score >= 2) lean = homeName;
  else if (score <= -2) lean = awayName;
  sentences.push(`요약하면 이번 경기는 ${lean} 쪽으로 무게가 실립니다.`);

  return {
    matchId: match.id,
    competition: match.competition,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    utcDate: match.utcDate,
    summary: sentences.join(" "),
  };
}
