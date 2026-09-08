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

// 원래는 "관심있는 구독자가 있는 경기"만 events를 조회했는데(API 호출 절감 목적), 그러면 정작
// 메인 화면에서 아무 경기나 보고 있는 사용자에게는 그 경기에 구독자가 없으면 레드카드 표기 자체가
// 절대 안 뜨는 문제가 있었다(2026-09-08 제보 - "주말 내내 지켜봤는데 안 보였어"). 사용자가 이
// 트레이드오프를 알고도 전체 라이브 경기로 넓히길 선택해서(레이트리밋이 심해질 수 있다고 안내함),
// 진행 중인 모든 경기를 대상으로 조회한다 - 다만 실제 푸시 알림 전송은 여전히 관심있는 구독자가
// 있을 때만 나간다(아래 notifyCards 내부의 filterInterested가 그대로 처리).
export async function detectCardsAndNotify(env) {
  const matchesBlob = await getJSON(env, KV_KEYS.matches);
  const live = (matchesBlob?.matches || []).filter((m) => m.status === "IN_PLAY" || m.status === "PAUSED");
  if (!live.length) return;

  const subscriptions = await loadSubscriptions(env);

  const notified = (await getJSON(env, KV_KEYS.notifiedCards)) || {};
  let notifiedChanged = false;
  let matchesChanged = false;

  for (const match of live) {
    let events;
    try {
      const raw = await apiFootball.getFixtureEvents(env, match.id);
      events = raw.response;
    } catch (err) {
      console.error(`fixture events fetch failed for cards(${match.id}):`, err);
      continue;
    }

    const { redCards, yellowCards } = extractCards(events);

    const redCardTeamIds = [...new Set(redCards.map((c) => c.teamId))];
    const prevRedCardTeamIds = match.redCardTeamIds || [];
    if (redCardTeamIds.length !== prevRedCardTeamIds.length || redCardTeamIds.some((id) => !prevRedCardTeamIds.includes(id))) {
      match.redCardTeamIds = redCardTeamIds;
      matchesChanged = true;
    }

    if (!redCards.length && !yellowCards.length) continue;
    if (!subscriptions.length) continue; // 알림 받을 사람이 없으면(위 redCardTeamIds는 이미 갱신됐으니) 더 할 일 없음

    const seen = new Set(notified[match.id] || []);
    const freshRed = redCards.filter((c) => !seen.has(`red:${c.playerId}:${c.minute}`));
    const freshYellow = yellowCards.filter((c) => !seen.has(`yellow:${c.playerId}:${c.minute}`));
    if (!freshRed.length && !freshYellow.length) continue;

    const [redResult, yellowResult] = await Promise.all([
      notifyCards(env, match, subscriptions, freshRed, "red"),
      notifyCards(env, match, subscriptions, freshYellow, "yellow"),
    ]);
    for (const key of [...redResult.keys, ...yellowResult.keys]) seen.add(key);
    if (redResult.changed || yellowResult.changed) notifiedChanged = true;

    notified[match.id] = [...seen];
  }

  if (notifiedChanged) {
    // 하루 지나면 자동 만료 - 지난 경기의 중복방지 기록을 굳이 따로 청소할 필요가 없게 한다.
    await putJSON(env, KV_KEYS.notifiedCards, notified, { expirationTtl: 60 * 60 * 24 });
  }
  if (matchesChanged) {
    await putJSON(env, KV_KEYS.matches, { ...matchesBlob, lastUpdated: new Date().toISOString() });
  }
}
