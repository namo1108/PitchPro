import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS, COMPETITIONS } from "../lib/config.js";
import { MATCH_DURATION_BUFFER_MS } from "../lib/matchWindow.js";
import * as apiFootball from "../sources/apiFootball.js";
import { normalizeFixture } from "../adapters/apiFootballAdapter.js";
import { detectGoalsAndNotify } from "./detectGoalsAndNotify.js";
import { notifyMatchEvents } from "./notifyMatchEvents.js";
import { detectCardsAndNotify } from "./detectCardsAndNotify.js";
import { alertAdminOfFailure } from "../lib/adminAlert.js";

// 2026-11-10: 계정을 Mega 플랜(분당 900회, 기존 Pro 300회의 3배)으로 업그레이드했다 - 그동안 이
// 간격을 1초 -> 2.5초로 늦춰가며 버텼던 건 전부 Pro 플랜의 낮은 분당 한도 때문이었고(아래 지난
// 기록 참고), 이제 그 제약이 풀렸으니 원래 의도였던 1초 간격으로 되돌린다(알림 체감 속도를 최대한
// 빠르게). 분당 한도 여유가 3배로 늘어난 만큼, 이 루프 혼자 분당 ~50콜을 써도(1초 간격 * 50초)
// 다른 작업(크론 스윕, 실사용 트래픽)에 쓸 여유가 충분하다. 다시 레이트리밋이 잦아지면(admin alert
// log의 livepoll-ratelimit 빈도로 확인) 이 값을 다시 늘리는 걸 고려할 것 - 그 전엔 코드 튜닝보다
// 먼저 getApiDiagnostics(/api/admin/api-usage)로 실제 플랜이 맞는지부터 확인한다(과거에 이 주석과
// 실제 계정이 여러 번 어긋난 전례가 있음).
//
// 지난 기록(Pro 플랜 시절, 참고용): 원래 1초 간격이었는데(2026-08-09, 3초도 느리다는 피드백으로
// 줄임) "분당 한도 대비 여유 충분"이라던 가정이 안 맞아서(2026-08-30부터 레이트리밋 시간당 1~4회
// 반복) 2.5초로 늦췄었다. 2026-09-09엔 계정이 Ultra가 아니라 Pro(분당 300회)였다는 걸 확인했고,
// 2026-11-08엔 그사이 또 Pro로 돌아가 있던 걸 재확인해 Mega 업그레이드를 결정했다
// (project_pitchpro_ratelimit_tradeoffs 메모 참고).
const POLL_INTERVAL_MS = 1 * 1000;
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
// realtime: false 대회(2026-09-17 사용자 확인 - 노르웨이/덴마크/스코틀랜드/사우디/J2/J3/브라질;
// 호주/중국은 2026-11-10 Mega 플랜 업그레이드 후 사용자 요청으로 realtime 추적에 다시 포함됨)는
// 여기서도 빼서, 그 대회만 라이브라고 이 비싼 빠른 폴링(최대 분당 ~50콜, 2026-11-10 1초 간격으로
// 되돌림)이 도는 일이 없게 한다.
const TRACKED_CODES = new Set(COMPETITIONS.filter((c) => c.realtime !== false).map((c) => c.code));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Cloudflare Cron Trigger는 1분보다 촘촘히는 못 돌리는데, 골/상태변화 알림을 그보다 훨씬 빠르게
// 내보내려고 한 tick 안에서 라이브 경기가 있는 동안만 짧게 반복 조회한다.
// /fixtures?live=all은 대회 하나하나 부르는 것보다 훨씬 가벼운(호출 1번으로 전세계 라이브 경기 전부)
// 엔드포인트라 이 짧은 반복에 적합하다. 매번 받아온 최신 스코어/상태를 기존 경기 목록 캐시에 병합하고,
// 이미 있는 detectGoalsAndNotify/notifyMatchEvents를 그대로 재사용해 변화가 있으면 바로 알림을 보낸다
// (두 함수 다 "이전 값과 비교해서 달라졌을 때만" 동작하므로 매번 호출해도 중복 알림은 안 나간다).
export async function pollLiveMatches(env) {
  // 2026-11-08 추가, 2026-11-10 Mega 업그레이드 후에도 유지 - 플랜 한도가 올라도 겹치는 틱에서
  // 이 루프가 두 번 동시에 돌면 불필요하게 분당 호출을 두 배로 쓰는 건 똑같다(공짜로 막을 수 있는
  // 낭비라 플랜과 무관하게 계속 둔다) - 바로 아래서 이전 틱이 아직 돌고 있는지 확인해서 겹치면
  // 이번 틱은 통째로 건너뛴다(이미 돌고 있는 쪽이 골/카드 감지를 계속 담당하므로 알림이 끊기진 않음).
  const alreadyRunning = await env.CACHE.get(KV_KEYS.livePollRunning);
  if (alreadyRunning) {
    console.log("pollLiveMatches already running from an overlapping tick - skipping this invocation");
    return;
  }

  const deadline = Date.now() + POLL_DURATION_MS;
  let lastCardCheck = 0;
  let consecutiveRateLimits = 0;
  // 이 틱이 실제로 최대 50초짜리 빠른 폴링 루프를 도는지 표시해둔다(최초 1회만 씀 - 매 2.5초 반복문
  // 안에서 매번 쓰면 KV 무료 플랜 하루 쓰기 한도(1,000회)를 이 표시 하나로 다 써버린다). 크론이
  // 1분마다 도는데 이 루프 자체가 50초까지 걸릴 수 있어서, 라이브 경기가 많은 시간대엔 한 틱의
  // 폴링이 끝나기도 전에 다음 크론 틱이 겹쳐 들어오는 게 실제로 확인됐다(2026-09-09, "골 알림이
  // 늦다" 제보 조사 중 발견) - refreshApiFootballMatches(대회 10~14개 순차 조회, 그 자체로도
  // 15~20초+ 걸림)가 이 표시를 보고 겹치는 틱엔 자기 차례를 건너뛰어서, 가장 비싼 두 작업이 동시에
  // 레이트리밋 한도를 나눠 먹는 걸 막는다.
  let markedActive = false;
  // livePollActive와 달리 루프가 끝나는 즉시 지울 것(위 livePollRunning 오버랩 가드 전용) - finally에서 해제.
  let markedRunning = false;

  try {
  while (Date.now() < deadline) {
    const matchesBlob = await getJSON(env, KV_KEYS.matches);
    const cached = matchesBlob?.matches || [];
    // 킥오프 후 150분(연장/승부차기 포함 넉넉한 시간)이 지나도록 캐시가 여전히 IN_PLAY/PAUSED라고
    // 들고 있으면, 실제로는 이미 끝난 경기가 (레이트리밋 등으로) 상태 갱신이 안 된 채 멈춘 것이다.
    // live=all은 이미 끝난 경기를 다시는 돌려주지 않으니 이 루프로는 절대 못 고친다 - 그런데도
    // "라이브 경기가 있다"고 계속 판단하면 이 폴링 루프가 매 틱 50초씩 돌면서 livePollActive를
    // 계속 세워둬서, 실제로 이 상태를 바로잡을 수 있는 유일한 수단인 refreshApiFootballMatches(날짜
    // 범위로 다시 조회)가 영원히 스킵된다(2026-09-20, 레이트리밋 원인 수정 후에도 지난 경기가 계속
    // "지연"으로 남아있어서 발견 - 자기 자신을 계속 막는 교착상태였다). 그래서 이 판단에서는 너무
    // 오래된(스테일) IN_PLAY 경기는 빼고, 진짜 "지금 볼 가치가 있는" 라이브 경기만 센다.
    const now = Date.now();
    const isTrulyLive = (m) =>
      (m.status === "IN_PLAY" || m.status === "PAUSED") &&
      TRACKED_CODES.has(m.competition.code) &&
      now - new Date(m.utcDate).getTime() <= MATCH_DURATION_BUFFER_MS;
    if (!cached.some(isTrulyLive)) return; // 우리 대회 중 (스테일하지 않은) 라이브 경기가 없으면 더 돌 필요 없음

    if (!markedActive) {
      markedActive = true;
      markedRunning = true;
      // TTL(70초)로 자동 만료 - 이 틱이 끝나기 전에 죽어도(Cloudflare가 강제 종료 등) 다음 틱이
      // 영원히 막히지 않는다.
      await Promise.all([
        putJSON(env, KV_KEYS.livePollActive, { startedAt: Date.now() }, { expirationTtl: 70 }),
        putJSON(env, KV_KEYS.livePollRunning, { startedAt: Date.now() }, { expirationTtl: 70 }),
      ]);
    }

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
  } finally {
    // 루프가 끝나자마자(정상 종료든 return이든) 바로 지워서, 다음 틱이 TTL(70초) 다 만료되길
    // 기다리지 않고도 "지금은 안 도는 중"임을 바로 알 수 있게 한다 - livePollActive는 반대로 일부러
    // 안 지우고 TTL로만 만료시킨다(용도가 다름, 위 주석 참고).
    if (markedRunning) await env.CACHE.delete(KV_KEYS.livePollRunning).catch(() => {});
  }
}
