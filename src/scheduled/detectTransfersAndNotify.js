import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import * as apiFootball from "../sources/apiFootball.js";
import { sendToSubscriber } from "../lib/subscriptions.js";
import { lookupAndCacheFee } from "../lib/transfermarkt.js";

const TRANSFER_DEDUPE_TTL_SECONDS = 60 * 24 * 60 * 60; // 같은 이적을 두 번 알리지 않도록 60일 보관

async function loadSubscriptions(env) {
  const list = await env.CACHE.list({ prefix: KV_KEYS.pushSubscriptionPrefix });
  const subs = await Promise.all(
    list.keys.map(async (k) => {
      const raw = await env.CACHE.get(k.name);
      return raw ? JSON.parse(raw) : null;
    })
  );
  return subs.filter(Boolean);
}

// "€ 65.3M" 같은 실제 이적료는 그대로 보여주고, Free/Loan/N-A는 한국어로, 값 없으면 표시 생략.
// "Return from loan"(임대 복귀)이 /loan/i에 걸려 새 임대처럼 보이던 것과, 금액 없는 "Transfer"가
// 의미있는 이적료처럼 그대로 노출되던 걸 고쳤다(refreshTransferMarket.js formatMoveType와 동일 로직).
function formatFee(type) {
  if (!type) return null;
  if (/return/i.test(type) && /loan/i.test(type)) return "임대 복귀";
  if (/free/i.test(type)) return "자유계약";
  if (/loan/i.test(type)) return "임대";
  if (/n\/?a/i.test(type)) return null;
  if (/^transfer$/i.test(type.trim())) return null;
  return type;
}

async function getLatestTransfer(env, playerId) {
  try {
    const raw = await apiFootball.getPlayerTransfers(env, playerId);
    return raw.response?.[0]?.transfers?.[0] || null;
  } catch {
    return null;
  }
}

async function notifyTransfer(env, subscriptions, { playerId, playerName, transfer }) {
  const dedupeKey = `transfernotified:${playerId}:${transfer.date}`;
  const already = await env.CACHE.get(dedupeKey);
  if (already) return;

  const inId = transfer.teams?.in?.id != null ? String(transfer.teams.in.id) : null;
  const outId = transfer.teams?.out?.id != null ? String(transfer.teams.out.id) : null;
  const interested = subscriptions.filter((s) => (inId && s.teamIds?.includes(inId)) || (outId && s.teamIds?.includes(outId)));
  if (!interested.length) return;

  const fromTeam = transfer.teams?.out?.name || "알 수 없음";
  const toTeam = transfer.teams?.in?.name || "알 수 없음";
  const name = playerName || `선수 #${playerId}`;
  // 팔로우한 팀 범위로만 도는 알림이라(전체 이적시장 대비 건수가 적음) 여기서는 캐시에 없으면
  // 바로 Transfermarkt를 조회해서라도 실제 금액을 붙인다(enrichTransferFees.js의 느린 배치 큐를
  // 기다리지 않고 알림 시점에 바로 정확한 정보를 보여주기 위함).
  const realFee = playerName ? await lookupAndCacheFee(env, { playerId, playerName, date: transfer.date }).catch(() => null) : null;
  const fee = realFee || formatFee(transfer.type);

  const image = `/api/notif-image/transfer?player=${encodeURIComponent(name)}&fromTeam=${encodeURIComponent(
    fromTeam
  )}&fromCrest=${encodeURIComponent(transfer.teams?.out?.logo || "")}&toTeam=${encodeURIComponent(toTeam)}&toCrest=${encodeURIComponent(
    transfer.teams?.in?.logo || ""
  )}`;

  const payload = {
    type: "transfer",
    title: `🔁 이적 소식: ${name}`,
    body: fee ? `${fromTeam} → ${toTeam} (${fee})` : `${fromTeam} → ${toTeam}`,
    playerId,
    image,
  };

  for (const sub of interested) {
    try {
      await sendToSubscriber(env, sub, payload);
    } catch (err) {
      console.error("transfer push send failed:", err);
    }
  }

  try {
    await env.CACHE.put(dedupeKey, "1", { expirationTtl: TRANSFER_DEDUPE_TTL_SECONDS });
  } catch (err) {
    console.error("transfer dedupe write failed:", err);
  }
}

// 즐겨찾기(마이팀) 등록된 팀들만 대상으로, 스쿼드 명단을 하루 간격으로 스냅샷 비교해서
// 선수가 갑자기 빠지거나(방출/이적) 새로 생기면(영입) /transfers로 실제 이적 내역을 확인해 알린다.
// API-Football에 전체 이적시장을 훑는 엔드포인트가 없어서, 팔로우한 팀 범위로 좁혀 요청량을 아낀다.
export async function detectTransfersAndNotify(env) {
  const subscriptions = await loadSubscriptions(env);
  if (!subscriptions.length) return;

  const watchedTeamIds = [...new Set(subscriptions.flatMap((s) => s.teamIds || []))];
  if (!watchedTeamIds.length) return;

  for (const teamId of watchedTeamIds) {
    try {
      const squadRaw = await apiFootball.getSquad(env, teamId);
      const players = squadRaw.response?.[0]?.players || [];
      const currentIds = players.map((p) => String(p.id));

      const snapshotKey = `squadsnapshot:${teamId}`;
      const prevIds = await getJSON(env, snapshotKey);

      if (prevIds) {
        const prevSet = new Set(prevIds);
        const currentSet = new Set(currentIds);
        const changedIds = [...new Set([...prevIds.filter((id) => !currentSet.has(id)), ...currentIds.filter((id) => !prevSet.has(id))])];

        for (const playerId of changedIds) {
          const transfer = await getLatestTransfer(env, playerId);
          if (!transfer) continue;
          const playerName = players.find((p) => String(p.id) === playerId)?.name || null;
          await notifyTransfer(env, subscriptions, { playerId, playerName, transfer });
        }
      }

      await putJSON(env, snapshotKey, currentIds);
    } catch (err) {
      console.error(`transfer check failed for team ${teamId}:`, err);
    }
  }
}
