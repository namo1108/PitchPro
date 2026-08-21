import { KV_KEYS } from "./config.js";
import { sendGoalPush } from "./push.js";
import { sendTossPush } from "./tossPush.js";

// 골/라인업/경기상태 알림 크론이 공통으로 쓰는 구독 로딩 - 예전엔 각 크론 파일이 각자 복붙해서 들고
// 있었는데, 그러다 보니 notifyLineups.js는 matchIds(경기별 개별 알림)를 깜빡 빼먹고 teamIds만 걸러서
// 즐겨찾기하지 않은 팀 경기를 🔔로 개별 지정해도 라인업 알림이 안 오는 문제가 있었다.
//
// 2026-08-22 - 웹 푸시 구독(push:sub:*)과 토스 미니앱 구독(toss:sub:*)을 함께 합쳐서 돌려준다 -
// kind로 어느 쪽인지 표시해두면, sendToSubscriber가 알아서 맞는 전송 방식으로 보내준다. 이렇게 해야
// 골/카드/라인업 알림 크론 코드를 건드리지 않고도 새 채널(토스)이 기존 로직에 자동으로 얹혀간다.
async function loadPrefixedSubs(env, prefix, kind) {
  const list = await env.CACHE.list({ prefix });
  const subs = await Promise.all(
    list.keys.map(async (k) => {
      const raw = await env.CACHE.get(k.name);
      return raw ? { key: k.name, kind, ...JSON.parse(raw) } : null;
    })
  );
  return subs.filter(Boolean);
}

export async function loadSubscriptions(env) {
  const [pushSubs, tossSubs] = await Promise.all([
    loadPrefixedSubs(env, KV_KEYS.pushSubscriptionPrefix, "webpush"),
    loadPrefixedSubs(env, KV_KEYS.tossSubscriptionPrefix, "toss"),
  ]);
  return [...pushSubs, ...tossSubs];
}

// 즐겨찾기한 팀(teamIds)의 경기이거나, 팀과 무관하게 🔔로 개별 지정한 경기(matchIds)면 "관심 있음".
export function filterInterested(subscriptions, match) {
  return subscriptions.filter(
    (s) => s.teamIds?.includes(match.homeTeam.id) || s.teamIds?.includes(match.awayTeam.id) || s.matchIds?.includes(match.id)
  );
}

// 설정 탭에서 종류별로 끈 알림인지 확인한다(record.prefs가 아예 없는 예전 구독은 전부 켜진 것으로
// 취급 - 이 기능 이전부터 있던 구독이 갑자기 알림을 못 받게 되면 안 되니까).
export function isTypeEnabled(sub, type) {
  return sub.prefs?.types?.[type] !== false;
}

// 크론들이 흩어져서 각자 sendGoalPush를 직접 부르던 걸 한 곳으로 모았다 - 종류별 on/off와 소리
// on/off(설정 탭) 둘 다 여기서 한 번에 처리해서, 새 알림 종류가 생겨도 이 체크를 깜빡할 일이 없다.
// 토스 구독(kind: "toss")은 소리/종류별 세부 설정이 아직 없어(콘솔 템플릿이 하나뿐) sound 옵션은
// 무시하고 그대로 보낸다 - image처럼 웹 푸시 전용 필드는 tossPush.js가 알아서 title/body만 쓴다.
export async function sendToSubscriber(env, sub, payload) {
  if (!isTypeEnabled(sub, payload.type)) return null;
  if (sub.kind === "toss") {
    const result = await sendTossPush(env, sub, payload);
    return { status: result.ok ? 200 : 500 };
  }
  const finalPayload = sub.prefs?.sound === false ? { ...payload, silent: true } : payload;
  return sendGoalPush(env, sub.subscription, finalPayload);
}

// 브라우저/OS 푸시 서비스가 구독을 만료시키면 발송이 404/410으로 실패하는데, 정리하지 않으면
// 그 구독은 매번 실패만 반복한다. 발견 즉시 KV에서 지워서 다음 접속 시 프론트가(push.js의 재구독
// 로직으로) 깨끗한 구독을 새로 등록하게 한다. 토스 구독은 sendToSubscriber가 절대 404/410을
// 돌려주지 않으므로(위 참고) 호출부의 상태 코드 체크로는 여기까지 안 오지만, username 인덱스
// prefix는 kind별로 다르니 혹시 몰라 분기해둔다.
export async function cleanupDeadSubscription(env, sub) {
  try {
    await env.CACHE.delete(sub.key);
    if (sub.username) {
      const indexPrefix = sub.kind === "toss" ? KV_KEYS.tossUsernameIndexPrefix : KV_KEYS.pushUsernameIndexPrefix;
      await env.CACHE.delete(`${indexPrefix}${sub.username}`);
    }
  } catch (err) {
    console.error("dead subscription cleanup failed:", err);
  }
}
