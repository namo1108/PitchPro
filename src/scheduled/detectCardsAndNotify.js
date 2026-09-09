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
// 절대 안 뜨는 문제가 있었다(2026-09-08 제보 - "주말 내내 지켜봤는데 안 보였어"). 그래서 한 번은
// 전체 라이브 경기로 넓혔었는데(2026-09-08), 다음날 바로 "알림이 잘 안 온다" 제보가 왔고 확인해보니
// API-Football 레이트리밋이 여전히 시간당 ~2회씩 발생 중이었다(2026-09-09) - 이 확장이 라이브
// 경기당 15초마다 events를 추가로 조회해서 분당 한도를 상당히 갉아먹고 있었다. 사용자가 직접
// "레드카드는 알림이 올 때 같이 추가하면 되지 않겠냐"고 제안해서(2026-09-09), 다시 "구독자가 있는
// 경기만" 조회하는 원래 방식으로 되돌린다 - 이러면 카드 알림을 보내려고 어차피 하는 조회에 얹혀서
// redCardTeamIds도 같이 갱신되니 추가 비용이 전혀 없다. 대가로 아무도 구독 안 한 경기는 목록 화면에
// 레드카드 표기가 안 뜰 수 있음 - 사용자도 이 트레이드오프를 알고 선택함(알림 안정성을 우선).
export async function detectCardsAndNotify(env) {
  const matchesBlob = await getJSON(env, KV_KEYS.matches);
  const live = (matchesBlob?.matches || []).filter((m) => m.status === "IN_PLAY" || m.status === "PAUSED");
  if (!live.length) return;

  const subscriptions = await loadSubscriptions(env);
  if (!subscriptions.length) return;

  const watchedLive = live.filter((m) => filterInterested(subscriptions, m).length > 0);
  if (!watchedLive.length) return;

  const notified = (await getJSON(env, KV_KEYS.notifiedCards)) || {};
  let notifiedChanged = false;
  let matchesChanged = false;

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

    const redCardTeamIds = [...new Set(redCards.map((c) => c.teamId))];
    const prevRedCardTeamIds = match.redCardTeamIds || [];
    if (redCardTeamIds.length !== prevRedCardTeamIds.length || redCardTeamIds.some((id) => !prevRedCardTeamIds.includes(id))) {
      match.redCardTeamIds = redCardTeamIds;
      matchesChanged = true;
    }

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
