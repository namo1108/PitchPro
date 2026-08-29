import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import * as apiFootball from "../sources/apiFootball.js";
import { normalizeGoalEvents } from "../adapters/apiFootballAdapter.js";
import { loadSubscriptions, filterInterested, cleanupDeadSubscription, sendToSubscriber } from "../lib/subscriptions.js";

// 골이 감지된 경기는 이벤트 조회로 득점자 이름까지 알아내서 알림 문구에 붙인다(실패해도 알림 자체는 보냄).
async function getTeamGoalEvents(env, matchId, teamId) {
  try {
    const raw = await apiFootball.getFixtureEvents(env, matchId);
    return normalizeGoalEvents(raw.response).filter((g) => g.teamId === teamId);
  } catch {
    return [];
  }
}

// 경기에 관심있는 구독자 각각에게, buildPayload(sub)가 만들어준 알림을 보낸다 - 골/실점처럼
// "응원하는 팀이 넣었는지 먹혔는지"에 따라 구독자별로 문구가 달라져야 하는 경우를 위해 콜백으로 뺐다.
async function sendToInterested(env, subscriptions, match, buildPayload) {
  const interested = filterInterested(subscriptions, match);
  for (const sub of interested) {
    const payload = buildPayload(sub);
    if (!payload) continue;
    try {
      const res = await sendToSubscriber(env, sub, payload);
      if (res && (res.status === 404 || res.status === 410)) {
        await cleanupDeadSubscription(env, sub);
      }
    } catch (err) {
      console.error("push send failed:", err);
    }
  }
}

export async function detectGoalsAndNotify(env) {
  const [matchesBlob, prev] = await Promise.all([getJSON(env, KV_KEYS.matches), getJSON(env, KV_KEYS.prevScores)]);

  const live = (matchesBlob?.matches || []).filter((m) => m.status === "IN_PLAY" || m.status === "PAUSED");

  const prevScores = prev?.scores || {};
  // pending: "바뀐 걸 봤지만 아직 확정 안 한" 스코어. 전체 경기 스윕(리그별 조회)과 라이브 빠른 폴링
  // (live=all)이 서로 다른 타이밍에 같은 경기를 갱신하다 보니, 한쪽이 순간적으로 스코어를 잘못
  // 읽어서(또는 API-Football 쪽 데이터가 한 틱만 흔들려서) 실제로는 안 바뀐 스코어가 바뀐 것처럼
  // 보였다가 다음 틱에 원래대로 돌아오는 경우가 있었다(2026-07-24, 서산FC vs 기장FC 경기에서 실점/
  // 골취소 알림이 계속 반복해서 나간 사고). 그래서 스코어가 바뀐 걸 감지해도 바로 알리지 않고,
  // "같은 새 값을 두 틱 연속으로 봤을 때"만 확정해서 알린다 - 한 틱짜리 흔들림은 다음 틱에 원래
  // 값으로 돌아오면서 자동으로 버려진다.
  const prevPending = prev?.pending || {};
  // K3/K4는 API-Football 자체의 라이브 상태/스코어 판정이 불안정해서(가끔 몇 틱씩 잘못된 스코어를
  // 들고 왔다가 되돌아옴 - 2026-08-22 기장군민 vs 진주시민, 2026-08-23 서산에프씨 vs 금산인삼FC,
  // 2026-08-29 서산에프씨 재발) 일반 대회용 "2틱 연속" 확정만으로는 부족해서 매번 뚫렸다. K3/K4만
  // 3틱 연속(대기 2번)을 요구해서 흔들림이 더 오래 버텨도 걸러지게 한다 - 다른 대회는 지금처럼 2틱.
  const STRICT_CONFIRM_CODES = new Set(["K3", "K4"]);
  // 승부차기 스코어(score.penalty)는 fullTime과 별개 필드라 따로 이전 값을 기억해야 한다 - 연장까지
  // 마친 뒤 무승부라 승부차기에 들어간 경기만 이 값이 채워진다(리그 경기 등은 항상 null).
  const prevPenalty = prev?.penalty || {};
  const nextScores = {};
  const nextPending = {};
  const nextPenalty = {};
  const scoredEvents = [];
  const shootoutEvents = [];
  // VAR 등으로 골이 취소되면 스코어가 "줄어드는" 형태로 나타난다(늘었다가 되돌아옴) - 늘어나는 경우와
  // 반대로 별도 감지해서 "골 취소" 알림으로 보낸다.
  const cancelledMatches = [];

  for (const m of live) {
    const penHome = m.score.penalty?.home;
    const penAway = m.score.penalty?.away;
    const hasShootout = penHome !== null && penHome !== undefined && penAway !== null && penAway !== undefined;
    if (hasShootout) {
      const observedPen = { home: penHome, away: penAway };
      const confirmedPen = prevPenalty[m.id];
      nextPenalty[m.id] = observedPen;
      // 골 스코어와 달리 흔들림 방지용 2틱 확정을 굳이 두지 않는다 - 승부차기는 발생 빈도가 훨씬
      // 낮아 값이 튀는 사고가 재발할 위험이 적고, 한 틱 늦게(또는 빠르게) 알려도 큰 문제가 안 된다.
      if (confirmedPen) {
        if (penHome > confirmedPen.home) shootoutEvents.push({ match: m, scoringTeamId: m.homeTeam.id, otherTeamId: m.awayTeam.id });
        if (penAway > confirmedPen.away) shootoutEvents.push({ match: m, scoringTeamId: m.awayTeam.id, otherTeamId: m.homeTeam.id });
      }
    }

    const home = m.score.fullTime.home ?? 0;
    const away = m.score.fullTime.away ?? 0;
    const observed = { home, away };
    const confirmed = prevScores[m.id];

    // 이 경기를 처음 보는 틱 - 기준점만 잡고 알림은 안 보낸다(경기 중간에 처음 인지했다고 그동안
    // 쌓인 골까지 전부 새 골처럼 알리면 안 되니까).
    if (!confirmed) {
      nextScores[m.id] = observed;
      continue;
    }

    // 변화 없음 - 흔들리던 값이 있었으면(pending) 원래대로 돌아온 거니 그냥 버린다.
    if (observed.home === confirmed.home && observed.away === confirmed.away) {
      nextScores[m.id] = confirmed;
      continue;
    }

    const candidate = prevPending[m.id];
    const sameAsCandidate = candidate && candidate.home === observed.home && candidate.away === observed.away;
    const requiredSightings = STRICT_CONFIRM_CODES.has(m.competition.code) ? 3 : 2;

    if (!sameAsCandidate) {
      // 값이 바뀐 걸 처음 본 틱 - 아직 확정하지 않고 다음 틱에 같은 값인지 지켜본다.
      nextScores[m.id] = confirmed;
      nextPending[m.id] = { ...observed, seen: 1 };
      continue;
    }

    const seen = (candidate.seen || 1) + 1;
    if (seen < requiredSightings) {
      // 같은 값이 또 나왔지만 K3/K4 기준(3틱)엔 아직 못 미침 - 한 번 더 지켜본다.
      nextScores[m.id] = confirmed;
      nextPending[m.id] = { ...observed, seen };
      continue;
    }

    // 요구 틱 수만큼 연속 같은 새 값 -> 확정하고 알림 대상에 올린다.
    // 크론 간격 사이 같은 팀이 2골 이상 넣으면 점수 차이(count)가 1보다 커진다 -> 그만큼 알림도 여러 건
    // 보내야 하는데, 예전엔 "골이 들어갔다" 여부만 봐서 한 틱에 여러 골이 몰리면 뒤 골 알림만 가고
    // 앞 골 알림은 통째로 누락됐었다.
    nextScores[m.id] = observed;
    const homeDelta = observed.home - confirmed.home;
    const awayDelta = observed.away - confirmed.away;
    if (homeDelta > 0) scoredEvents.push({ match: m, scoringTeamId: m.homeTeam.id, otherTeamId: m.awayTeam.id, count: homeDelta });
    if (awayDelta > 0) scoredEvents.push({ match: m, scoringTeamId: m.awayTeam.id, otherTeamId: m.homeTeam.id, count: awayDelta });
    if (homeDelta < 0 || awayDelta < 0) cancelledMatches.push(m);
  }

  // 진행 중인 경기가 하나도 없으면 쓸 것도 없다 -> KV 무료 플랜의 하루 쓰기 한도(1,000회)를 아끼기 위해 스킵.
  if (live.length > 0) {
    await putJSON(env, KV_KEYS.prevScores, { scores: nextScores, pending: nextPending, penalty: nextPenalty });
  }

  if (scoredEvents.length === 0 && cancelledMatches.length === 0 && shootoutEvents.length === 0) return;

  const subscriptions = await loadSubscriptions(env);
  if (subscriptions.length === 0) return;

  for (const { match, scoringTeamId, otherTeamId, count } of scoredEvents) {
    // live=all이 전세계 라이브 경기를 전부 캐시에 합쳐두기 때문에(pollLiveMatches.js), 아무도 구독
    // 안 한 해외 경기의 골까지 매번 득점자 조회(getFixtureEvents)를 하면 레이트리밋만 갉아먹는다
    // (2026-08-22) - 관심있는 구독자가 없으면 이벤트 조회 자체를 건너뛴다.
    if (filterInterested(subscriptions, match).length === 0) continue;

    const home = match.score.fullTime.home;
    const away = match.score.fullTime.away;
    const teamGoals = await getTeamGoalEvents(env, match.id, scoringTeamId);
    // 이번에 새로 늘어난 골만큼(count) 최근 골 이벤트를 뒤에서 잘라 각각 알림 하나씩 만든다.
    // 이벤트 조회 자체가 실패했으면 득점자 이름 없이도 최소 count건은 보낸다(놓치는 것보단 낫다).
    const newGoals = teamGoals.length >= count ? teamGoals.slice(-count) : Array.from({ length: count }, () => ({ scorer: null }));
    // 알림에 큰 이미지(image)를 붙여도 안드로이드가 접힌 채로 보여줄 수 있어(펼쳐야 이미지가 보임) -
    // 펼쳐보라고 알려주는 시스템 UI가 따로 없어서, 본문 글자 끝에 힌트를 붙여 눈치채게 한다.
    const scoreLine = `${match.homeTeam.shortName || match.homeTeam.name} ${home} - ${away} ${match.awayTeam.shortName || match.awayTeam.name} · ⌄ 펼쳐서 확인`;
    const scoringTeam = scoringTeamId === match.homeTeam.id ? match.homeTeam : match.awayTeam;

    for (const g of newGoals) {
      // 알림을 펼치면 득점팀 엠블럼+득점자+시간이 그려진 이미지가 보이도록(설정 탭 안내에 쓰인 그
      // 골 세리모니 카드와 같은 스타일) - 응원팀 기준 문구(골/실점)와 무관하게 이 이미지 자체는
      // "누가 득점했는지"만 보여주면 되니 한 번만 만들어서 재사용한다.
      const image = `/api/notif-image/goal?team=${encodeURIComponent(scoringTeam.shortName || scoringTeam.name)}&crest=${encodeURIComponent(
        scoringTeam.crest || ""
      )}&scorer=${encodeURIComponent(g.scorer || "")}&minute=${encodeURIComponent(g.minute || "")}`;

      await sendToInterested(env, subscriptions, match, (sub) => {
        // 구독자가 응원하는 팀 기준으로 "우리팀 골"인지 "실점"인지 갈라서 보낸다. 응원 팀 없이
        // 🔔로만 지켜보는 경기(matchIds)는 중립적으로 항상 "골!"로 보낸다.
        const cheersScoringTeam = sub.teamIds?.includes(scoringTeamId);
        const cheersOtherTeam = sub.teamIds?.includes(otherTeamId);
        if (cheersOtherTeam && !cheersScoringTeam) {
          return { type: "concede", title: g.scorer ? `😢 실점... ${g.scorer}` : "😢 실점...", body: scoreLine, matchId: match.id, image };
        }
        return { type: "goal", title: g.scorer ? `⚽ 골! ${g.scorer}` : "⚽ 골!", body: scoreLine, matchId: match.id, image };
      });
    }
  }

  for (const match of cancelledMatches) {
    const home = match.score.fullTime.home;
    const away = match.score.fullTime.away;
    const image = `/api/notif-image/status?homeTeam=${encodeURIComponent(
      match.homeTeam.shortName || match.homeTeam.name
    )}&homeCrest=${encodeURIComponent(match.homeTeam.crest || "")}&awayTeam=${encodeURIComponent(
      match.awayTeam.shortName || match.awayTeam.name
    )}&awayCrest=${encodeURIComponent(match.awayTeam.crest || "")}&homeScore=${home}&awayScore=${away}&badge=${encodeURIComponent(
      "CANCELLED"
    )}&color=${encodeURIComponent("#ef4444")}`;
    await sendToInterested(env, subscriptions, match, () => ({
      type: "var_cancel",
      title: "🚫 골 취소(VAR)",
      body: `${match.homeTeam.shortName || match.homeTeam.name} ${home} - ${away} ${match.awayTeam.shortName || match.awayTeam.name} · 스코어가 정정됐습니다`,
      matchId: match.id,
      image,
    }));
  }

  // 승부차기 성공 키커의 이름은 API-Football 이벤트 detail이 일반 페널티킥과 똑같이 "Penalty"라 정규
  // 시간 PK와 구분할 방법이 없다(득점자를 특정할 수 없음) - 그래서 득점자 없이 "현재 스코어"만으로
  // 알린다(정규시간 골 알림처럼 이름은 못 붙이지만, "지금 성공했다"는 실시간성 자체가 핵심 정보다).
  for (const { match, scoringTeamId, otherTeamId } of shootoutEvents) {
    const pen = match.score.penalty;
    const scoreLine = `${match.homeTeam.shortName || match.homeTeam.name} ${pen.home} - ${pen.away} ${match.awayTeam.shortName || match.awayTeam.name} (승부차기)`;
    await sendToInterested(env, subscriptions, match, (sub) => {
      const cheersScoringTeam = sub.teamIds?.includes(scoringTeamId);
      const cheersOtherTeam = sub.teamIds?.includes(otherTeamId);
      if (cheersOtherTeam && !cheersScoringTeam) {
        return { type: "concede", title: "😢 승부차기 실점...", body: scoreLine, matchId: match.id };
      }
      return { type: "goal", title: "⚽ 승부차기 성공!", body: scoreLine, matchId: match.id };
    });
  }
}
