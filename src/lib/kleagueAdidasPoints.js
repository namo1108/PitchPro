import { getJSON } from "./kv.js";
import { KV_KEYS } from "./config.js";
import { matchesKoreanAlias } from "./teamAliases.js";

const POSITION_LABEL = { GK: "골키퍼", DF: "수비수", MF: "미드필더", FW: "공격수" };

// 스크랩된 선수 목록(한글 클럽명)에서 이 팀(영문 name/shortName) 소속 중 포인트가 가장 높은 선수를 찾는다.
// teamAliases.js의 한/영 별칭 매칭을 그대로 재사용한다(팀 검색과 같은 로직).
export function findTeamAdidasPoint(players, team) {
  if (!players?.length || !team) return null;
  const match = players.find((p) => matchesKoreanAlias(p.club, team.name, team.shortName));
  if (!match) return null;
  return { ...match, positionLabel: POSITION_LABEL[match.position] || match.position };
}

export async function getAdidasPointsByCode(env, code) {
  const blob = await getJSON(env, KV_KEYS.kleagueAdidasPoints);
  return blob?.byCode?.[code] || null;
}
