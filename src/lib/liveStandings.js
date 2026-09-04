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
// 2026-08-29 재발(같은 화성FC 건, 24경기로 표시) - 130분으로도 이 경쟁을 다 못 막아서 105분으로
// 한 번 좁혔었는데, 2026-09-04에 K리그2 정상 경기(87분째, 킥오프 후 109분 경과)가 이 105분 컷에
// 걸려 라이브 보정 자체가 꺼지면서 실시간 반짝이는 표시까지 같이 사라지는 부작용이 났다 - 90분+
// 하프타임 15분만 더해도 105분이라, 추가시간이 조금만 붙어도(흔한 일) 여유가 없었다. 더블카운트
// 자체는 이제 detectGoalsAndNotify.js의 K3/K4 3틱 확정으로 따로 막고 있으니, 여기는 다시 130분으로
// 되돌려 정상 경기를 오탐으로 끄는 일이 없게 한다.
const MAX_LIVE_MATCH_AGE_MS = 130 * 60 * 1000;

// K리그(KL1/KL2)는 승점이 같을 때 골득실보다 다득점(총 득점)을 먼저 본다 - 골득실을 먼저 보는
// 유럽 리그들과 다른 K리그만의 순위 규정이다(사용자 확인, 2026-08-08). 이 차이를 반영하지 않으면
// 라이브 경기 중 임시 순위가 실제 K리그 규정과 다르게 나올 수 있다(예: 화성FC가 4위가 아니라
// 5위여야 하는데 골득실 기준으로만 정렬해 4위로 잘못 표시된 사례).
const GOALS_BEFORE_DIFF_CODES = new Set(["KL1", "KL2"]);

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

    // 경기수(playedGames)와 승/무/패는 안 늘린다 - 아직 안 끝난 경기라 "몇 경기를 이겼/비겼/졌는지"는
    // 실제로 그대로다. 예전엔 이 넷(경기수/승/무/패)을 승점/득실과 함께 다 같이 +1 했는데, 경기수만
    // 먼저 고쳤더니(2026-09-04) 이번엔 승+무+패 합이 경기수보다 하나 많아지는 새 불일치가 생겼다
    // (예: 24경기인데 14승+6무+5패=25) - 승점/득실/득점만 "지금 스코어 그대로 끝난다면"이라는 가정을
    // 보여주는 실시간 지표로 남기고, 경기수/승/무/패는 전부 아직 사실 그대로(확정된 기록)를 유지한다.
    homeRow.points += resultPoints(home, away);
    awayRow.points += resultPoints(away, home);
    homeRow.goalDifference += home - away;
    awayRow.goalDifference += away - home;
    homeRow.goalsFor = (homeRow.goalsFor ?? 0) + home;
    homeRow.goalsAgainst = (homeRow.goalsAgainst ?? 0) + away;
    awayRow.goalsFor = (awayRow.goalsFor ?? 0) + away;
    awayRow.goalsAgainst = (awayRow.goalsAgainst ?? 0) + home;
    if (home > away) {
      homeRow.liveResult = "win";
      awayRow.liveResult = "loss";
    } else if (home < away) {
      homeRow.liveResult = "loss";
      awayRow.liveResult = "win";
    } else {
      homeRow.liveResult = "draw";
      awayRow.liveResult = "draw";
    }
    homeRow.live = true;
    awayRow.live = true;
  }

  const tiebreak = GOALS_BEFORE_DIFF_CODES.has(competitionCode)
    ? (a, b) => b.points - a.points || (b.goalsFor ?? 0) - (a.goalsFor ?? 0) || b.goalDifference - a.goalDifference
    : (a, b) => b.points - a.points || b.goalDifference - a.goalDifference;
  rows.sort(tiebreak);
  rows.forEach((r, i) => {
    r.position = i + 1;
  });

  return { ...table, table: rows };
}
