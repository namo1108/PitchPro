import { getJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import { renderShareCardImage } from "../lib/goalImage.js";
import { getAuthedUser } from "../lib/auth.js";

const PNG_HEADERS = {
  "content-type": "image/png",
  // 경기 결과는 끝난 뒤엔 안 바뀌니 넉넉히 캐싱해도 된다 - 같은 경기를 여러 명이 공유해도 매번 새로
  // 안 그린다. 라이브 중인 경기는 짧게만 캐싱(스코어가 계속 바뀜).
  "cache-control": "public, max-age=1800",
};
const LIVE_PNG_HEADERS = { "content-type": "image/png", "cache-control": "public, max-age=30" };

const STATUS_LABEL = { IN_PLAY: "LIVE", PAUSED: "HT", FINISHED: "FT" };

async function findMatch(env, matchId) {
  const blob = await getJSON(env, KV_KEYS.matches);
  return (blob?.matches || []).find((m) => String(m.id) === String(matchId)) || null;
}

// 득점자 목록은 공짜로 덧붙이는 보너스다 - 최근에 누군가 이 경기 상세를 열어봐서 detail 캐시
// (routes/matchDetail.js)가 남아있으면 그대로 재사용하고, 없으면 API를 추가로 부르지 않고 그냥
// 스코어만 있는 카드로 나간다(공유 버튼 클릭 한 번 때문에 매치 상세 전체를 다시 조회할 정도는 아님).
async function findCachedGoalEvents(env, matchId) {
  const detail = await getJSON(env, `${KV_KEYS.detailPrefix}${matchId}`);
  return detail?.goalEvents || [];
}

function predictionLabelFor(record, home, away) {
  if (!record) return null;
  if (!record.resolved) return `내 예측 ${record.homeGuess}-${record.awayGuess}`;
  const exact = record.finalPoints >= 15;
  const correct = record.finalPoints > 0;
  return `내 예측 ${record.homeGuess}-${record.awayGuess} ${exact ? "· 정확히 적중! 🎯" : correct ? "· 결과 적중" : "· 빗나감"}`;
}

export async function handleMatchShareImage(request, env, matchId) {
  try {
    const match = await findMatch(env, matchId);
    if (!match) return new Response(null, { status: 404 });

    const home = match.score?.fullTime?.home;
    const away = match.score?.fullTime?.away;
    if (home === null || home === undefined || away === null || away === undefined) {
      return new Response(null, { status: 404 });
    }

    const [goalEvents, user] = await Promise.all([findCachedGoalEvents(env, matchId), getAuthedUser(request, env)]);
    const homeScorers = goalEvents.filter((g) => g.teamId === String(match.homeTeam.id));
    const awayScorers = goalEvents.filter((g) => g.teamId === String(match.awayTeam.id));

    let predictionLabel = null;
    if (user) {
      const record = await getJSON(env, `${KV_KEYS.predictionPrefix}${user.username}:${matchId}`);
      predictionLabel = predictionLabelFor(record, home, away);
    }

    const png = await renderShareCardImage(env, {
      competitionName: match.competition?.name,
      homeTeam: match.homeTeam.shortName || match.homeTeam.name,
      homeCrestUrl: match.homeTeam.crest,
      awayTeam: match.awayTeam.shortName || match.awayTeam.name,
      awayCrestUrl: match.awayTeam.crest,
      homeScore: home,
      awayScore: away,
      statusLabel: STATUS_LABEL[match.status] || match.status,
      homeScorers,
      awayScorers,
      predictionLabel,
    });

    const isLive = match.status === "IN_PLAY" || match.status === "PAUSED";
    return new Response(png, { headers: isLive ? LIVE_PNG_HEADERS : PNG_HEADERS });
  } catch (err) {
    console.error("match share image render failed:", err);
    return new Response(null, { status: 500 });
  }
}
