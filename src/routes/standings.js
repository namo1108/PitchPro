import { json } from "../lib/http.js";
import { getJSON } from "../lib/kv.js";
import { KV_KEYS, findCompetition } from "../lib/config.js";
import { applyLiveDeltas } from "../lib/liveStandings.js";
import { koreanizeTeam } from "../adapters/apiFootballAdapter.js";

// 팀 한글명 매핑을 나중에 추가/수정해도, 크론이 다시 갱신하기 전까지 KV에 예전 이름으로 남아있을 수
// 있는 순위표 캐시(API 한도 초과 등으로 특히 오래 걸릴 수 있음)를 응답 직전에 한 번 더 보정한다.
function reKoreanizeTable(table) {
  return (table || []).map((row) => ({ ...row, team: koreanizeTeam(row.team) }));
}

// 순위 시나리오 시뮬레이터(2026-11-10 추가)용 - 남은(아직 안 끝난) 일정만 가볍게 추려서 같이 내려준다.
// 어차피 handleStandings가 matchesBlob 전체를 이미 메모리에 들고 있어서 API 호출이 추가로 들지 않는다 -
// 프론트가 이 목록에서 사용자가 스코어를 찍으면 브라우저 안에서만 순위표를 재계산한다(서버 왕복 없음).
const OPEN_STATUSES = new Set(["SCHEDULED", "TIME_TBD"]);
function remainingFixturesFor(matches, code) {
  return (matches || [])
    .filter((m) => m.competition.code === code && OPEN_STATUSES.has(m.status))
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
    .map((m) => ({
      id: m.id,
      utcDate: m.utcDate,
      matchday: m.matchday,
      homeTeam: koreanizeTeam(m.homeTeam),
      awayTeam: koreanizeTeam(m.awayTeam),
    }));
}

export async function handleStandings(request, env, code) {
  const comp = findCompetition(code);
  if (!comp) return json({ detail: "알 수 없는 대회 코드" }, 404);

  const [standingsBlob, matchesBlob] = await Promise.all([getJSON(env, KV_KEYS.standings), getJSON(env, KV_KEYS.matches)]);
  const data = standingsBlob?.byCode?.[code];
  const remainingFixtures = remainingFixturesFor(matchesBlob?.matches, code);
  if (!data) return json({ standings: [], remainingFixtures });

  const withLive = {
    ...data,
    standings: (data.standings || []).map((t) => applyLiveDeltas({ ...t, table: reKoreanizeTable(t.table) }, matchesBlob?.matches, code)),
    remainingFixtures,
  };
  return json(withLive);
}
