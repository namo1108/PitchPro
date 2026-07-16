// 공식 순위표(API-Football standings)는 종료된 경기만 반영하기 때문에, 진행 중인 경기의 "지금 이 스코어가
// 그대로 끝난다면"을 가정한 승점/득실을 임시로 더해 화면에서만 실시간처럼 보여준다(저장하지 않음, 매 요청마다 계산).
const LIVE_STATUSES = new Set(["IN_PLAY", "PAUSED"]);

function resultPoints(myGoals, oppGoals) {
  if (myGoals > oppGoals) return 3;
  if (myGoals === oppGoals) return 1;
  return 0;
}

export function applyLiveDeltas(table, matches, competitionCode) {
  const liveMatches = (matches || []).filter((m) => LIVE_STATUSES.has(m.status) && m.competition.code === competitionCode);
  if (!liveMatches.length || !table?.table?.length) return table;

  const rows = table.table.map((r) => ({ ...r, live: false, liveResult: null }));
  const rowById = new Map(rows.map((r) => [r.team.id, r]));

  for (const m of liveMatches) {
    const home = m.score.fullTime.home ?? 0;
    const away = m.score.fullTime.away ?? 0;
    const homeRow = rowById.get(m.homeTeam.id);
    const awayRow = rowById.get(m.awayTeam.id);
    if (!homeRow || !awayRow) continue;

    homeRow.points += resultPoints(home, away);
    awayRow.points += resultPoints(away, home);
    homeRow.playedGames += 1;
    awayRow.playedGames += 1;
    homeRow.goalDifference += home - away;
    awayRow.goalDifference += away - home;
    if (home > away) {
      homeRow.won += 1;
      awayRow.lost += 1;
      homeRow.liveResult = "win";
      awayRow.liveResult = "loss";
    } else if (home < away) {
      awayRow.won += 1;
      homeRow.lost += 1;
      homeRow.liveResult = "loss";
      awayRow.liveResult = "win";
    } else {
      homeRow.draw += 1;
      awayRow.draw += 1;
      homeRow.liveResult = "draw";
      awayRow.liveResult = "draw";
    }
    homeRow.live = true;
    awayRow.live = true;
  }

  rows.sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference);
  rows.forEach((r, i) => {
    r.position = i + 1;
  });

  return { ...table, table: rows };
}
