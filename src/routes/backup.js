import { json } from "../lib/http.js";
import { KV_KEYS, GOAT_USERNAMES } from "../lib/config.js";
import { getAuthedUser } from "../lib/auth.js";

async function dumpPrefix(env, prefix) {
  const out = [];
  let cursor;
  do {
    const list = await env.CACHE.list({ prefix, cursor });
    for (const k of list.keys) {
      const raw = await env.CACHE.get(k.name);
      if (raw) {
        try {
          out.push(JSON.parse(raw));
        } catch {
          // 값이 JSON이 아닌 키(레이트리밋 카운터 등은 애초에 이 prefix 안 씀)는 건너뛴다.
        }
      }
    }
    cursor = list.cursor;
  } while (!list.list_complete && cursor);
  return out;
}

// KV 하나에만 있는 계정/커뮤니티 데이터를 실수로 날려도 복구할 수 있게, 관리자가 수동으로 눌러서
// JSON 파일 하나로 통째로 내려받는 용도(자동 정기 백업은 아님 - Workers엔 파일시스템이 없어서
// 브라우저 다운로드가 가장 간단한 백업 경로). 비밀번호 해시가 포함돼 있으니 관리자 전용으로 제한한다.
export async function handleBackupExport(request, env) {
  const user = await getAuthedUser(request, env);
  if (!user || !GOAT_USERNAMES.includes(user.username)) return json({ detail: "권한이 없습니다." }, 403);

  const [users, posts] = await Promise.all([dumpPrefix(env, KV_KEYS.userPrefix), dumpPrefix(env, KV_KEYS.communityPostPrefix)]);

  const payload = {
    exportedAt: new Date().toISOString(),
    counts: { users: users.length, posts: posts.length },
    users,
    posts,
  };

  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="pitchpro-backup-${date}.json"`,
    },
  });
}
