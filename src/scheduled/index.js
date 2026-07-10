import { refreshFootballDataMatches } from "./refreshFootballDataMatches.js";
import { refreshFootballDataStandings } from "./refreshFootballDataStandings.js";
import { refreshKLeagueMatches } from "./refreshKLeagueMatches.js";
import { refreshKLeagueStandings } from "./refreshKLeagueStandings.js";
import { refreshNews } from "./refreshNews.js";
import { detectGoalsAndNotify } from "./detectGoalsAndNotify.js";
import { shouldRun } from "../lib/kv.js";
import { KV_KEYS, REFRESH_INTERVALS_MS } from "../lib/config.js";

// 단일 Cron Trigger(5분 간격)가 여기로 들어와서, 소스별로 다른 주기를 내부적으로 흉내낸다.
export async function runScheduledTasks(env) {
  const tasks = [
    ["football-data matches", () => refreshFootballDataMatches(env)],
    ["football-data standings", () => refreshFootballDataStandings(env)],
  ];

  if (await shouldRun(env, `${KV_KEYS.lastRunPrefix}kleague-matches`, REFRESH_INTERVALS_MS.kLeagueMatches)) {
    tasks.push(["k-league matches", () => refreshKLeagueMatches(env)]);
  }
  if (await shouldRun(env, `${KV_KEYS.lastRunPrefix}kleague-standings`, REFRESH_INTERVALS_MS.kLeagueStandings)) {
    tasks.push(["k-league standings", () => refreshKLeagueStandings(env)]);
  }
  if (await shouldRun(env, `${KV_KEYS.lastRunPrefix}news`, REFRESH_INTERVALS_MS.news)) {
    tasks.push(["news", () => refreshNews(env)]);
  }

  // 항상 마지막에 실행 -> 이번 tick에 갱신된(혹은 최소한 최신) 스코어를 기준으로 골 발생 여부를 비교
  tasks.push(["goal notifications", () => detectGoalsAndNotify(env)]);

  for (const [name, run] of tasks) {
    try {
      await run();
    } catch (err) {
      console.error(`scheduled task failed: ${name}`, err);
    }
  }
}
