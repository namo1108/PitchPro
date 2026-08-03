import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS, GOAT_USERNAMES } from "../lib/config.js";
import { getAuthedUser } from "../lib/auth.js";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
function todayKst() {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

// 외부 분석 도구(GA 등) 없이 자체적으로 남기는 익명 집계 통계 - 누가 봤는지가 아니라 "오늘 각 탭이
// 몇 번 열렸는지/주요 이벤트가 몇 번 일어났는지"만 날짜별로 더한다. 개인 식별자, IP, 유저 id는
// 저장하지 않는다. 임의 키가 KV에 쌓이지 않도록 화이트리스트로 제한한다.
const TRACKED_VIEWS = new Set(["matches", "news", "leagues", "transfers", "ai", "myteam", "hof", "community", "settings", "soccerschool"]);
const TRACKED_EVENTS = new Set(["signup", "login", "checkin"]);

const ANALYTICS_CACHE_TTL_SECONDS = 120 * 24 * 60 * 60; // 120일 지나면 자동 정리

export async function handleTrack(request, env) {
  const body = await request.json().catch(() => null);
  const kind = body?.kind === "event" ? "event" : "view";
  const name = String(body?.name || "");

  if (kind === "view" && !TRACKED_VIEWS.has(name)) return json({ ok: true });
  if (kind === "event" && !TRACKED_EVENTS.has(name)) return json({ ok: true });

  const key = `${KV_KEYS.analyticsPrefix}${todayKst()}`;
  const bucket = kind === "view" ? "views" : "events";
  const blob = (await getJSON(env, key)) || { views: {}, events: {} };
  blob[bucket][name] = (blob[bucket][name] || 0) + 1;
  await putJSON(env, key, blob, { expirationTtl: ANALYTICS_CACHE_TTL_SECONDS });

  return json({ ok: true });
}

// 관리자 페이지에서 최근 N일 집계를 확인하는 용도 - /admin/ 경로라 관리자만 봐야 하는데, 정작
// 이 핸들러엔 권한 체크가 빠져있던 걸 관리자 페이지 분리 작업 중 테스트하다 발견해서 추가했다
// (노출되는 값 자체는 익명 집계라 민감하진 않지만, 다른 /admin/* 라우트와 일관되게 막아야 함).
export async function handleAnalyticsSummary(request, env, url) {
  const user = await getAuthedUser(request, env);
  if (!user || !GOAT_USERNAMES.includes(user.username)) return json({ detail: "권한이 없습니다." }, 403);

  const days = Math.min(Number(url.searchParams.get("days")) || 7, 30);
  const out = [];
  const now = Date.now();
  for (let i = 0; i < days; i++) {
    const date = new Date(now + KST_OFFSET_MS - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const blob = await getJSON(env, `${KV_KEYS.analyticsPrefix}${date}`);
    out.push({ date, views: blob?.views || {}, events: blob?.events || {} });
  }
  return json({ days: out });
}
