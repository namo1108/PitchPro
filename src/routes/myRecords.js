import { json } from "../lib/http.js";
import { getJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import { getAuthedUser } from "../lib/auth.js";
import { koreanizeTeam } from "../adapters/apiFootballAdapter.js";

// "직관 기록장"(2026-11-10) - 새로 데이터를 쌓지 않고, 이미 집관인증/승부예측 때마다 쌓이고 있던
// 기록(checkin:/predict: KV)을 모아서 통계로 보여주기만 한다. 매치 상세 정보는 저장 안 해뒀으니
// matches 캐시에서 그때그때 팀명/스코어를 찾아 붙인다(오래된 경기라 캐시에서 빠졌으면 ID만 보여줌).
async function listUserRecords(env, prefix, username) {
  const list = await env.CACHE.list({ prefix: `${prefix}${username}:` });
  const records = await Promise.all(list.keys.map((k) => getJSON(env, k.name)));
  return records.filter(Boolean);
}

function summarizeCheckins(records, matchById) {
  let win = 0;
  let draw = 0;
  let loss = 0;
  const teamCount = new Map();
  const history = [];
  for (const r of records) {
    const match = matchById.get(String(r.matchId));
    if (r.resolved && r.finalPoints != null) {
      if (r.finalPoints > r.awardedPoints) win++;
      else if (r.finalPoints < r.awardedPoints) loss++;
      else draw++;
    }
    const cheeredTeam = match ? (String(match.homeTeam.id) === String(r.teamId) ? match.homeTeam : match.awayTeam) : null;
    if (cheeredTeam) {
      const key = cheeredTeam.shortName || cheeredTeam.name;
      teamCount.set(key, (teamCount.get(key) || 0) + 1);
    }
    history.push({
      type: "checkin",
      matchId: r.matchId,
      checkedInAt: r.checkedInAt,
      resolved: r.resolved,
      finalPoints: r.finalPoints ?? null,
      match: match
        ? { homeTeam: koreanizeTeam(match.homeTeam), awayTeam: koreanizeTeam(match.awayTeam), utcDate: match.utcDate, score: match.score }
        : null,
      cheeredTeamName: cheeredTeam?.shortName || cheeredTeam?.name || null,
    });
  }
  const topTeam = [...teamCount.entries()].sort((a, b) => b[1] - a[1])[0];
  const resolvedCount = win + draw + loss;
  return {
    total: records.length,
    win,
    draw,
    loss,
    winRate: resolvedCount ? Math.round((win / resolvedCount) * 100) : null,
    topTeamName: topTeam?.[0] || null,
    topTeamCount: topTeam?.[1] || 0,
    history: history.sort((a, b) => new Date(b.checkedInAt).getTime() - new Date(a.checkedInAt).getTime()),
  };
}

function summarizePredictions(records, matchById) {
  let exact = 0;
  let correctResult = 0;
  let wrong = 0;
  const history = [];
  for (const r of records) {
    const match = matchById.get(String(r.matchId));
    if (r.resolved) {
      if (r.finalPoints >= 15) exact++;
      else if (r.finalPoints > 0) correctResult++;
      else wrong++;
    }
    history.push({
      type: "prediction",
      matchId: r.matchId,
      submittedAt: r.submittedAt,
      homeGuess: r.homeGuess,
      awayGuess: r.awayGuess,
      resolved: r.resolved,
      finalPoints: r.finalPoints ?? null,
      match: match
        ? { homeTeam: koreanizeTeam(match.homeTeam), awayTeam: koreanizeTeam(match.awayTeam), utcDate: match.utcDate, score: match.score }
        : null,
    });
  }
  const resolvedCount = exact + correctResult + wrong;
  return {
    total: records.length,
    exact,
    correctResult,
    wrong,
    accuracy: resolvedCount ? Math.round(((exact + correctResult) / resolvedCount) * 100) : null,
    history: history.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()),
  };
}

export async function handleMyRecords(request, env) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const [checkinRecords, predictionRecords, matchesBlob] = await Promise.all([
    listUserRecords(env, KV_KEYS.checkinPrefix, user.username),
    listUserRecords(env, KV_KEYS.predictionPrefix, user.username),
    getJSON(env, KV_KEYS.matches),
  ]);
  const matchById = new Map((matchesBlob?.matches || []).map((m) => [String(m.id), m]));

  return json({
    checkin: summarizeCheckins(checkinRecords, matchById),
    prediction: summarizePredictions(predictionRecords, matchById),
  });
}
