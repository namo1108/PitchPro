import * as apiFootball from "../sources/apiFootball.js";
import { normalizeTeamTransfers } from "../adapters/apiFootballAdapter.js";
import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS, transferMarketCompetitions } from "../lib/config.js";
import { loadSubscriptions, cleanupDeadSubscription, sendToSubscriber } from "../lib/subscriptions.js";
import { isQuotaTight } from "../lib/quotaGuard.js";
import { attachCachedFee } from "../lib/transfermarkt.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 같은 이적을 두 번 알리지 않도록(이 순환 조회 + 즐겨찾기 팀 스쿼드 대조 detectTransfersAndNotify.js
// 양쪽이 같은 이적을 다른 시점에 발견할 수 있음) 두 코드가 같은 키 형식을 공유한다.
const TRANSFER_DEDUPE_TTL_SECONDS = 60 * 24 * 60 * 60;
function transferDedupeKey(playerId, date) {
  return `transfernotified:${playerId}:${date}`;
}
function transferIdentity(t) {
  return `${t.playerId}:${t.date}:${t.direction}`;
}
// API-Football의 type 필드는 대부분 "Free"/"Loan"/"N/A"/"Transfer" 같은 정성적 문구고, 실제 이적료
// 금액("€ 55M" 등)이 오는 경우는 드물다 - 그런 값은 아래 어떤 정규식에도 안 걸려서 그대로 통과되므로
// 이미 나오고 있다. 다만 "Return from loan"(임대 복귀, 원 소속팀으로 돌아옴)이 /loan/i에 걸려서
// 새 임대처럼 "임대"로 잘못 표시되던 버그와, 금액 없는 "Transfer"가 마치 의미있는 이적료처럼
// 그대로 노출되던 것을 고친다(금액 정보가 없으면 아예 표시 안 하는 게 낫다).
function formatMoveType(moveType) {
  if (!moveType) return null;
  if (/return/i.test(moveType) && /loan/i.test(moveType)) return "임대 복귀";
  if (/free/i.test(moveType)) return "자유계약";
  if (/loan/i.test(moveType)) return "임대";
  if (/n\/?a/i.test(moveType)) return null;
  if (/^transfer$/i.test(moveType.trim())) return null;
  return moveType;
}

// 팀의 이적 목록을 새로 받아올 때마다 직전 캐시와 비교해서 "새로 생긴" 항목만 골라 즐겨찾기한
// 유저에게 푸시한다 - 팀 순환 주기(3분)에 그대로 얹혀가는 거라 별도 API 호출이 들지 않는다.
// 그 팀을 처음 조회하는 경우(직전 캐시 없음)는 기존 이적 역사 전체가 "새 것"처럼 보이므로 스킵한다.
async function notifyNewTransfers(env, subscriptions, teamId, freshTransfers) {
  const interested = subscriptions.filter((s) => s.teamIds?.includes(String(teamId)));
  if (!interested.length) return;

  for (const t of freshTransfers) {
    const dedupeKey = transferDedupeKey(t.playerId, t.date);
    if (await env.CACHE.get(dedupeKey)) continue;

    const fee = formatMoveType(t.moveType);
    const image = `/api/notif-image/transfer?player=${encodeURIComponent(t.playerName)}&fromTeam=${encodeURIComponent(
      t.fromTeam
    )}&fromCrest=${encodeURIComponent(t.fromCrest || "")}&toTeam=${encodeURIComponent(t.toTeam)}&toCrest=${encodeURIComponent(t.toCrest || "")}`;
    const payload = {
      type: "transfer",
      title: `🔁 이적 소식: ${t.playerName}`,
      body: fee ? `${t.fromTeam} → ${t.toTeam} (${fee})` : `${t.fromTeam} → ${t.toTeam}`,
      playerId: t.playerId,
      image,
    };

    for (const sub of interested) {
      try {
        const res = await sendToSubscriber(env, sub, payload);
        if (res && (res.status === 404 || res.status === 410)) {
          await cleanupDeadSubscription(env, sub);
        }
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
}

// 대상 팀 수(이젠 5대리그+K리그1~4+네덜란드+사우디+미국으로 좁혀서 약 250여 개)를 한 번에 다 못
// 돌고, 커서를 이어서 여러 틱에 나눠 순환 조회한다(주기는 config.js REFRESH_INTERVALS_MS.transferMarketTick=5분).
// 예전엔 40팀/틱이라 하루 최대 (1440/5)*40 = 11,520회 - API-Football Pro 플랜 일일 한도(7,500)를
// 이적시장 혼자 넘겨버려서 정작 저녁 K리그 경기 시간대엔 쿼터가 없는 사고로 이어졌다(2026-07-22
// 확인). 10팀/틱(하루 최대 2,880회)으로 한 번 줄였는데도, 하필 지금(2026-07-26) 유럽 여름
// 이적시장이 한창 열려있는 시기라 AI 분석 사전 갱신 등 다른 크론과 겹쳐 또 하루 한도를 다 써버린
// 사고가 재발했다 - 5팀/틱(하루 최대 1,440회)으로 한 번 더 줄인다. 전체 로스터를 한 바퀴 도는 데
// 시간이 좀 더 걸리지만(약 4시간), 이적 정보는 골처럼 분 단위로 급한 게 아니라 이 정도 지연은
// 괜찮고, K리그는 로테이션 맨 앞이라 여전히 가장 먼저 갱신된다.
const TEAMS_PER_TICK = 5;
const CURSOR_KEY = `${KV_KEYS.lastRunPrefix}transfermarket-cursor`;

// K리그는 사용자 요청상 항상 최우선(AI 분석 티어 시스템과 동일한 원칙) - 커서가 리그 배열 순서 그대로
// 돌면 K리그가 COMPETITIONS 뒤쪽에 있어서 정작 가장 궁금해할 K리그 이적이 몇 시간씩 안 보일 수 있었다.
// 그래서 이적시장 순환 대상만큼은 K리그를 맨 앞으로 당겨서, 서비스 기동 직후에도 바로 채워지게 한다.
const TRANSFER_PRIORITY_CODES = ["KL1", "KL2"];
function transferPriorityRank(code) {
  const idx = TRANSFER_PRIORITY_CODES.indexOf(code);
  return idx === -1 ? TRANSFER_PRIORITY_CODES.length : idx;
}

// 순위표 캐시에 이미 들어있는 팀 목록을 그대로 재사용한다(팀 목록만 필요한 거라 별도 API 호출이 필요 없음).
// MLS(동/서부 컨퍼런스)처럼 그룹이 여러 개인 리그는 standings 배열에 그룹별로 여러 테이블이 들어있으므로
// 전부 순회해야 한다 - 첫 번째 그룹만 보면 나머지 그룹 팀들이 통째로 이적시장 대상에서 빠지게 된다.
// onlyOpenWindow로 "지금 이적 등록 기간인 리그"만 추려서, 창구가 닫힌 리그(대부분의 기간)에 굳이
// 순환 조회 예산을 낭비하지 않고 실제로 이적이 일어나는 리그에 집중한다.
//
// 전체 로스터(약 250팀)를 5팀/5분으로 한 바퀴 도는 데 4시간 가까이 걸려서(아래 TEAMS_PER_TICK 주석
// 참고) 사용자가 실제로 궁금해하는 팀이 순번이 늦으면 몇 시간씩 안 갱신되는 게 "느리다"는 체감의
// 핵심 원인이었다(2026-08-31 제보). 골 알림 구독(favoriteTeamIds)은 이미 "이 팀에 관심있다"는
// 신호라 이적시장에도 그대로 재사용할 수 있다 - 별도 API 호출 없이, 순위표 순서 안에서 이 팀들만
// 로스터 앞쪽으로 당긴다(자바스크립트 sort는 안정 정렬이라 동순위 내에서는 기존 K리그 우선순위 등
// 순서가 그대로 유지됨).
function buildTeamRoster(standingsBlob, subscriptions) {
  const roster = [];
  const comps = transferMarketCompetitions({ onlyOpenWindow: true }).sort((a, b) => transferPriorityRank(a.code) - transferPriorityRank(b.code));
  for (const comp of comps) {
    const tables = standingsBlob?.byCode?.[comp.code]?.standings || [];
    for (const table of tables) {
      for (const row of table.table || []) {
        roster.push({ teamId: row.team.id, teamName: row.team.name, competitionCode: comp.code });
      }
    }
  }

  const interestedTeamIds = new Set((subscriptions || []).flatMap((s) => (s.teamIds || []).map(String)));
  if (interestedTeamIds.size) {
    roster.sort((a, b) => (interestedTeamIds.has(String(a.teamId)) ? 0 : 1) - (interestedTeamIds.has(String(b.teamId)) ? 0 : 1));
  }
  return roster;
}

export async function refreshTransferMarket(env) {
  if (await isQuotaTight(env)) return;

  const standingsBlob = await getJSON(env, KV_KEYS.standings);
  const subscriptions = await loadSubscriptions(env);
  const roster = buildTeamRoster(standingsBlob, subscriptions);
  // 순위표가 아직 하나도 안 채워졌거나(초기 구동 직후), 지금 이적 등록 기간인 리그가 하나도 없으면
  // (연중 조용한 시기) 이번 틱은 API 호출 없이 건너뛴다 - 기존에 모아둔 데이터는 그대로 남아있다.
  if (!roster.length) return;

  const existing = (await getJSON(env, KV_KEYS.transferMarket)) || { byTeam: {} };

  const cursorRaw = await env.CACHE.get(CURSOR_KEY);
  const cursor = Number(cursorRaw || "0") % roster.length;
  const batch = Array.from({ length: Math.min(TEAMS_PER_TICK, roster.length) }, (_, i) => roster[(cursor + i) % roster.length]);

  const beforeSnapshot = JSON.stringify(existing.byTeam);

  for (const { teamId, teamName, competitionCode } of batch) {
    try {
      const raw = await apiFootball.getTeamTransfers(env, teamId, { retries: 1 });
      const transfers = normalizeTeamTransfers(raw.response, teamId, competitionCode);
      // Transfermarkt에서 이미 찾아 캐싱해둔 실제 이적료가 있으면 덧붙인다(enrichTransferFees.js가
      // 별도로 채워두는 캐시를 읽기만 하는 거라 여기선 추가 네트워크 호출이 없음).
      for (const t of transfers) {
        t.feeAmount = await attachCachedFee(env, t);
      }
      const previousEntry = existing.byTeam[teamId];
      existing.byTeam[teamId] = { teamId, teamName, competitionCode, transfers, fetchedAt: new Date().toISOString() };

      if (previousEntry && subscriptions.length) {
        const prevKeys = new Set((previousEntry.transfers || []).map(transferIdentity));
        const freshTransfers = transfers.filter((t) => !prevKeys.has(transferIdentity(t)));
        if (freshTransfers.length) {
          await notifyNewTransfers(env, subscriptions, teamId, freshTransfers);
        }
      }
    } catch (err) {
      console.error(`transfer market fetch failed for team ${teamId}:`, err);
    }
    await sleep(300);
  }

  if (JSON.stringify(existing.byTeam) !== beforeSnapshot) {
    existing.lastUpdated = new Date().toISOString();
    await putJSON(env, KV_KEYS.transferMarket, existing);
  }

  const nextCursor = (cursor + TEAMS_PER_TICK) % roster.length;
  try {
    await env.CACHE.put(CURSOR_KEY, String(nextCursor));
  } catch (err) {
    console.error("transfer market cursor write failed:", err);
  }
}
