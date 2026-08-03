import { getJSON, putJSON } from "./kv.js";
import { KV_KEYS } from "./config.js";

// API-Football의 이적 데이터(/transfers)는 실제 이적료 금액을 거의 안 준다(자유계약/임대/기타
// 정성적 문구만) - Transfermarkt가 갖고 있는 실제 금액을 보강용으로 찾아온다. 공식 API가 없어서
// 사이트 자체를 조회하는데, 두 단계로 나뉜다: ① 선수 검색(HTML 페이지)으로 Transfermarkt 내부
// 선수ID를 찾고, ② 그 선수ID로 이적 내역 JSON(ceapi)을 받아 날짜가 일치하는 이적의 fee를 뽑는다.
// ②는 문서화된 API는 아니지만 순수 JSON 응답이라(HTML 파싱/JS 실행 불필요) 가볍게 조회할 수 있다.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchText(url, referer) {
  const res = await fetch(url, { headers: { "User-Agent": UA, ...(referer ? { Referer: referer } : {}) } });
  if (!res.ok) throw new Error(`transfermarkt fetch failed: ${res.status} ${url}`);
  return res.text();
}

const SEARCH_RESULT_RE = /href="\/([a-z0-9-]+)\/profil\/spieler\/(\d+)"/;

// 검색 결과 1위만 신뢰한다 - 동명이인 구분까지 하려면 나이/포지션/소속팀까지 대조해야 하는데, 그렇게까지
// 정교하게 할 바엔 아예 안 맞는 값을 못 찾은 것으로 처리하는(아래 finder에서 날짜로 다시 거름) 게
// 더 안전하다.
export async function searchPlayerId(name) {
  const html = await fetchText(`https://www.transfermarkt.com/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(name)}`);
  const m = html.match(SEARCH_RESULT_RE);
  return m ? { slug: m[1], id: m[2] } : null;
}

// 실제 금액이 있는 값(예: "€55.00m")만 쓸모가 있다 - "free transfer"/"loan transfer"/"End of
// loan"/"-" 같은 정성적 값은 이미 우리 쪽 API-Football moveType으로 충분히 표현되니 무시한다.
function isRealFee(fee) {
  return !!fee && /\d/.test(fee);
}

export async function fetchTransferHistory(playerId) {
  const text = await fetchText(`https://www.transfermarkt.com/ceapi/transferHistory/list/${playerId}`);
  const data = JSON.parse(text);
  return data.transfers || [];
}

// 우리 쪽 이적 기록(player 이름 + 날짜)에 맞는 항목을 Transfermarkt 이적 내역에서 찾는다. 날짜가
// 정확히 같은 항목만 신뢰한다(같은 선수라도 여러 번 이적할 수 있어, 날짜가 안 맞으면 엉뚱한 이적의
// 금액을 잘못 붙이게 된다).
export function matchFeeByDate(transfers, isoDate) {
  const target = String(isoDate || "").slice(0, 10);
  if (!target) return null;
  const hit = transfers.find((t) => t.dateUnformatted === target);
  return hit && isRealFee(hit.fee) ? hit.fee : null;
}

function playerIdCacheKey(apiFootballPlayerId) {
  return `${KV_KEYS.transfermarktPlayerPrefix}${apiFootballPlayerId}`;
}

// 같은 선수를 여러 번(다른 이적 건마다) 검색하지 않도록 API-Football 선수ID -> Transfermarkt
// 선수ID 매핑을 캐싱한다. 못 찾은 경우도 "notfound"로 캐싱해서 매번 다시 검색을 시도하지 않는다
// (선수명이 애초에 안 맞는 경우 재검색해도 결과가 똑같다).
async function resolveTmPlayerId(env, apiFootballPlayerId, playerName) {
  const cacheKey = playerIdCacheKey(apiFootballPlayerId);
  const cached = await env.CACHE.get(cacheKey);
  if (cached === "notfound") return null;
  if (cached) return cached;

  const found = await searchPlayerId(playerName).catch(() => null);
  await env.CACHE.put(cacheKey, found ? found.id : "notfound", { expirationTtl: 60 * 24 * 60 * 60 });
  return found?.id || null;
}

function feeCacheKey(apiFootballPlayerId, date) {
  return `${KV_KEYS.transfermarktFeePrefix}${apiFootballPlayerId}:${String(date).slice(0, 10)}`;
}

// 특정 이적 건 하나에 대해 Transfermarkt 실제 금액을 찾아 캐싱해둔다(찾았든 못 찾았든 - 다음번
// 새로고침 때는 이 캐시만 읽으면 되므로 refreshTransferMarket.js 쪽에는 네트워크 호출이 없다).
export async function lookupAndCacheFee(env, { playerId, playerName, date }) {
  const key = feeCacheKey(playerId, date);
  const existing = await getJSON(env, key);
  if (existing) return existing.fee || null;

  let fee = null;
  try {
    const tmId = await resolveTmPlayerId(env, playerId, playerName);
    if (tmId) {
      const history = await fetchTransferHistory(tmId);
      fee = matchFeeByDate(history, date);
    }
  } catch (err) {
    console.error(`transfermarkt fee lookup failed for ${playerName}:`, err);
  }

  await putJSON(env, key, { fee, checkedAt: new Date().toISOString() });
  return fee;
}

// refreshTransferMarket.js가 API-Football에서 매번 새로 받아오는 이적 목록에, 이미 캐싱해둔 실제
// 금액이 있으면 조용히 덧붙인다(네트워크 호출 없음 - lookupAndCacheFee가 실제 조회를 담당).
export async function attachCachedFee(env, transfer) {
  const cached = await getJSON(env, feeCacheKey(transfer.playerId, transfer.date));
  return cached?.fee || null;
}
