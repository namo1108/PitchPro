import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import { notifyMatchEvents } from "./notifyMatchEvents.js";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// K리그 공식 사이트(kleague.com)의 팀 코드(K01, K21 등, /getScheduleList.do 응답의 homeTeam/awayTeam
// 값) -> 우리가 쓰는 API-Football 숫자 팀 id. kleague.com은 API-Football과 완전히 무관한 별도
// 공식 소스라, API-Football 일일 쿼터가 소진돼도(2026-07-21 사고 참고) 이 경로로는 K리그 최종
// 스코어가 계속 들어온다. clubList(getClubListByYear.do)에서 teamId/teamNameShort로 직접 확인한 값.
export const KLEAGUE_SITE_TEAM_ID_TO_APIFOOTBALL_ID = {
  // K리그1
  K21: "2746", // 강원FC
  K22: "2759", // 광주FC
  K35: "2768", // 김천 상무
  K10: "2750", // 대전 하나 시티즌
  K26: "2745", // 부천FC1995
  K09: "2766", // FC서울
  K27: "2748", // FC안양
  K01: "2767", // 울산HD
  K18: "2763", // 인천Utd
  K05: "2762", // 전북현대
  K04: "2761", // 제주SK
  K03: "2764", // 포항스틸러스
  // K리그2
  K20: "2751", // 경남FC
  K36: "7078", // 김포FC
  K41: "7076", // 김해FC
  K17: "2747", // 대구FC
  K06: "2752", // 부산아이파크
  K31: "2749", // 서울이랜드
  K08: "2757", // 성남FC
  K02: "2765", // 수원삼성
  K29: "2756", // 수원FC
  K32: "2758", // 안산그리너스
  K42: "9171", // 용인FC
  K07: "2760", // 전남드래곤즈
  K38: "7060", // 천안시티FC
  K34: "2753", // 충남아산FC
  K37: "7061", // 충북청주FC
  K40: "7098", // 파주(프런티어)FC
  K39: "7087", // 화성FC
};

const LEAGUES = [
  { leagueId: 1, code: "KL1" },
  { leagueId: 2, code: "KL2" },
];

function toKstDateString(utcIso) {
  return new Date(new Date(utcIso).getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

async function fetchScheduleList(leagueId, year, month) {
  const res = await fetch("https://www.kleague.com/getScheduleList.do", {
    method: "POST",
    headers: { "content-type": "application/json", "User-Agent": "Mozilla/5.0 (compatible; PitchProBot/1.0)" },
    body: JSON.stringify({ leagueId: String(leagueId), teamId: "", year: String(year), month, ticketYn: "" }),
  });
  if (!res.ok) throw new Error(`kleague schedule fetch failed: ${res.status}`);
  const data = await res.json();
  return data?.data?.scheduleList || [];
}

export async function fetchTeamRank(leagueId, year) {
  const url = `https://www.kleague.com/record/teamRank.do?leagueId=${leagueId}&year=${year}&stadium=all&recordType=rank`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; PitchProBot/1.0)" } });
  if (!res.ok) throw new Error(`kleague teamRank fetch failed: ${res.status}`);
  const data = await res.json();
  return data?.data?.teamRank || [];
}

// 순위(승점/경기수/승무패/득실차)도 매치 결과와 같은 이유(API-Football 쿼터 소진)로 며칠씩 안 갱신될
// 수 있다 - 경기 스코어는 보정됐는데 순위표만 예전 라운드에 멈춰있으면 오히려 더 헷갈리므로 같이 고친다.
// 팀 메타(이름/엠블럼)는 손대지 않고 숫자 통계만 공식 사이트 값으로 덮어써서, 크레스트 재구성 같은
// 부가 로직 없이 안전하게 patch한다.
//
// 주의: 예전엔 "이 팀 승점/경기수가 그대로면 건너뛴다"는 최적화가 있었는데, 그 팀이 오늘 경기를
// 안 뛰었어도 다른 팀들 결과 때문에 등수(position)는 바뀔 수 있어서, 일부 팀만 새 등수로 갱신되고
// 나머지는 예전 등수 그대로 남아 등수가 뒤섞이는 버그가 있었다(2026-07-22, 6위가 두 팀 겹침).
// 그래서 매치된 팀은 조건 없이 항상 전부 갱신하고, 최종적으로 "승점 -> 득실차" 기준으로 직접
// 재정렬해서 kleague의 rank 필드를 신뢰하는 대신 우리가 항상 승점순을 보장한다.
async function refreshKLeagueStandings(env) {
  const now = new Date(Date.now() + KST_OFFSET_MS);
  const year = now.getUTCFullYear();

  const standingsBlob = await getJSON(env, KV_KEYS.standings);
  if (!standingsBlob?.byCode) return;

  const before = JSON.stringify(standingsBlob.byCode);

  for (const { leagueId, code } of LEAGUES) {
    const table = standingsBlob.byCode[code]?.standings?.[0]?.table;
    if (!table?.length) continue;

    let teamRank;
    try {
      teamRank = await fetchTeamRank(leagueId, year);
    } catch (err) {
      console.error(`kleague teamRank fetch failed for ${code}:`, err);
      continue;
    }

    const rankByApiFootballId = new Map();
    for (const r of teamRank) {
      const apiFootballId = KLEAGUE_SITE_TEAM_ID_TO_APIFOOTBALL_ID[r.teamId];
      if (apiFootballId) rankByApiFootballId.set(apiFootballId, r);
    }

    for (const row of table) {
      const r = rankByApiFootballId.get(String(row.team.id));
      if (!r) continue;

      row.playedGames = r.gameCount;
      row.won = r.winCnt;
      row.draw = r.tieCnt;
      row.lost = r.lossCnt;
      row.points = r.gainPoint;
      row.goalsFor = r.gainGoal;
      row.goalsAgainst = r.lossGoal;
      row.goalDifference = r.gapCnt;
    }

    // 승점 -> 득실차 순으로 정렬(표준 축구 순위 규칙)하고, 등수는 그 결과 그대로 다시 매긴다.
    table.sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference);
    table.forEach((row, i) => {
      row.position = i + 1;
    });
  }

  if (JSON.stringify(standingsBlob.byCode) === before) return;
  standingsBlob.lastUpdated = new Date().toISOString();
  await putJSON(env, KV_KEYS.standings, standingsBlob);
  console.log("kleague 순위 보정 반영");
}

// API-Football 쪽 갱신이 멈추거나(쿼터 소진 등) 느려도, K리그만큼은 공식 사이트의 "끝난 경기(endYn=Y)"
// 결과로 최종 스코어/상태를 맞춰준다. 공식 사이트는 분 단위 진행 상황(현재 몇 분인지, 득점자)까지는
// 안 주기 때문에 진행 중 경기를 실시간으로 흉내내진 않고, "끝났는데 우리 캐시엔 아직 안 끝난 걸로
// 나오는" 경우만 최종 스코어로 보정한다 - 그 정도만으로도 "먹통" 상태(경기가 끝나도 그대로 멈춰
// 보이는 문제)는 해결된다.
export async function refreshKLeagueResults(env) {
  const now = new Date(Date.now() + KST_OFFSET_MS);
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");

  const blob = await getJSON(env, KV_KEYS.matches);
  if (!blob?.matches?.length) return;

  // pendingByKey: 아직 안 끝난 걸로 캐시된 경기만(스코어 보정 대상). allByKey: 끝났든 안 끝났든
  // K리그 전체(매치센터 폴백용 kleague gameId 매핑 대상 - 이미 끝난 경기의 상세 페이지를 나중에
  // 열어봐도 골/라인업/통계를 보여줘야 하니 FINISHED도 매핑은 계속 갱신해둔다).
  const pendingByKey = new Map();
  const allByKey = new Map();
  for (const m of blob.matches) {
    if (m.competition.code !== "KL1" && m.competition.code !== "KL2") continue;
    const key = `${m.competition.code}:${m.homeTeam.id}:${m.awayTeam.id}:${toKstDateString(m.utcDate)}`;
    allByKey.set(key, m);
    if (m.status !== "FINISHED") pendingByKey.set(key, m);
  }
  if (!allByKey.size) return;

  const gameRefs = (await getJSON(env, KV_KEYS.kleagueGameRefs)) || {};
  let refsChanged = false;
  let scoresChanged = false;

  for (const { leagueId, code } of LEAGUES) {
    let schedule;
    try {
      schedule = await fetchScheduleList(leagueId, year, month);
    } catch (err) {
      console.error(`kleague schedule fetch failed for ${code}:`, err);
      continue;
    }

    for (const g of schedule) {
      const homeId = KLEAGUE_SITE_TEAM_ID_TO_APIFOOTBALL_ID[g.homeTeam];
      const awayId = KLEAGUE_SITE_TEAM_ID_TO_APIFOOTBALL_ID[g.awayTeam];
      if (!homeId || !awayId) continue;
      const key = `${code}:${homeId}:${awayId}:${g.gameDate.replace(/\./g, "-")}`;

      const matched = allByKey.get(key);
      if (matched) {
        const ref = { year: g.year, leagueId: g.leagueId, gameId: g.gameId, meetSeq: g.meetSeq };
        if (JSON.stringify(gameRefs[matched.id]) !== JSON.stringify(ref)) {
          gameRefs[matched.id] = ref;
          refsChanged = true;
        }
      }

      if (g.endYn !== "Y" || typeof g.homeGoal !== "number" || typeof g.awayGoal !== "number") continue;
      const cached = pendingByKey.get(key);
      if (!cached) continue;

      cached.status = "FINISHED";
      cached.score = { ...cached.score, fullTime: { home: g.homeGoal, away: g.awayGoal } };
      scoresChanged = true;
      console.log(`kleague fallback 반영: ${code} ${g.homeTeamName} ${g.homeGoal}-${g.awayGoal} ${g.awayTeamName}`);
    }
  }

  if (refsChanged) {
    await putJSON(env, KV_KEYS.kleagueGameRefs, gameRefs);
  }

  if (scoresChanged) {
    await putJSON(env, KV_KEYS.matches, { matches: blob.matches, lastUpdated: new Date().toISOString() });
    // 상태가 방금 FINISHED로 바뀐 경기들에 대해 "경기 종료" 알림(최종 스코어 포함)이 정상적으로
    // 나가도록, 이 크론과 별개로 도는 notifyMatchEvents를 여기서도 한 번 더 호출한다.
    await notifyMatchEvents(env);
  }

  await refreshKLeagueStandings(env);
}
