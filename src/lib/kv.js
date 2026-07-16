export async function getJSON(env, key) {
  const raw = await env.CACHE.get(key);
  return raw ? JSON.parse(raw) : null;
}

// 캐시 쓰기는 어디까지나 최적화용이라, KV 일일 쓰기 한도 초과 등으로 실패해도 이미 계산된 응답 자체는
// 정상적으로 나가야 한다 -> 실패를 조용히 삼킨다(호출부마다 try/catch를 반복하지 않도록 여기서 처리).
export async function putJSON(env, key, value, { expirationTtl } = {}) {
  try {
    const options = expirationTtl ? { expirationTtl } : undefined;
    await env.CACHE.put(key, JSON.stringify(value), options);
  } catch (err) {
    console.error(`KV put failed for ${key}:`, err);
  }
}

export async function shouldRun(env, taskKey, intervalMs) {
  const key = `${taskKey}`;
  const last = await env.CACHE.get(key);
  const now = Date.now();
  if (last && now - Number(last) < intervalMs) {
    return false;
  }
  try {
    await env.CACHE.put(key, String(now));
  } catch (err) {
    console.error(`KV put failed for ${key}:`, err);
  }
  return true;
}
