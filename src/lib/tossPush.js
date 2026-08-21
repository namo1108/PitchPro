// 앱인토스(토스 미니앱) 스마트발송 - 일반 API 키가 아니라 mTLS(상호 인증서) 인증만 지원해서,
// wrangler.jsonc에 등록해둔 mtls_certificates 바인딩(env.TOSS_MTLS)을 통해서만 호출할 수 있다.
// 콘솔에서 등록한 템플릿(발송 코드 pitchpro-notify)의 제목/내용이 전부 {{title}}/{{body}} 변수
// 하나씩이라, 우리가 보내는 값이 곧 사용자가 보는 알림 문구 그대로다.
import { KV_KEYS } from "./config.js";
import { getJSON } from "./kv.js";

const TOSS_SEND_URL = "https://apps-in-toss-api.toss.im/api-partner/v1/apps-in-toss/messenger/send-message";
export const TOSS_TEMPLATE_CODE = "pitchpro-notify";

// 콘솔 템플릿 제작 시 글자수 제한(제목 7자, 내용 25자, 공백 포함)은 변수 자리를 2자로만 계산해서
// 만들 때는 안 걸리지만, 실제 값이 그보다 길면 화면에서 잘릴 수 있다 - 안전하게 맞춰 자른다.
function truncate(text, max) {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// sub는 { anonKey } 또는 { userKey } 중 하나를 갖고 있어야 한다(토스 로그인 연동 시 userKey 우선).
export async function sendTossPush(env, sub, { title, body }) {
  const headers = { "content-type": "application/json" };
  if (sub.userKey) headers["x-toss-user-key"] = String(sub.userKey);
  else if (sub.anonKey) headers["x-anon-key"] = String(sub.anonKey);
  else return { ok: false, reason: "no-recipient-key" };

  const res = await env.TOSS_MTLS.fetch(TOSS_SEND_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      templateSetCode: TOSS_TEMPLATE_CODE,
      context: { title: truncate(title, 7), body: truncate(body, 25) },
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.resultType === "SUCCESS", status: res.status, data };
}

// push.js의 sendPushToUsername과 대응되는 토스 버전 - 관리자 테스트 발송용.
export async function sendTossPushToUsername(env, username, payload) {
  const subKey = await env.CACHE.get(`${KV_KEYS.tossUsernameIndexPrefix}${username}`);
  if (!subKey) return false;
  const record = await getJSON(env, subKey);
  if (!record?.anonKey) return false;
  const result = await sendTossPush(env, record, payload);
  if (!result.ok) console.error(`toss push to username ${username} failed:`, JSON.stringify(result.data));
  return result.ok;
}
