// 공식 순위표(API-Football standings)는 종료된 경기만 반영하기 때문에, 진행 중인 경기의 "지금 이 스코어가
// 그대로 끝난다면"을 가정한 승점/득실을 임시로 더해 화면에서만 실시간처럼 보여준다(저장하지 않음, 매 요청마다 계산).
const LIVE_STATUSES = new Set(["IN_PLAY", "PAUSED"]);

// K리그(KL1/KL2)는 경기 상태/스코어 보정과 순위표 보정이 kleague.com의 서로 다른 두 엔드포인트
// (getScheduleList - endYn, teamRank)에서 각자 refreshKLeagueResults.js 안에서 순차 조회되는데, 그
// 두 엔드포인트 자체가 kleague.com 쪽에서 서로 다른 타이밍에 갱신될 수 있다 - teamRank(순위표)가
// getScheduleList(경기 종료 여부)보다 먼저 그 경기를 "끝난 걸로" 반영해버리면, 우리 쪽은 아직
// IN_PLAY로 캐시된 상태라 여기서 승점을 한 번 더 더해 중복 반영된다(2026-07-30 화성FC(K리그2) 건 -
// 실시간 10승/33+3점으로 보였다가 경기 상태가 FINISHED로 바뀌자 다시 10승/34점으로 돌아옴). K3/K4
// (KFA 스크래퍼, 10분 주기)도 원리는 같아서 함께 적용한다. 킥오프로부터 이미 충분히 시간이 지난
// 경기는 상태를 못 믿고 라이브 보정 자체를 건너뛴다 - 그러면 최악의 경우도 "공식 순위표가 아직 못
// 따라간 잠깐 동안 원래 승점" 정도지, 중복 가산은 안 생긴다.
const MAX_LIVE_MATCH_AGE_MS = 130 * 60 * 1000;

function resultPoints(myGoals, oppGoals) {
  if (myGoals > oppGoals) return 3;
  if (myGoals === oppGoals) return 1;
  return 0;
}

export function applyLiveDeltas(table, matches, competitionCode) {
  const now = Date.now();
  const liveMatches = (matches || []).filter(
    (m) => LIVE_STATUSES.has(m.status) && m.competition.code === competitionCode && now - new Date(m.utcDate).getTime() < MAX_LIVE_MATCH_AGE_MS
  );
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
