import { getJSON } from "./kv.js";

// API-Football team id -> kleague.com에 표기되는 팀명(선수 사진 매칭 키). K리그2 17개 구단만 대상.
export const KLEAGUE_TEAM_NAMES = {
  2747: "대구",
  2749: "서울E",
  2751: "경남",
  2752: "부산",
  2753: "아산",
  2756: "수원FC",
  2757: "성남",
  2758: "안산",
  2760: "전남",
  2765: "수원",
  7060: "천안",
  7061: "충북청주",
  7076: "김해",
  7078: "김포",
  7087: "화성",
  7098: "파주",
  9171: "용인",
};

export async function getKLeaguePlayerPhotoMap(env) {
  const data = await getJSON(env, "kleague:playerphotos:v1");
  return data?.byKey || {};
}

// kleague.com 자체 playerId 기준 사진 조회(득점/도움 순위처럼 등번호가 없는 목록에 쓴다).
export async function getKLeaguePlayerPhotoByIdMap(env) {
  const data = await getJSON(env, "kleague:playerphotos:v1");
  return data?.byPlayerId || {};
}

// 팀명+등번호로 매칭한다(로마자 표기 이름 vs 한글 이름을 직접 비교할 방법이 없어서 등번호를 키로 씀).
export function lookupKLeaguePlayerPhoto(photoMap, teamId, number) {
  const teamName = KLEAGUE_TEAM_NAMES[String(teamId)];
  if (!teamName || number === null || number === undefined) return null;
  return photoMap[`${teamName}#${number}`] || null;
}

export async function getKLeagueCoachPhotoMap(env) {
  const data = await getJSON(env, "kleague:coachphotos:v1");
  return data?.byTeam || {};
}

// 팀당 감독 1명뿐이라 팀명만으로 매칭한다.
export function lookupKLeagueCoachPhoto(coachMap, teamId) {
  const teamName = KLEAGUE_TEAM_NAMES[String(teamId)];
  if (!teamName) return null;
  return coachMap[teamName]?.photo || null;
}
