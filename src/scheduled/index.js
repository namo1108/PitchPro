import { refreshApiFootballMatches } from "./refreshApiFootballMatches.js";
import { refreshApiFootballStandings } from "./refreshApiFootballStandings.js";
import { refreshKLeagueResults } from "./refreshKLeagueResults.js";
import { refreshKfaResults } from "./refreshKfaResults.js";
import { refreshKfaCupResults } from "./refreshKfaCupResults.js";
import { refreshNews } from "./refreshNews.js";
import { detectGoalsAndNotify } from "./detectGoalsAndNotify.js";
import { refreshNationalTeams } from "./refreshNationalTeams.js";
import { refreshAnalysis } from "./refreshAnalysis.js";
import { notifyLineups } from "./notifyLineups.js";
import { notifyMatchEvents } from "./notifyMatchEvents.js";
import { notifyUpcomingKickoff } from "./notifyUpcomingKickoff.js";
import { refreshBrackets } from "./refreshBrackets.js";
import { enrichTransferFees } from "./enrichTransferFees.js";
import { pollLiveMatches } from "./pollLiveMatches.js";
import { scrapeK3K4TopScorers } from "./scrapeK3K4TopScorers.js";
import { captureK3K4Stats } from "./captureK3K4Stats.js";
import { scrapeKLeagueTopPlayers } from "./scrapeKLeagueTopPlayers.js";
import { scrapeKLeaguePlayerPhotos } from "./scrapeKLeaguePlayerPhotos.js";
import { scrapeKLeagueCoachPhotos } from "./scrapeKLeagueCoachPhotos.js";
import { detectTransfersAndNotify } from "./detectTransfersAndNotify.js";
import { refreshTransferMarket } from "./refreshTransferMarket.js";
import { resolveCheckinOutcomes } from "./resolveCheckinOutcomes.js";
import { scrapeKLeagueAdidasPoints } from "./scrapeKLeagueAdidasPoints.js";
import { shouldRun } from "../lib/kv.js";
import { KV_KEYS, REFRESH_INTERVALS_MS } from "../lib/config.js";
import { alertAdminOfFailure } from "../lib/adminAlert.js";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 단일 Cron Trigger(1분 간격, Cloudflare가 허용하는 최소 단위)가 여기로 들어와서, 소스별로 다른
// 주기를 내부적으로 흉내낸다. Workers 무료 플랜은 실행당 서브리퀘스트 50개 제한이 있어, 순위
// (refreshApiFootballStandings)는 매 tick 전체(14개 대회)를 한꺼번에 부르지 않고 자체적으로 몇 개씩만
// 순환 조회한다(내부 커서 방식).
export async function runScheduledTasks(env) {
  const tasks = [
    ["matches", () => refreshApiFootballMatches(env)],
    ["standings", () => refreshApiFootballStandings(env)],
  ];

  if (await shouldRun(env, `${KV_KEYS.lastRunPrefix}news`, REFRESH_INTERVALS_MS.news)) {
    tasks.push(["news", () => refreshNews(env)]);
  }

  // K리그 공식 사이트(kleague.com)는 API-Football 쿼터와 무관한 별도 소스라, API-Football 한도가
  // 소진돼도 K리그 최종 스코어만큼은 이걸로 계속 보정된다(2026-07-21 쿼터 소진 사고 재발 방지).
  // 부담 없는 무료 소스라 2분 간격으로 자주 확인한다.
  if (await shouldRun(env, `${KV_KEYS.lastRunPrefix}kleagueresults`, 2 * 60 * 1000)) {
    tasks.push(["k리그 공식 결과 보정", () => refreshKLeagueResults(env)]);
  }

  // K3/K4는 KFA 공식 사이트가 폴백 소스(kleague.com과 별개) - 라운드 표를 매번 1라운드부터 훑는
  // 다소 무거운 조회라(리그당 최대 40회), kleague 폴백(2분)보다는 여유 있게 10분 간격으로 돈다.
  if (await shouldRun(env, `${KV_KEYS.lastRunPrefix}kfaresults`, 10 * 60 * 1000)) {
    tasks.push(["kfa(k3/k4) 공식 결과 보정", () => refreshKfaResults(env)]);
  }
  // 코리아컵은 대진표 전체를 한 번에 받아오는 훨씬 가벼운 조회라(라운드 페이지네이션 없음) K3/K4보다
  // 자주 돌려도 부담이 적다.
  if (await shouldRun(env, `${KV_KEYS.lastRunPrefix}kfacupresults`, 5 * 60 * 1000)) {
    tasks.push(["kfa 코리아컵 결과 보정", () => refreshKfaCupResults(env)]);
  }

  // K3/K4 라이브 스탯(라이브스코어/scoreman123/AiScore)은 그 경기가 라이브인 동안만 잠깐 데이터를
  // 들고 있다가 시간 지나면 지워버려서, 아무도 라이브 중에 안 열어본 경기는 스탯을 영영 놓친다
  // (2026-08-30 제보) - 라이브 중인 K3/K4 경기는 아무도 안 보고 있어도 주기적으로 미리 캐싱해둔다.
  if (await shouldRun(env, `${KV_KEYS.lastRunPrefix}k3k4statscapture`, 5 * 60 * 1000)) {
    tasks.push(["k3/k4 라이브 스탯 사전 캐싱", () => captureK3K4Stats(env)]);
  }

  // 이적시장 탭 데이터: 리그별 팀을 몇 개씩 순환 조회하는 무거운 작업이라 5분마다 다 돌리지 않는다.
  if (await shouldRun(env, `${KV_KEYS.lastRunPrefix}transfermarket-tick`, REFRESH_INTERVALS_MS.transferMarketTick)) {
    tasks.push(["transfer market", () => refreshTransferMarket(env)]);
  }

  // K리그 공식 파워랭킹(ADIDAS Point) - AI 분석에 곁들일 공식 데이터라, 매 라운드 정도 갱신되면 충분해서 6시간마다.
  if (await shouldRun(env, `${KV_KEYS.lastRunPrefix}kleagueadidaspoints`, 6 * 60 * 60 * 1000)) {
    tasks.push(["k리그 adidas point scrape", () => scrapeKLeagueAdidasPoints(env)]);
  }

  // 국가대표팀 명단(팀 검색용)은 거의 안 바뀌는 데이터라 하루 한 번이면 충분하다.
  if (await shouldRun(env, `${KV_KEYS.lastRunPrefix}nationalteams`, 24 * 60 * 60 * 1000)) {
    tasks.push(["국가대표팀 명단 갱신", () => refreshNationalTeams(env)]);
  }

  // AI 분석 캐시가 만료되기 전에 미리 다시 채워서, 실사용자가 이 무거운 계산을 직접 기다리는 일
  // (냉캐시 시 몇 초 소요)이 없게 한다. 팀 폼/부상/배당 같은 정보는 어차피 시간 단위로 바뀌지
  // 분 단위로 바뀌진 않아서 이 정도 주기로도 충분하다.
  // 2026-08-11 카드 수를 6 -> 20으로 늘리면서(analysis.js 참고) 갱신 1회 비용도 커져 1시간 -> 90분으로
  // 한 번 더 늘렸다(하루 총 호출량을 비슷한 수준으로 유지하기 위함).
  if (await shouldRun(env, `${KV_KEYS.lastRunPrefix}analysis`, 90 * 60 * 1000)) {
    tasks.push(["AI 분석 사전 갱신", () => refreshAnalysis(env)]);
  }

  // 라이브 중인 대회만 골라 대진표 캐시를 앞서 채워둔다(대부분의 틱엔 라이브 브래킷 경기가 없어
  // 내부에서 바로 반환되니 비용이 거의 없음).
  tasks.push(["bracket refresh", () => refreshBrackets(env)]);
  // 항상 마지막에 실행 -> 이번 tick에 갱신된(혹은 최소한 최신) 스코어를 기준으로 골 발생 여부를 비교
  tasks.push(["goal notifications", () => detectGoalsAndNotify(env)]);
  // 카드(경고/퇴장) 알림은 2026-08-09부터 여기서 안 돌고 pollLiveMatches 안에서 15초 간격으로 돈다 -
  // events 조회가 경기당 비용이라 매번(3초)은 부담되지만, 예전처럼 1분에 한 번만 확인하면 최대 60초
  // 지연이 나서(사용자 피드백) 그 중간값을 찾은 것. 그쪽에서 이미 하므로 여기서 또 부르면 중복 비용만 든다.
  // 킥오프/전반전 종료/경기 종료 알림 - 골과 별개로 "상태" 전이를 본다.
  tasks.push(["match event notifications", () => notifyMatchEvents(env)]);
  tasks.push(["lineup notifications", () => notifyLineups(env)]);
  tasks.push(["kickoff 5분 전 알림", () => notifyUpcomingKickoff(env)]);
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
  // API-Football이 안 주는 실제 이적료를 Transfermarkt에서 아주 조금씩(틱당 5건) 찾아 캐싱해둔다 -
  // API-Football 쿼터와 무관한 별도 사이트라 shouldRun 주기는 그 사이트에 부담 안 주는 선에서만 결정.
  if (await shouldRun(env, `${KV_KEYS.lastRunPrefix}transfermarktfees`, 10 * 60 * 1000)) {
    tasks.push(["이적료 보강(Transfermarkt)", () => enrichTransferFees(env)]);
  }

  // 항상 맨 마지막: 1분 크론 주기로도 골 알림이 굼뜨게 느껴져서, 라이브 경기가 있는 동안은 이
  // tick 안에서 10초 간격으로 짧게 더 돌며 골/상태변화를 훨씬 빠르게 잡아낸다(라이브 경기가
  // 없으면 즉시 반환되어 비용이 들지 않음).
  tasks.push(["live match fast poll", () => pollLiveMatches(env)]);

  for (const [name, run] of tasks) {
    try {
      await run();
    } catch (err) {
      console.error(`scheduled task failed: ${name}`, err);
      await alertAdminOfFailure(env, name, err).catch(() => {});
    }
  }
}
