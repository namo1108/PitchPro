import { KV_KEYS } from "./config.js";
import { sendGoalPush } from "./push.js";

// 골/라인업/경기상태 알림 크론이 공통으로 쓰는 구독 로딩 - 예전엔 각 크론 파일이 각자 복붙해서 들고
// 있었는데, 그러다 보니 notifyLineups.js는 matchIds(경기별 개별 알림)를 깜빡 빼먹고 teamIds만 걸러서
// 즐겨찾기하지 않은 팀 경기를 🔔로 개별 지정해도 라인업 알림이 안 오는 문제가 있었다.
export async function loadSubscriptions(env) {
  const list = await env.CACHE.list({ prefix: KV_KEYS.pushSubscriptionPrefix });
  const subs = await Promise.all(
    list.keys.map(async (k) => {
      const raw = await env.CACHE.get(k.name);
      return raw ? { key: k.name, ...JSON.parse(raw) } : null;
    })
  );
  return subs.filter(Boolean);
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
export async function sendToSubscriber(env, sub, payload) {
  if (!isTypeEnabled(sub, payload.type)) return null;
  const finalPayload = sub.prefs?.sound === false ? { ...payload, silent: true } : payload;
  return sendGoalPush(env, sub.subscription, finalPayload);
}

// 브라우저/OS 푸시 서비스가 구독을 만료시키면 발송이 404/410으로 실패하는데, 정리하지 않으면
// 그 구독은 매번 실패만 반복한다. 발견 즉시 KV에서 지워서 다음 접속 시 프론트가(push.js의 재구독
// 로직으로) 깨끗한 구독을 새로 등록하게 한다.
export async function cleanupDeadSubscription(env, sub) {
  try {
    await env.CACHE.delete(sub.key);
    if (sub.username) await env.CACHE.delete(`${KV_KEYS.pushUsernameIndexPrefix}${sub.username}`);
  } catch (err) {
    console.error("dead subscription cleanup failed:", err);
  }
}
