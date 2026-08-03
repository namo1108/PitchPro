import { sendPushToUsername } from "./push.js";
import { GOAT_USERNAMES } from "./config.js";

// 크론 작업이 조용히 실패해도 Workers 로그(아무도 안 봄) 안에서만 남던 걸, 관리자 계정(GOAT_USERNAMES
// 첫 번째 - 이스터에그와 같은 계정을 그대로 재사용)에게 푸시로 바로 알린다. 1분 간격 크론에서 같은
// 작업이 계속 실패하면 매번 알림이 오게 되니, 작업 이름 기준으로 30분에 한 번만 보낸다.
const ALERT_DEDUPE_TTL_SECONDS = 30 * 60;

export async function alertAdminOfFailure(env, taskName, err) {
  const admin = GOAT_USERNAMES[0];
  if (!admin) return;

  const dedupeKey = `adminalert:${taskName}`;
  try {
    if (await env.CACHE.get(dedupeKey)) return;
    await env.CACHE.put(dedupeKey, "1", { expirationTtl: ALERT_DEDUPE_TTL_SECONDS });
  } catch {
    // 중복 방지용 캐시 자체가 실패해도(드묾) 알림은 일단 보낸다
  }

  const message = err instanceof Error ? err.message : String(err);
  try {
    await sendPushToUsername(env, admin, {
      type: "admin_alert",
      title: `⚠️ 크론 실패: ${taskName}`,
      body: message.slice(0, 180),
    });
  } catch (pushErr) {
    console.error("admin alert push failed:", pushErr);
  }
}
