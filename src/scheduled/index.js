import { refreshApiFootballMatches } from "./refreshApiFootballMatches.js";
import { refreshApiFootballStandings } from "./refreshApiFootballStandings.js";
import { refreshNews } from "./refreshNews.js";
import { detectGoalsAndNotify } from "./detectGoalsAndNotify.js";
import { notifyLineups } from "./notifyLineups.js";
import { scrapeK3K4TopScorers } from "./scrapeK3K4TopScorers.js";
import { scrapeKLeagueTopPlayers } from "./scrapeKLeagueTopPlayers.js";
import { scrapeKLeaguePlayerPhotos } from "./scrapeKLeaguePlayerPhotos.js";
import { scrapeKLeagueCoachPhotos } from "./scrapeKLeagueCoachPhotos.js";
import { detectTransfersAndNotify } from "./detectTransfersAndNotify.js";
import { refreshTransferMarket } from "./refreshTransferMarket.js";
import { resolveCheckinOutcomes } from "./resolveCheckinOutcomes.js";
import { shouldRun } from "../lib/kv.js";
import { KV_KEYS, REFRESH_INTERVALS_MS } from "../lib/config.js";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 단일 Cron Trigger(5분 간격)가 여기로 들어와서, 소스별로 다른 주기를 내부적으로 흉내낸다.
// Workers 무료 플랜은 실행당 서브리퀘스트 50개 제한이 있어, 순위(refreshApiFootballStandings)는
// 매 tick 전체(14개 대회)를 한꺼번에 부르지 않고 자체적으로 몇 개씩만 순환 조회한다(내부 커서 방식).
export async function runScheduledTasks(env) {
  const tasks = [
    ["matches", () => refreshApiFootballMatches(env)],
    ["standings", () => refreshApiFootballStandings(env)],
  ];

  if (await shouldRun(env, `${KV_KEYS.lastRunPrefix}news`, REFRESH_INTERVALS_MS.news)) {
    tasks.push(["news", () => refreshNews(env)]);
  }

  // 이적시장 탭 데이터: 리그별 팀을 몇 개씩 순환 조회하는 무거운 작업이라 5분마다 다 돌리지 않는다.
  if (await shouldRun(env, `${KV_KEYS.lastRunPrefix}transfermarket-tick`, REFRESH_INTERVALS_MS.transferMarketTick)) {
    tasks.push(["transfer market", () => refreshTransferMarket(env)]);
  }

  // 항상 마지막에 실행 -> 이번 tick에 갱신된(혹은 최소한 최신) 스코어를 기준으로 골 발생 여부를 비교
  tasks.push(["goal notifications", () => detectGoalsAndNotify(env)]);
  tasks.push(["lineup notifications", () => notifyLineups(env)]);
  // 집관인증 승/패 정산도 매번 갱신된 스코어 기준으로 판단해야 하니 goal notifications 이후에 돈다.
  tasks.push(["checkin outcome resolution", () => resolveCheckinOutcomes(env)]);

  // K3/K4, K리그2 득점/도움 순위·사진은 API-Football이 부실해서 매주 일요일 밤 10시(KST)에 공식 사이트를 스크랩한다.
  // 사진 스크랩을 먼저 해야 득점/도움 순위 스크랩이 이번에 갱신된 사진으로 매칭할 수 있다.
  const nowKst = new Date(Date.now() + KST_OFFSET_MS);
  if (nowKst.getUTCDay() === 0 && nowKst.getUTCHours() === 22) {
    if (await shouldRun(env, `${KV_KEYS.lastRunPrefix}k3k4scorers`, 20 * 60 * 60 * 1000)) {
      tasks.push(["k3/k4 scorer scrape", () => scrapeK3K4TopScorers(env)]);
    }
    if (await shouldRun(env, `${KV_KEYS.lastRunPrefix}kleagueplayerphotos`, 20 * 60 * 60 * 1000)) {
      tasks.push(["k리그2 선수 사진 스크랩", () => scrapeKLeaguePlayerPhotos(env)]);
    }
    if (await shouldRun(env, `${KV_KEYS.lastRunPrefix}kleaguecoachphotos`, 20 * 60 * 60 * 1000)) {
      tasks.push(["k리그2 감독 사진 스크랩", () => scrapeKLeagueCoachPhotos(env)]);
    }
    if (await shouldRun(env, `${KV_KEYS.lastRunPrefix}kleaguetopplayers`, 20 * 60 * 60 * 1000)) {
      tasks.push(["k리그2 top players scrape", () => scrapeKLeagueTopPlayers(env)]);
    }
  }

  // 이적시장 감지는 팔로우한 팀 스쿼드를 하루 간격으로 대조하는 무거운 작업이라 자주 돌릴 필요 없다.
  if (await shouldRun(env, `${KV_KEYS.lastRunPrefix}transfers`, REFRESH_INTERVALS_MS.transfers)) {
    tasks.push(["transfer detection", () => detectTransfersAndNotify(env)]);
  }

  for (const [name, run] of tasks) {
    try {
      await run();
    } catch (err) {
      console.error(`scheduled task failed: ${name}`, err);
    }
  }
}
