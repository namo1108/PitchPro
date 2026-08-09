import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import * as apiFootball from "../sources/apiFootball.js";
import { normalizeFixture } from "../adapters/apiFootballAdapter.js";
import { detectGoalsAndNotify } from "./detectGoalsAndNotify.js";
import { notifyMatchEvents } from "./notifyMatchEvents.js";
import { detectCardsAndNotify } from "./detectCardsAndNotify.js";

// 3초 간격(사용자 요청, 2026-08-09 - 여전히 지연이 느껴진다는 피드백으로 5초에서 더 줄임). live=all은
// 대회 수와 무관하게 호출 1번으로 끝나는 가벼운 엔드포인트라, Ultra 플랜 분당 한도(450회) 대비 이
// 빈도(틱당 최대 17콜)도 여유가 충분하다.
const POLL_INTERVAL_MS = 3 * 1000;
// 크론이 1분마다 도는데, 다음 tick과 겹치지 않도록 50초 정도에서 멈춘다(Cloudflare 실행시간 여유도 남김).
const POLL_DURATION_MS = 50 * 1000;
// 카드(경고/퇴장)는 경기당 별도 events 조회가 필요해 매 3초마다 부르기엔 비용이 크다(라이브 경기가
// 여러 개면 특히) - 대신 이 배수마다만 확인해서, 최악의 경우 지연을 기존 최대 60초(메인 크론 주기)에서
// 15초로 줄인다. 골/킥오프/하프타임/종료는 live=all 하나로 전체를 커버해서 비용 부담이 없어 매번 확인한다.
const CARD_CHECK_EVERY_N_TICKS = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Cloudflare Cron Trigger는 1분보다 촘촘히는 못 돌리는데, 골/상태변화 알림을 그보다 훨씬 빠르게
// 내보내려고 한 tick 안에서 라이브 경기가 있는 동안만 짧게 반복 조회한다.
// /fixtures?live=all은 대회 하나하나 부르는 것보다 훨씬 가벼운(호출 1번으로 전세계 라이브 경기 전부)
// 엔드포인트라 이 짧은 반복에 적합하다. 매번 받아온 최신 스코어/상태를 기존 경기 목록 캐시에 병합하고,
// 이미 있는 detectGoalsAndNotify/notifyMatchEvents를 그대로 재사용해 변화가 있으면 바로 알림을 보낸다
// (두 함수 다 "이전 값과 비교해서 달라졌을 때만" 동작하므로 매번 호출해도 중복 알림은 안 나간다).
export async function pollLiveMatches(env) {
  const deadline = Date.now() + POLL_DURATION_MS;
  let tick = 0;

  while (Date.now() < deadline) {
    const matchesBlob = await getJSON(env, KV_KEYS.matches);
    const cached = matchesBlob?.matches || [];
    if (!cached.some((m) => m.status === "IN_PLAY" || m.status === "PAUSED")) return; // 라이브 경기가 없으면 더 돌 필요 없음

    let liveRaw;
    try {
      liveRaw = await apiFootball.getLiveFixtures(env, { retries: 1 });
    } catch (err) {
      console.error("live=all fetch failed:", err);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const liveFixtures = (liveRaw.response || []).map(normalizeFixture);
    if (liveFixtures.length) {
      const byId = new Map(cached.map((m) => [m.id, m]));
      for (const live of liveFixtures) {
        const existing = byId.get(live.id);
        // lineupsAnnounced 같이 live=all 응답엔 없는 필드는 existing 쪽에만 있으므로 스프레드 순서상 보존된다.
        byId.set(live.id, existing ? { ...existing, ...live } : live);
      }
      await putJSON(env, KV_KEYS.matches, { matches: [...byId.values()], lastUpdated: new Date().toISOString() });

      await detectGoalsAndNotify(env);
      await notifyMatchEvents(env);
      if (tick % CARD_CHECK_EVERY_N_TICKS === 0) await detectCardsAndNotify(env);
    }

    tick++;
    await sleep(POLL_INTERVAL_MS);
  }
}
