import { getJSON, putJSON } from "./kv.js";
import { KV_KEYS, GOAT_USERNAMES } from "./config.js";
import { getAuthedUser } from "./auth.js";
import { json } from "./http.js";

// 크론 작업이 조용히 실패해도 Workers 로그(아무도 안 봄) 안에서만 남던 걸 예전엔 관리자에게 매번
// 푸시로 바로 알렸는데, 1분 간격 크론이라 같은 문제가 지속되면 알림이 너무 잦다는 피드백(2026-08-26)
// 으로 푸시 대신 KV 로그에 쌓아두고 관리자 페이지(설정 > 관리자)에서 몰아서 확인하는 방식으로 바꿨다.
// 그래도 같은 작업이 1분마다 계속 실패하면 로그 한 줄만 남을 이유가 없으니(어차피 알아서 몰아보는
// 거라 굳이 dedupe 안 해도 되지만), 로그 자체가 같은 실패로 도배되는 걸 막기 위해 dedupe는 유지한다.
const ALERT_DEDUPE_TTL_SECONDS = 30 * 60;
const ALERT_LOG_MAX_ENTRIES = 200;

export async function alertAdminOfFailure(env, taskName, err) {
  const dedupeKey = `adminalert:${taskName}`;
  try {
    if (await env.CACHE.get(dedupeKey)) return;
    await env.CACHE.put(dedupeKey, "1", { expirationTtl: ALERT_DEDUPE_TTL_SECONDS });
  } catch {
    // 중복 방지용 캐시 자체가 실패해도(드묾) 로그는 일단 남긴다
  }

  const message = err instanceof Error ? err.message : String(err);
  try {
    const blob = (await getJSON(env, KV_KEYS.adminAlertLog)) || { entries: [] };
    blob.entries.unshift({
      id: crypto.randomUUID(),
      taskName,
      message: message.slice(0, 500),
      createdAt: new Date().toISOString(),
    });
    blob.entries = blob.entries.slice(0, ALERT_LOG_MAX_ENTRIES);
    await putJSON(env, KV_KEYS.adminAlertLog, blob);
  } catch (logErr) {
    console.error("admin alert log write failed:", logErr);
  }
}

// 관리자 페이지 전용 - 최근 실패/이상감지 로그를 최신순으로 돌려준다.
export async function handleListAdminAlerts(request, env) {
  const user = await getAuthedUser(request, env);
  if (!user || !GOAT_USERNAMES.includes(user.username)) return json({ detail: "권한이 없습니다." }, 403);

  const blob = await getJSON(env, KV_KEYS.adminAlertLog);
  return json({ entries: blob?.entries || [] });
}

// 확인 다 했으면 목록을 비워서 다음에 새로 쌓이는 것만 보이게 한다.
export async function handleClearAdminAlerts(request, env) {
  const user = await getAuthedUser(request, env);
  if (!user || !GOAT_USERNAMES.includes(user.username)) return json({ detail: "권한이 없습니다." }, 403);

  await putJSON(env, KV_KEYS.adminAlertLog, { entries: [] });
  return json({ ok: true });
}
