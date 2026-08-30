import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS, LIVE_DETAIL_CACHE_TTL_SECONDS } from "../lib/config.js";
import { buildMatchDetail, fillFromFlashscore, fillFromScoreman, fillFromAiscore } from "../routes/matchDetail.js";

const LIVE_STATUSES = new Set(["IN_PLAY", "PAUSED"]);
const CAPTURE_CODES = new Set(["K3", "K4"]);

// K3/K4 스탯 소스(라이브스코어/scoreman123/AiScore)는 그 경기가 라이브인 동안(또는 끝난 직후 짧게만)
// 데이터를 들고 있다가 시간이 지나면 지워버린다 - 그래서 "누군가 그 경기 화면을 열 때"만 조회하는
// 기존 방식(matchDetail.js)으로는, 아무도 라이브 중에 안 열어본 경기는 스탯을 영영 놓친다(2026-08-30
// 제보 - 서산 vs 남양주, 금산인삼FC vs 진주시민 둘 다 몇 시간 뒤에 열어봤더니 이미 소스 쪽 데이터가
// 사라진 뒤였음). 그래서 라이브 중인 K3/K4 경기는 아무도 안 보고 있어도 주기적으로 미리 캐싱해둔다.
export async function captureK3K4Stats(env) {
  const blob = await getJSON(env, KV_KEYS.matches);
  const liveMatches = (blob?.matches || []).filter((m) => CAPTURE_CODES.has(m.competition.code) && LIVE_STATUSES.has(m.status));
  if (!liveMatches.length) return;

  for (const m of liveMatches) {
    try {
      await captureOne(env, m);
    } catch (err) {
      console.error(`k3/k4 stats capture failed for ${m.id}:`, err);
    }
  }
}

async function captureOne(env, m) {
  const cacheKey = `${KV_KEYS.detailPrefix}${m.id}`;
  const cached = await getJSON(env, cacheKey);

  if (!cached) {
    // 아무도 아직 안 열어본 경기 - API-Football 포함 전체 상세를 한 번 만들어서 캐시에 부트스트랩한다
    // (라인업/이벤트도 이 김에 같이 채워짐 - buildMatchDetail이 알아서 캐시 저장까지 한다).
    await buildMatchDetail(env, m.id);
    return;
  }

  // 이미 한 번 열어본 적 있는 경기 - API-Football을 다시 부르는 무거운 전체 재조회는 피하고, 시간
  // 지나면 사라지는 외부 스탯 소스만 다시 시도해서 캐시된 스탯을 최신 값으로 갱신한다.
  const patched = { ...cached, statistics: [] };
  await fillFromFlashscore(env, patched, true, false);
  await fillFromScoreman(env, patched, true, false);
  await fillFromAiscore(env, patched, true, false);
  if (patched.statistics.length) {
    await putJSON(env, cacheKey, { ...cached, statistics: patched.statistics }, { expirationTtl: LIVE_DETAIL_CACHE_TTL_SECONDS });
  }
}
