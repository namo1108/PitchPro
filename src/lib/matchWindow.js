// 실제로 지금 진행 중이거나(라이브) 곧 시작할(킥오프 5분 전 이내) 경기가 하나라도 있으면 "활성 시간대"로 본다.
// matches/standings 크론이 공통으로 써서, 조용한 시간대엔 API 호출 자체를 건너뛰고 API-Football 일일 요청
// 한도를 아낀다(직전에 성공적으로 받아온 목록 기준이라 이 판단 자체는 API 호출 없이 공짜로 계산된다).
const IMMINENT_KICKOFF_MS = 5 * 60 * 1000;
const MATCH_DURATION_BUFFER_MS = 150 * 60 * 1000; // 연장/승부차기까지 감안한 넉넉한 경기 지속시간
// 경기가 막 끝난 뒤에도 순위(승점) 반영을 위해 한 번 더 갱신해야 하는데, 그 시점에 전체 대회 중
// 진행/임박 경기가 하나도 없으면(조용한 시간대로 판단) 순위 갱신이 최대 1시간까지 밀릴 수 있었다.
// 그래서 "막 끝난" 경기도 이 시간 동안은 "활성"으로 쳐서 순위가 바로 갱신되게 한다.
const RECENTLY_FINISHED_MS = 20 * 60 * 1000;

export function hasLiveOrImminentMatches(matches) {
  const now = Date.now();
  return matches.some((m) => {
    if (m.status === "IN_PLAY" || m.status === "PAUSED") return true;
    // TIME_TBD(친선경기 등 킥오프 미확정)는 utcDate 자체가 신뢰할 수 없는 값이라, 이 시각 기준
    // 로직(임박/직후 판단)에 넣으면 오히려 잘못된 타이밍에 갱신을 트리거할 수 있어 제외한다.
    if (!["SCHEDULED", "TIMED", "FINISHED"].includes(m.status)) return false;
    const kickoff = new Date(m.utcDate).getTime();
    const upperBound = kickoff + MATCH_DURATION_BUFFER_MS + (m.status === "FINISHED" ? RECENTLY_FINISHED_MS : 0);
    return kickoff - IMMINENT_KICKOFF_MS <= now && now <= upperBound;
  });
}
