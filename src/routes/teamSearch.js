import { json } from "../lib/http.js";
import { getJSON } from "../lib/kv.js";
import { KV_KEYS, findCompetition } from "../lib/config.js";

const MAX_RESULTS = 20;

// 회원가입 "최애팀 선택" 검색창용 - 이미 캐싱된 순위표(byCode)에서 팀 이름/약칭이 포함되는 팀을 찾는다.
// 대회별로 순위표를 캐싱해둔 걸 재사용하는 거라 별도 API 호출이 필요 없다.
export async function handleTeamSearch(request, env, url) {
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  if (q.length < 1) return json({ teams: [] });

  const standingsBlob = await getJSON(env, KV_KEYS.standings);
  const byCode = standingsBlob?.byCode || {};

  const seen = new Map();
  for (const [code, data] of Object.entries(byCode)) {
    const comp = findCompetition(code);
    for (const table of data.standings || []) {
      for (const row of table.table || []) {
        const team = row.team;
        if (!team || seen.has(team.id)) continue;
        const name = (team.name || "").toLowerCase();
        const shortName = (team.shortName || "").toLowerCase();
        if (!name.includes(q) && !shortName.includes(q)) continue;
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

  return json({ teams: [...seen.values()] });
}
