// 실제로 지금 진행 중이거나(라이브) 곧 시작할(킥오프 5분 전 이내) 경기가 하나라도 있으면 "활성 시간대"로 본다.
// matches/standings 크론이 공통으로 써서, 조용한 시간대엔 API 호출 자체를 건너뛰고 API-Football 일일 요청
// 한도를 아낀다(직전에 성공적으로 받아온 목록 기준이라 이 판단 자체는 API 호출 없이 공짜로 계산된다).
const IMMINENT_KICKOFF_MS = 5 * 60 * 1000;
// 연장/승부차기까지 감안한 넉넉한 경기 지속시간 - "이 시점을 넘겼는데도 여전히 IN_PLAY/PAUSED로
// 보이면 갱신이 멈춘 것"으로 보는 기준으로도 재사용한다(routes/matches.js의 dataStale 판정).
export const MATCH_DURATION_BUFFER_MS = 150 * 60 * 1000;
// 경기가 막 끝난 뒤에도 순위(승점) 반영을 위해 한 번 더 갱신해야 하는데, 그 시점에 전체 대회 중
// 진행/임박 경기가 하나도 없으면(조용한 시간대로 판단) 순위 갱신이 최대 1시간까지 밀릴 수 있었다.
// 그래서 "막 끝난" 경기도 이 시간 동안은 "활성"으로 쳐서 순위가 바로 갱신되게 한다.
const RECENTLY_FINISHED_MS = 20 * 60 * 1000;

// 클럽 친선경기(FRIENDLY)/국가대표 친선경기(INTFRIENDLY)는 전 세계 시간대에 걸쳐 하루 종일 산발적으로
// 열려서, 이걸 포함해서 "활성 시간대"를 판단하면 사실상 거의 항상 true가 되어 대회 전체를 매분 훑는
// 비싼 작업(refreshApiFootballMatches)이 하루 종일 쉬지 않고 돈다 - 정작 K리그/5대리그 저녁 경기
// 시간대에 쓸 API-Football 쿼터가 오전 중에 이미 바닥나는 사고로 이어졌다(2026-07-22 확인).
// 친선경기의 스코어 자체는 이 판단과 무관하게 pollLiveMatches(가벼운 live=all 호출 1번)가 이미
// 캐시의 IN_PLAY 여부만 보고 독립적으로 처리하므로, 여기서 제외해도 친선경기 라이브 갱신엔 영향 없다.
const ACTIVITY_CHECK_EXCLUDED_CODES = new Set(["FRIENDLY", "INTFRIENDLY"]);
function isRelevantForActivityCheck(m) {
  return !ACTIVITY_CHECK_EXCLUDED_CODES.has(m.competition?.code);
}

export function hasLiveOrImminentMatches(matches) {
  const now = Date.now();
  return matches.filter(isRelevantForActivityCheck).some((m) => {
    if (m.status === "IN_PLAY" || m.status === "PAUSED") return true;
    // TIME_TBD(친선경기 등 킥오프 미확정)는 utcDate 자체가 신뢰할 수 없는 값이라, 이 시각 기준
    // 로직(임박/직후 판단)에 넣으면 오히려 잘못된 타이밍에 갱신을 트리거할 수 있어 제외한다.
    if (!["SCHEDULED", "TIMED", "FINISHED"].includes(m.status)) return false;
    const kickoff = new Date(m.utcDate).getTime();
    const upperBound = kickoff + MATCH_DURATION_BUFFER_MS + (m.status === "FINISHED" ? RECENTLY_FINISHED_MS : 0);
    return kickoff - IMMINENT_KICKOFF_MS <= now && now <= upperBound;
  });
}
