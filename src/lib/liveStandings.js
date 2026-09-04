// 공식 순위표(API-Football standings)는 종료된 경기만 반영한다 - 원래는 진행 중인 경기의 "지금 이
// 스코어가 그대로 끝난다면"을 가정해서 승점/득실까지 미리 반영해봤는데(2026-08 여러 날에 걸쳐 만듦),
// 실제로 K리그 공식 사이트와 나란히 비교해보니(2026-09-04, 사용자가 kleague.com 캡처 대조) "이기고
// 있어도 아직 45점이어야지 48점은 이상하다"는 반응이었다 - 경기가 실제로 안 끝났으면 승점은 공식
// 사이트와 항상 똑같아야 한다는 게 최종 결론. 그래서 승점/득실/득점/경기수/승무패는 전부 손대지
// 않고, 오직 "이 팀이 지금 뛰고 있고 현재 스코어 기준 이기는지/비기는지/지는지"만 점(live-dot) 색으로
// 알려주는 용도로만 라이브 정보를 쓴다 - 순위표 자체의 숫자는 항상 공식 확정 기록 그대로다.
const LIVE_STATUSES = new Set(["IN_PLAY", "PAUSED"]);

// 킥오프로부터 이미 충분히 시간이 지난 경기는 상태 갱신이 늦은 것으로 보고 라이브 점 표시 자체를
// 건너뛴다(90분+하프타임 15분+추가시간 감안한 여유, 2026-09-04 확인 - 105분으로 너무 좁혔다가 정상
// 경기가 걸린 적 있어 130분으로 되돌림).
const MAX_LIVE_MATCH_AGE_MS = 130 * 60 * 1000;

// 진행 중인 경기가 있으면 그 두 팀 행에 live/liveResult만 표시해준다("지금 이기는 중/비기는 중/
// 지는 중"을 점 색으로) - 승점/득실/경기수 등 순위표 숫자 자체는 전혀 건드리지 않는다(위 파일
// 상단 주석 참고, 2026-09-04 사용자 확인).
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

  return { ...table, table: rows };
}
