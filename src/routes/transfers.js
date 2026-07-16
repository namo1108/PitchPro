import { json } from "../lib/http.js";
import { getJSON } from "../lib/kv.js";
import { KV_KEYS, transferMarketCompetitions } from "../lib/config.js";

// 팀별로 구분해서 보여줄 거라, 같은 리그 안 이적이 양쪽 팀 관점(영입 쪽/방출 쪽)에서 각각 한 번씩
// 나오는 건 자연스러운 중복이라 걸러내지 않는다(예: A팀 방출 목록에도, B팀 영입 목록에도 같은 건이 뜸).
export async function handleTransfers(request, env) {
  const blob = await getJSON(env, KV_KEYS.transferMarket);
  const byTeam = blob?.byTeam || {};

  const byCompetition = new Map();
  for (const team of Object.values(byTeam)) {
    if (!team.transfers?.length) continue;
    if (!byCompetition.has(team.competitionCode)) byCompetition.set(team.competitionCode, []);
    byCompetition.get(team.competitionCode).push({
      teamId: team.teamId,
      teamName: team.teamName,
      items: team.transfers.slice().sort((a, b) => new Date(b.date) - new Date(a.date)),
    });
  }

  const leagues = transferMarketCompetitions()
    .map((comp) => {
      const teams = (byCompetition.get(comp.code) || []).sort((a, b) => a.teamName.localeCompare(b.teamName));
      const totalItems = teams.reduce((sum, t) => sum + t.items.length, 0);
      return { code: comp.code, name: comp.name, emblem: comp.emblem, teams, totalItems };
    })
    .filter((l) => l.teams.length > 0);

  return json({ leagues, lastUpdated: blob?.lastUpdated || null });
}
