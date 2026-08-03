import { json } from "../lib/http.js";
import { getJSON } from "../lib/kv.js";
import { KV_KEYS, findCompetition } from "../lib/config.js";
import { matchesKoreanAlias } from "../lib/teamAliases.js";
import { koreanizeTeam } from "../adapters/apiFootballAdapter.js";

const MAX_RESULTS = 20;

// 회원가입 "최애팀 선택" 검색창용 - 이미 캐싱된 순위표(byCode)에서 팀 이름/약칭이 포함되는 팀을 찾는다.
// 대회별로 순위표를 캐싱해둔 걸 재사용하는 거라 별도 API 호출이 필요 없다.
export async function handleTeamSearch(request, env, url) {
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  if (q.length < 1) return json({ teams: [] });

  const [standingsBlob, nationalBlob] = await Promise.all([getJSON(env, KV_KEYS.standings), getJSON(env, KV_KEYS.nationalTeams)]);
  const byCode = standingsBlob?.byCode || {};

  const seen = new Map();
  for (const [code, data] of Object.entries(byCode)) {
    const comp = findCompetition(code);
    for (const table of data.standings || []) {
      for (const row of table.table || []) {
        // 순위표 캐시가 재갱신되기 전까지 예전(영문) 팀명을 들고 있을 수 있어 검색 전에 다시 보정한다.
        const team = koreanizeTeam(row.team);
        if (!team || seen.has(team.id)) continue;
        const name = (team.name || "").toLowerCase();
        const shortName = (team.shortName || "").toLowerCase();
        const matches = name.includes(q) || shortName.includes(q) || matchesKoreanAlias(q, team.name, team.shortName);
        if (!matches) continue;
        seen.set(team.id, {
          id: team.id,
          name: team.name,
          shortName: team.shortName || null,
          crest: team.crest || null,
          competitionName: comp?.name || code,
        });
        if (seen.size >= MAX_RESULTS) break;
      }
      if (seen.size >= MAX_RESULTS) break;
    }
    if (seen.size >= MAX_RESULTS) break;
  }

  // 국가대표팀은 순위표가 없어 위 클럽 검색에 안 걸리니, 캐싱해둔 대표팀 명단에서 따로 찾아 뒤에 덧붙인다.
  for (const team of nationalBlob?.teams || []) {
    if (seen.size >= MAX_RESULTS) break;
    if (seen.has(team.id)) continue;
    const name = (team.name || "").toLowerCase();
    const matches = name.includes(q) || matchesKoreanAlias(q, team.name, team.shortName);
    if (!matches) continue;
    seen.set(team.id, { id: team.id, name: team.name, shortName: team.shortName || null, crest: team.crest || null, competitionName: "국가대표" });
  }

  return json({ teams: [...seen.values()] });
}
