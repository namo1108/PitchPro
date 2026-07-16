import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import { getAuthedUser, findUserByNickname, normalizeNickname, userKey, levelProgress } from "../lib/auth.js";

function friendSummary(user) {
  const progress = levelProgress(user.points || 0, user.username);
  return { nickname: user.nickname, points: user.points || 0, level: progress.level, progress };
}

// 친구 추가는 승인 없이 즉시 등록(트위터 팔로우와 비슷한 단방향) - 서로 추가하면 자연히 맞팔 관계가 된다.
export async function handleAddFriend(request, env) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const body = await request.json().catch(() => null);
  const nickname = normalizeNickname(body?.nickname);
  if (!nickname) return json({ detail: "닉네임이 필요합니다." }, 400);
  if (nickname === user.nickname) return json({ detail: "자기 자신은 추가할 수 없습니다." }, 400);

  const target = await findUserByNickname(env, nickname);
  if (!target) return json({ detail: "해당 닉네임의 사용자를 찾을 수 없습니다." }, 404);

  const friends = new Set(user.friends || []);
  if (friends.has(target.username)) return json({ detail: "이미 친구로 등록되어 있습니다." }, 409);

  friends.add(target.username);
  user.friends = [...friends];
  await putJSON(env, userKey(user.username), user);

  return json({ status: "ok", friend: friendSummary(target) });
}

export async function handleRemoveFriend(request, env, nickname) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const target = await findUserByNickname(env, decodeURIComponent(nickname));
  if (!target) return json({ detail: "해당 닉네임의 사용자를 찾을 수 없습니다." }, 404);

  user.friends = (user.friends || []).filter((u) => u !== target.username);
  await putJSON(env, userKey(user.username), user);
  return json({ status: "ok" });
}

export async function handleListFriends(request, env) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const friends = await Promise.all((user.friends || []).map((username) => getJSON(env, userKey(username))));
  const list = friends
    .filter(Boolean)
    .map(friendSummary)
    .sort((a, b) => b.points - a.points);

  return json({ friends: list });
}
