import * as apiFootball from "../sources/apiFootball.js";
import { putJSON } from "../lib/kv.js";
import { KV_KEYS, findCompetition } from "../lib/config.js";

// 유소년(U15~U23)/여자대표팀( ...W")은 팀 검색 결과를 어지럽히니 제외하고 성인 남자 대표팀만 남긴다.
const EXCLUDED_NAME_PATTERN = /U1[5-9]|U2[0-3]| W$/;

// 국가대표팀은 리그처럼 순위표가 없어 지금까지 팀 검색(teamSearch.js)이 훑는 "순위표 캐시"에 아예
// 안 잡혔다. league=10(Friendlies) 시즌 참가팀 목록을 한 번의 호출로 받아오면 전 세계 대표팀이
// 거의 다 걸리므로, 이걸 그대로 캐싱해 검색 때 병합한다. 국가대표팀 명단은 사실상 거의 안 바뀌는
// 데이터라 크론 주기를 하루 단위로 넉넉하게 잡아도 충분하다(scheduled/index.js에서 게이팅).
export async function refreshNationalTeams(env) {
  const comp = findCompetition("INTFRIENDLY");
  if (!comp) return;

  try {
    const raw = await apiFootball.getTeamsByLeague(env, comp.apiFootballLeagueId, comp.apiFootballSeason, { retries: 1 });
    const teams = (raw.response || [])
      .map((entry) => entry.team)
      .filter((team) => team?.national && !EXCLUDED_NAME_PATTERN.test(team.name || ""))
      .map((team) => ({ id: String(team.id), name: team.name, shortName: team.name, crest: team.logo || null, country: team.country || null }));

    await putJSON(env, KV_KEYS.nationalTeams, { teams, lastUpdated: new Date().toISOString() });
  } catch (err) {
    console.error("national teams refresh failed:", err);
  }
}
