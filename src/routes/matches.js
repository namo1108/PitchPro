import { json } from "../lib/http.js";
import { getJSON } from "../lib/kv.js";
import { KV_KEYS, findBroadcastLink } from "../lib/config.js";
import { findKLeagueVenue } from "../lib/kleagueVenues.js";
import { koreanizeTeam } from "../adapters/apiFootballAdapter.js";
import { MATCH_DURATION_BUFFER_MS } from "../lib/matchWindow.js";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// API-Football 쿼터 소진 등으로 크론 갱신이 멈추면 IN_PLAY/PAUSED 경기가 실제로는 진작 끝났어도
// 화면엔 그 순간 그대로("19분, 0-0") 영구히 멈춰 보인다 - 마치 지금도 라이브인 것처럼 착각하게 만드는
// 게 문제라, 킥오프 후 넉넉한 경기 지속시간(연장/승부차기 포함 150분)이 지나도록 여전히 진행 중으로
// 나오면 "갱신이 멈췄다"로 보고 프론트에서 라이브 표시 대신 지연 안내를 보여주게 플래그만 붙인다.
function isStaleLiveMatch(m) {
  if (m.status !== "IN_PLAY" && m.status !== "PAUSED") return false;
  return Date.now() - new Date(m.utcDate).getTime() > MATCH_DURATION_BUFFER_MS;
}

// UTC 새벽 시간대(한국 기준 오전) 경기가 하루 전 날짜로 새는 것을 막기 위해,
// 경기 시각을 KST로 환산한 달력 날짜로 비교한다(단순 UTC 문자열 slice는 사용하지 않음).
function toKstDateString(utcIso) {
  return new Date(new Date(utcIso).getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export async function handleMatches(request, env, url) {
  const date = url.searchParams.get("date") || toKstDateString(new Date().toISOString());

  const blob = await getJSON(env, KV_KEYS.matches);
  const matches = (blob?.matches || [])
    .filter((m) => toKstDateString(m.utcDate) === date)
    // 티켓은 홈구장(홈팀 기준)에서 예매하는 거라, K리그 홈팀이면 예매 링크를 같이 붙여준다.
    // 중계처는 대회 단위 링크라 홈/원정 구분 없이 대회 코드로만 붙인다.
    // 팀 한글명은 크론이 다시 갱신하기 전까지 KV에 예전 이름으로 남아있을 수 있어(API 한도 초과 등),
    // 매 응답마다 다시 한 번 보정한다.
    .map((m) => {
      const venue = findKLeagueVenue(m.homeTeam.id);
      const broadcast = findBroadcastLink(m.competition.code, m.matchday);
      return {
        ...m,
        homeTeam: koreanizeTeam(m.homeTeam),
        awayTeam: koreanizeTeam(m.awayTeam),
        ...(venue ? { ticketUrl: venue.ticketUrl } : {}),
        ...(broadcast ? { broadcastUrl: broadcast.url, broadcastProvider: broadcast.provider } : {}),
        ...(isStaleLiveMatch(m) ? { dataStale: true } : {}),
      };
    });

  return json({ matches });
}
