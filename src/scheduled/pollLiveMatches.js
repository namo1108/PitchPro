import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS, COMPETITIONS } from "../lib/config.js";
import * as apiFootball from "../sources/apiFootball.js";
import { normalizeFixture } from "../adapters/apiFootballAdapter.js";
import { detectGoalsAndNotify } from "./detectGoalsAndNotify.js";
import { notifyMatchEvents } from "./notifyMatchEvents.js";
import { detectCardsAndNotify } from "./detectCardsAndNotify.js";
import { alertAdminOfFailure } from "../lib/adminAlert.js";

// 원래 1초 간격이었는데(사용자 요청, 2026-08-09 - 3초도 느리다는 피드백으로 줄임), "Ultra 플랜 분당
// 한도(450회) 대비 여유 충분"이라던 그 가정이 실제로는 안 맞았던 것으로 보인다 - admin 알림 로그를
// 보면 2026-08-30부터 거의 매일, 특히 유럽 5대리그가 동시에 여러 경기 열리는 시간대에 레이트리밋이
// 시간당 1~4번씩 반복돼서 그동안 골/라인업 알림이 통째로 끊기고 있었다(2026-09-04 "알림이 이상해"
// 제보로 발견 - 5일치 로그가 200개 한도를 이미 채운 상태였음). 알림이 몇 초 늦게 오는 것보다 아예
// 안 오는 게 훨씬 나쁘므로, 이 폴링 루프의 분당 호출 수를 절반 이하로 줄인다.
const POLL_INTERVAL_MS = 2.5 * 1000;
// 레이트리밋에 걸리기 시작하면 남은 틱 예산(최대 50초)을 다 써가며 계속 재시도해봤자 매번 또
// 걸리기만 해서 오히려 다른 대회/작업의 분당 한도까지 같이 갉아먹는다 - 연속으로 이만큼 실패하면
// 이번 틱은 깨끗하게 포기하고 다음 크론 틱(최대 1분 뒤)에 다시 시도한다.
const MAX_CONSECUTIVE_RATE_LIMITS = 3;
// 크론이 1분마다 도는데, 다음 tick과 겹치지 않도록 50초 정도에서 멈춘다(Cloudflare 실행시간 여유도 남김).
const POLL_DURATION_MS = 50 * 1000;
// 카드(경고/퇴장)는 경기당 별도 events 조회가 필요해 매초 부르기엔 비용이 크다(라이브 경기가 여러 개면
// 특히) - 대신 경과 시간 기준으로 이 간격마다만 확인한다(폴링 간격이 바뀌어도 카드 체크 주기는 그대로
// 유지되도록 틱 카운트 대신 시간으로 계산). 골/킥오프/하프타임/종료는 live=all 하나로 전체를 커버해서
// 비용 부담이 없어 매번 확인한다.
const CARD_CHECK_INTERVAL_MS = 15 * 1000;
// 레이트리밋에 걸린 직후에도 바로 다음 초에 또 부르면(POLL_INTERVAL_MS) 분당 한도가 회복될 틈이 없이
// 계속 실패만 반복한다(2026-08-22, 여러 대회가 동시 라이브인 토요일 오후에 몇 분간 지속 확인) - 레이트
// 리밋 응답을 받으면 이 구간만큼은 더 길게 쉬어서 한도가 돌아올 시간을 준다.
const RATE_LIMIT_BACKOFF_MS = 5 * 1000;

// live=all은 리그 구분 없이 전세계 라이브 경기를 다 반환하는데(2026-08-22 확인 - 동시에 67개, 대부분
// COMPETITIONS에 없는 해외 하부/유스 리그), 이 루프의 "계속 돌 이유가 있는지" 판단을 전세계 기준으로
// 하면 지구 어딘가는 항상 경기가 있어 사실상 하루 종일 멈추지 않는다 - API-Football 분당 호출 한도를
// 이 루프 혼자서(최대 분당 50콜) 갉아먹는 주범이었다. 우리가 실제로 다루는 대회에 라이브 경기가 있을
// 때만 이 빠른 폴링을 계속한다(매치 자체 캐시/알림 대상 필터링과는 무관 - 그건 이미 detectCardsAndNotify
// 등에서 구독자 기준으로 한 번 더 거른다).
const TRACKED_CODES = new Set(COMPETITIONS.map((c) => c.code));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Cloudflare Cron Trigger는 1분보다 촘촘히는 못 돌리는데, 골/상태변화 알림을 그보다 훨씬 빠르게
// 내보내려고 한 tick 안에서 라이브 경기가 있는 동안만 짧게 반복 조회한다.
// /fixtures?live=all은 대회 하나하나 부르는 것보다 훨씬 가벼운(호출 1번으로 전세계 라이브 경기 전부)
// 엔드포인트라 이 짧은 반복에 적합하다. 매번 받아온 최신 스코어/상태를 기존 경기 목록 캐시에 병합하고,
// 이미 있는 detectGoalsAndNotify/notifyMatchEvents를 그대로 재사용해 변화가 있으면 바로 알림을 보낸다
// (두 함수 다 "이전 값과 비교해서 달라졌을 때만" 동작하므로 매번 호출해도 중복 알림은 안 나간다).
export async function pollLiveMatches(env) {
  const deadline = Date.now() + POLL_DURATION_MS;
  let lastCardCheck = 0;
  let consecutiveRateLimits = 0;

  while (Date.now() < deadline) {
    const matchesBlob = await getJSON(env, KV_KEYS.matches);
    const cached = matchesBlob?.matches || [];
    if (!cached.some((m) => (m.status === "IN_PLAY" || m.status === "PAUSED") && TRACKED_CODES.has(m.competition.code))) return; // 우리 대회 중 라이브 경기가 없으면 더 돌 필요 없음

    let liveRaw;
    try {
      liveRaw = await apiFootball.getLiveFixtures(env, { retries: 1 });
      consecutiveRateLimits = 0;
    } catch (err) {
      console.error("live=all fetch failed:", err);
      // 라이브 경기가 있는 동안 이 호출이 막히면(레이트리밋 등) 골/카드 감지가 그 몇 초~몇 분간
      // 통째로 끊긴다 - 다른 크론 실패처럼 조용히 캐시로 폴백할 데이터 자체가 없어서 더 치명적이다.
      const isRateLimit = /rateLimit/.test(err.message);
      if (isRateLimit) {
        await alertAdminOfFailure(env, "livepoll-ratelimit", err).catch(() => {});
        consecutiveRateLimits++;
        // 연속으로 계속 걸리면 한도가 지금 당장은 안 돌아온다는 뜻 - 이번 틱 남은 예산을 다 써가며
        // 재시도하는 대신 깨끗이 포기하고 다음 크론 틱(최대 1분 뒤)에 다시 시도한다.
        if (consecutiveRateLimits >= MAX_CONSECUTIVE_RATE_LIMITS) return;
      }
      await sleep(isRateLimit ? RATE_LIMIT_BACKOFF_MS : POLL_INTERVAL_MS);
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
      if (Date.now() - lastCardCheck >= CARD_CHECK_INTERVAL_MS) {
        lastCardCheck = Date.now();
        await detectCardsAndNotify(env);
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }
}
