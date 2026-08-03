import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import * as apiFootball from "../sources/apiFootball.js";
import { normalizeFixture } from "../adapters/apiFootballAdapter.js";
import { detectGoalsAndNotify } from "./detectGoalsAndNotify.js";
import { notifyMatchEvents } from "./notifyMatchEvents.js";

const POLL_INTERVAL_MS = 10 * 1000;
// 크론이 1분마다 도는데, 다음 tick과 겹치지 않도록 50초 정도에서 멈춘다(Cloudflare 실행시간 여유도 남김).
const POLL_DURATION_MS = 50 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Cloudflare Cron Trigger는 1분보다 촘촘히는 못 돌리는데, 골/상태변화 알림을 그보다 훨씬 빠르게
// 내보내려고 한 tick 안에서 라이브 경기가 있는 동안만 10초 간격으로 짧게 반복 조회한다.
// /fixtures?live=all은 대회 하나하나 부르는 것보다 훨씬 가벼운(호출 1번으로 전세계 라이브 경기 전부)
// 엔드포인트라 이 짧은 반복에 적합하다. 매번 받아온 최신 스코어/상태를 기존 경기 목록 캐시에 병합하고,
// 이미 있는 detectGoalsAndNotify/notifyMatchEvents를 그대로 재사용해 변화가 있으면 바로 알림을 보낸다
// (두 함수 다 "이전 값과 비교해서 달라졌을 때만" 동작하므로 매번 호출해도 중복 알림은 안 나간다).
export async function pollLiveMatches(env) {
  const deadline = Date.now() + POLL_DURATION_MS;

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
    }

    await sleep(POLL_INTERVAL_MS);
  }
}
