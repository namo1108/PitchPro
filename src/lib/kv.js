export async function getJSON(env, key) {
  const raw = await env.CACHE.get(key);
  return raw ? JSON.parse(raw) : null;
}

export async function putJSON(env, key, value, { expirationTtl } = {}) {
  const options = expirationTtl ? { expirationTtl } : undefined;
  await env.CACHE.put(key, JSON.stringify(value), options);
}

export async function shouldRun(env, taskKey, intervalMs) {
  const key = `${taskKey}`;
  const last = await env.CACHE.get(key);
  const now = Date.now();
  if (last && now - Number(last) < intervalMs) {
    return false;
  }
  await env.CACHE.put(key, String(now));
  return true;
}
