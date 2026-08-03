import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import * as apiFootball from "../sources/apiFootball.js";
import { loadSubscriptions, filterInterested, cleanupDeadSubscription, sendToSubscriber } from "../lib/subscriptions.js";

function formatMinute(time) {
  if (!time) return "";
  return time.extra ? `${time.elapsed}+${time.extra}` : `${time.elapsed}`;
}

function extractRedCards(events) {
  return (events || [])
    .filter((e) => e.type === "Card" && /red/i.test(e.detail || ""))
    .map((e) => ({
      teamId: String(e.team.id),
      playerId: e.player?.id != null ? String(e.player.id) : "unknown",
      playerName: e.player?.name || "선수",
      minute: formatMinute(e.time),
    }));
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

  const notified = (await getJSON(env, KV_KEYS.notifiedRedCards)) || {};
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

    const redCards = extractRedCards(events);
    if (!redCards.length) continue;

    const seen = new Set(notified[match.id] || []);
    const fresh = redCards.filter((c) => !seen.has(`${c.playerId}:${c.minute}`));
    if (!fresh.length) continue;

    for (const card of fresh) {
      seen.add(`${card.playerId}:${card.minute}`);
      changed = true;
      const cardTeam = match.homeTeam.id === card.teamId ? match.homeTeam : match.awayTeam;
      const teamName = cardTeam.shortName || cardTeam.name;
      const image = `/api/notif-image/goal?team=${encodeURIComponent(teamName)}&crest=${encodeURIComponent(
        cardTeam.crest || ""
      )}&scorer=${encodeURIComponent(card.playerName || "")}&minute=${encodeURIComponent(card.minute || "")}&badge=${encodeURIComponent(
        "RED CARD"
      )}&color=${encodeURIComponent("#ef4444")}`;

      const interested = filterInterested(subscriptions, match);
      for (const sub of interested) {
        const payload = {
          type: "redcard",
          title: `🟥 퇴장! ${card.playerName}`,
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
          console.error("redcard push send failed:", err);
        }
      }
    }

    notified[match.id] = [...seen];
  }

  if (changed) {
    // 하루 지나면 자동 만료 - 지난 경기의 중복방지 기록을 굳이 따로 청소할 필요가 없게 한다.
    await putJSON(env, KV_KEYS.notifiedRedCards, notified, { expirationTtl: 60 * 60 * 24 });
  }
}
