import { json } from "../lib/http.js";
import { getAuthedUser, getPointsLog } from "../lib/auth.js";

// 본인 포인트 내역만 볼 수 있다 - 로그인한 사용자 기준으로 조회(다른 사람 것은 노출하지 않음).
export async function handlePointsHistory(request, env) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);
  const history = await getPointsLog(env, user.username);
  return json({ history });
}
