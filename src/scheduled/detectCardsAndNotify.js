import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import * as apiFootball from "../sources/apiFootball.js";
import { loadSubscriptions, filterInterested, cleanupDeadSubscription, sendToSubscriber } from "../lib/subscriptions.js";

function formatMinute(time) {
  if (!time) return "";
  return time.extra ? `${time.elapsed}+${time.extra}` : `${time.elapsed}`;
}

// "Second Yellow Card"(경고 누적 퇴장)는 문자열에 "red"가 안 들어있어 예전 정규식(/red/i)으로는
// 못 잡았다 - 실제로는 퇴장이라 redCards 쪽으로 분류해야 한다(2026-08-09 확인).
function isRedCard(detail) {
  return detail === "Red Card" || detail === "Second Yellow Card";
}
function isYellowCard(detail) {
  return detail === "Yellow Card";
}

function extractCards(events) {
  const redCards = [];
  const yellowCards = [];
  for (const e of events || []) {
    if (e.type !== "Card") continue;
    const card = {
      teamId: String(e.team.id),
      playerId: e.player?.id != null ? String(e.player.id) : "unknown",
      playerName: e.player?.name || "선수",
      minute: formatMinute(e.time),
    };
    if (isRedCard(e.detail)) redCards.push(card);
    else if (isYellowCard(e.detail)) yellowCards.push(card);
  }
  return { redCards, yellowCards };
}

const CARD_COPY = {
  red: { type: "redcard", emoji: "🟥", verb: "퇴장", badge: "RED CARD", color: "#ef4444" },
  yellow: { type: "yellowcard", emoji: "🟨", verb: "경고", badge: "YELLOW CARD", color: "#f5c542" },
};

async function notifyCards(env, match, subscriptions, cards, kind) {
  if (!cards.length) return { changed: false, keys: [] };
  const copy = CARD_COPY[kind];
  const interested = filterInterested(subscriptions, match);
  const notifiedKeys = [];

  for (const card of cards) {
    notifiedKeys.push(`${kind}:${card.playerId}:${card.minute}`);
    const cardTeam = match.homeTeam.id === card.teamId ? match.homeTeam : match.awayTeam;
    const teamName = cardTeam.shortName || cardTeam.name;
    const image = `/api/notif-image/goal?team=${encodeURIComponent(teamName)}&crest=${encodeURIComponent(
      cardTeam.crest || ""
    )}&scorer=${encodeURIComponent(card.playerName || "")}&minute=${encodeURIComponent(card.minute || "")}&badge=${encodeURIComponent(
      copy.badge
    )}&color=${encodeURIComponent(copy.color)}`;

    for (const sub of interested) {
      const payload = {
        type: copy.type,
        title: `${copy.emoji} ${copy.verb}! ${card.playerName}`,
        body: `${teamName} · ${card.minute}'`,
        matchId: match.id,
        image,
      };
      try {
        const res = await sendToSubscriber(env, sub, payload);
        if (res && (res.status === 404 || res.status === 410)) {
          await cleanupDeadSubscription(env, sub);
        }
      } catch (err) {
        console.error(`${copy.type} push send failed:`, err);
      }
    }
  }

  return { changed: true, keys: notifiedKeys };
}

// 이벤트 API 호출 자체가 비용이 크기 때문에, 진행 중인 경기 중에서도 실제로 관심있는 구독자가
// 있는 경기만 조회한다(아무도 안 보는 경기까지 매 틱 events를 부르면 낭비).
export async function detectCardsAndNotify(env) {
  const matchesBlob = await getJSON(env, KV_KEYS.matches);
  const live = (matchesBlob?.matches || []).filter((m) => m.status === "IN_PLAY" || m.status === "PAUSED");
  if (!live.length) return;

  const subscriptions = await loadSubscriptions(env);
  if (!subscriptions.length) return;

  const watchedLive = live.filter((m) => filterInterested(subscriptions, m).length > 0);
  if (!watchedLive.length) return;

  const notified = (await getJSON(env, KV_KEYS.notifiedCards)) || {};
  let changed = false;

  for (const match of watchedLive) {
    let events;
    try {
      const raw = await apiFootball.getFixtureEvents(env, match.id);
      events = raw.response;
    } catch (err) {
      console.error(`fixture events fetch failed for cards(${match.id}):`, err);
      continue;
    }

    const { redCards, yellowCards } = extractCards(events);
    if (!redCards.length && !yellowCards.length) continue;

    const seen = new Set(notified[match.id] || []);
    const freshRed = redCards.filter((c) => !seen.has(`red:${c.playerId}:${c.minute}`));
    const freshYellow = yellowCards.filter((c) => !seen.has(`yellow:${c.playerId}:${c.minute}`));
    if (!freshRed.length && !freshYellow.length) continue;

    const [redResult, yellowResult] = await Promise.all([
      notifyCards(env, match, subscriptions, freshRed, "red"),
      notifyCards(env, match, subscriptions, freshYellow, "yellow"),
    ]);
    for (const key of [...redResult.keys, ...yellowResult.keys]) seen.add(key);
    if (redResult.changed || yellowResult.changed) changed = true;

    notified[match.id] = [...seen];
  }

  if (changed) {
    // 하루 지나면 자동 만료 - 지난 경기의 중복방지 기록을 굳이 따로 청소할 필요가 없게 한다.
    await putJSON(env, KV_KEYS.notifiedCards, notified, { expirationTtl: 60 * 60 * 24 });
  }
}
