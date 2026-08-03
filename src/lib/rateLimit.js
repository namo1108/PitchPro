import { getJSON, putJSON } from "./kv.js";

// Cloudflare가 원 클라이언트 IP를 이 헤더로 넣어준다(프록시 체인 상관없이 신뢰 가능).
export function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}

function bucketKey(key) {
  return `ratelimit:${key}`;
}

// 가입처럼 성공/실패 구분 없이 "시도 횟수 자체"를 제한할 때 쓴다 - 부를 때마다 무조건 센다.
export async function isRateLimited(env, key, max, windowSeconds) {
  const now = Date.now();
  const k = bucketKey(key);
  let data = await getJSON(env, k);
  if (!data || now > data.resetAt) {
    data = { count: 0, resetAt: now + windowSeconds * 1000 };
  }
  data.count += 1;
  await putJSON(env, k, data, { expirationTtl: windowSeconds + 10 });
  return data.count > max;
}

// 로그인/비밀번호 찾기처럼 "틀린 시도만" 세야 하는 경우를 위한 한 쌍 - 정상적으로 여러 번
// 로그인하는 사용자가 이 제한에 걸리는 일이 없도록, 미리 막혀있는지 확인(isBlockedByFailures,
// 증가 없음)과 실패했을 때만 늘리는 것(recordFailure)을 분리했다.
export async function isBlockedByFailures(env, key, max) {
  const data = await getJSON(env, bucketKey(key));
  if (!data) return false;
  return Date.now() <= data.resetAt && data.count >= max;
}

export async function recordFailure(env, key, windowSeconds) {
  const now = Date.now();
  const k = bucketKey(key);
  let data = await getJSON(env, k);
  if (!data || now > data.resetAt) {
    data = { count: 0, resetAt: now + windowSeconds * 1000 };
  }
  data.count += 1;
  await putJSON(env, k, data, { expirationTtl: windowSeconds + 10 });
}

export async function clearFailures(env, key) {
  await env.CACHE.delete(bucketKey(key)).catch(() => {});
}
