import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import { loadSubscriptions, filterInterested, cleanupDeadSubscription, sendToSubscriber } from "../lib/subscriptions.js";

// 골(득점) 말고 "경기 상태"가 바뀌는 시점(킥오프/전반전 종료/경기 종료)을 감지해서 즐겨찾기 팀 또는
// 🔔로 개별 지정한 경기의 구독자에게 푸시한다. detectGoalsAndNotify.js와 같은 5분 크론에서 돌지만
// 비교 기준이 "스코어"가 아니라 "상태값"이라 별도 파일로 분리했다(prevScores와 별개로 prevStatuses를 KV에 둔다).
function teamLabel(team) {
  return team.shortName || team.name;
}

function scoreLabel(m) {
  const home = m.score.fullTime.home;
  const away = m.score.fullTime.away;
  return home === null || home === undefined ? "vs" : `${home} - ${away}`;
}

// 알림 이미지에 쓸 배지 문구/색 - 킥오프는 아직 스코어가 없어(homeScore/awayScore 비움) "VS"로,
// 나머지는 실제 스코어를 넣는다.
function statusImage(m, badgeText, badgeColor, includeScore) {
  const home = m.score.fullTime.home;
  const away = m.score.fullTime.away;
  const scoreParams = includeScore && home != null ? `&homeScore=${home}&awayScore=${away}` : "";
  return `/api/notif-image/status?homeTeam=${encodeURIComponent(teamLabel(m.homeTeam))}&homeCrest=${encodeURIComponent(
    m.homeTeam.crest || ""
  )}&awayTeam=${encodeURIComponent(teamLabel(m.awayTeam))}&awayCrest=${encodeURIComponent(
    m.awayTeam.crest || ""
  )}${scoreParams}&badge=${encodeURIComponent(badgeText)}&color=${encodeURIComponent(badgeColor)}`;
}

const EVENT_COPY = {
  kickoff: {
    type: "kickoff",
    title: "⏱ 경기 시작",
    body: (m) => `${teamLabel(m.homeTeam)} vs ${teamLabel(m.awayTeam)} 킥오프!`,
    image: (m) => statusImage(m, "KICK OFF", "#24e583", false),
  },
  halftime: {
    type: "halftime",
    title: "🟨 전반전 종료",
    body: (m) => `${teamLabel(m.homeTeam)} ${scoreLabel(m)} ${teamLabel(m.awayTeam)} · 전반 종료`,
    image: (m) => statusImage(m, "HT", "#f5c542", true),
  },
  fulltime: {
    type: "fulltime",
    title: "🏁 경기 종료",
    body: (m) => `${teamLabel(m.homeTeam)} ${scoreLabel(m)} ${teamLabel(m.awayTeam)} · 경기 종료`,
    image: (m) => statusImage(m, "FT", "#24e583", true),
  },
};

// 이전 상태 -> 지금 상태 전이로 어떤 이벤트인지 판별한다. 경기 하나가 한 틱에 두 가지를 동시에
// 건너뛸 수도 있지만(예: 크론이 오래 밀려 SCHEDULED에서 바로 FINISHED로 점프), 그 경우 킥오프
// 알림은 놓치더라도 경기 종료 알림만은 반드시 나가도록 fulltime 판정을 우선한다.
function classifyTransition(before, now) {
  if (now === "FINISHED" && (before === "IN_PLAY" || before === "PAUSED")) return "fulltime";
  if (now === "PAUSED" && before === "IN_PLAY") return "halftime";
  if (now === "IN_PLAY" && (before === "SCHEDULED" || before === "TIMED")) return "kickoff";
  return null;
}

export async function notifyMatchEvents(env) {
  const [matchesBlob, prev] = await Promise.all([getJSON(env, KV_KEYS.matches), getJSON(env, KV_KEYS.prevStatuses)]);
  const matches = matchesBlob?.matches || [];
  const prevStatuses = prev?.statuses || {};
  const nextStatuses = {};

  const events = [];
  for (const m of matches) {
    nextStatuses[m.id] = m.status;
    const before = prevStatuses[m.id];
    if (!before || before === m.status) continue;

    const kind = classifyTransition(before, m.status);
    if (kind) events.push({ match: m, kind });
  }

  if (matches.length > 0) {
    await putJSON(env, KV_KEYS.prevStatuses, { statuses: nextStatuses });
  }

  if (!events.length) return;

  const subscriptions = await loadSubscriptions(env);
  if (!subscriptions.length) return;

  for (const { match, kind } of events) {
    const interested = filterInterested(subscriptions, match);
    if (!interested.length) continue;

    const copy = EVENT_COPY[kind];
    const payload = { type: copy.type, title: copy.title, body: copy.body(match), matchId: match.id, image: copy.image(match) };

    for (const sub of interested) {
      try {
        const res = await sendToSubscriber(env, sub, payload);
        if (res && (res.status === 404 || res.status === 410)) {
          await cleanupDeadSubscription(env, sub);
        }
      } catch (err) {
        console.error(`${kind} push send failed:`, err);
      }
    }
  }
}
