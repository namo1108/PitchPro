import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import { getAuthedUser, findUserByNickname, normalizeNickname, userKey, levelProgress } from "../lib/auth.js";
import { sendPushToUsername } from "../lib/push.js";

function friendSummary(user) {
  const progress = levelProgress(user.points || 0, user.username);
  return { nickname: user.nickname, points: user.points || 0, level: progress.level, progress };
}

// 친구는 이제 요청 -> 수락 방식(단방향 즉시 추가가 아님) - 요청을 받으면 상대에게, 수락되면
// 둘 다에게 알림이 간다. 이미 구독(로그인 연결)돼 있지 않은 사용자는 조용히 무시된다.
export async function handleSendFriendRequest(request, env) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const body = await request.json().catch(() => null);
  const nickname = normalizeNickname(body?.nickname);
  if (!nickname) return json({ detail: "닉네임이 필요합니다." }, 400);
  if (nickname === user.nickname) return json({ detail: "자기 자신은 추가할 수 없습니다." }, 400);

  const target = await findUserByNickname(env, nickname);
  if (!target) return json({ detail: "해당 닉네임의 사용자를 찾을 수 없습니다." }, 404);

  if ((user.friends || []).includes(target.username)) return json({ detail: "이미 친구로 등록되어 있습니다." }, 409);
  if ((user.friendRequestsOutgoing || []).includes(target.username)) return json({ detail: "이미 친구 요청을 보냈습니다." }, 409);

  // 상대가 나에게 이미 요청을 보내둔 상태라면(서로 신청) 그냥 바로 친구로 맺어준다.
  if ((user.friendRequestsIncoming || []).includes(target.username)) {
    return acceptFriendRequest(env, user, target);
  }

  user.friendRequestsOutgoing = [...new Set([...(user.friendRequestsOutgoing || []), target.username])];
  target.friendRequestsIncoming = [...new Set([...(target.friendRequestsIncoming || []), user.username])];

  await putJSON(env, userKey(user.username), user);
  await putJSON(env, userKey(target.username), target);

  await sendPushToUsername(env, target.username, {
    type: "friend_request",
    title: "👥 친구 요청",
    body: `${user.nickname}님이 친구 요청을 보냈어요.`,
  });

  return json({ status: "requested" });
}

async function acceptFriendRequest(env, user, target) {
  user.friends = [...new Set([...(user.friends || []), target.username])];
  target.friends = [...new Set([...(target.friends || []), user.username])];
  user.friendRequestsIncoming = (user.friendRequestsIncoming || []).filter((u) => u !== target.username);
  user.friendRequestsOutgoing = (user.friendRequestsOutgoing || []).filter((u) => u !== target.username);
  target.friendRequestsIncoming = (target.friendRequestsIncoming || []).filter((u) => u !== user.username);
  target.friendRequestsOutgoing = (target.friendRequestsOutgoing || []).filter((u) => u !== user.username);

  await putJSON(env, userKey(user.username), user);
  await putJSON(env, userKey(target.username), target);

  await Promise.all([
    sendPushToUsername(env, user.username, { type: "friend_accept", title: "🤝 친구 수락", body: `${target.nickname}님과 친구가 되었어요.` }),
    sendPushToUsername(env, target.username, { type: "friend_accept", title: "🤝 친구 수락", body: `${user.nickname}님과 친구가 되었어요.` }),
  ]);

  return json({ status: "ok", friend: friendSummary(target) });
}

// URL 파라미터는 (사용자명이 아니라) 닉네임으로 받는다 - username은 로그인 식별자라 다른 곳처럼 클라이언트에
// 노출하지 않고, 여기서만 findUserByNickname으로 내부적으로 풀어서 쓴다.
export async function handleAcceptFriendRequest(request, env, requesterNickname) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const requester = await findUserByNickname(env, decodeURIComponent(requesterNickname));
  if (!requester || !(user.friendRequestsIncoming || []).includes(requester.username)) {
    return json({ detail: "받은 친구 요청이 없습니다." }, 404);
  }

  return acceptFriendRequest(env, user, requester);
}

export async function handleDeclineFriendRequest(request, env, requesterNickname) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const requester = await findUserByNickname(env, decodeURIComponent(requesterNickname));
  if (!requester) return json({ detail: "사용자를 찾을 수 없습니다." }, 404);

  user.friendRequestsIncoming = (user.friendRequestsIncoming || []).filter((u) => u !== requester.username);
  await putJSON(env, userKey(user.username), user);

  requester.friendRequestsOutgoing = (requester.friendRequestsOutgoing || []).filter((u) => u !== user.username);
  await putJSON(env, userKey(requester.username), requester);

  return json({ status: "ok" });
}

export async function handleListFriendRequests(request, env) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const requesters = await Promise.all((user.friendRequestsIncoming || []).map((username) => getJSON(env, userKey(username))));
  const list = requesters.filter(Boolean).map(friendSummary);
  return json({ requests: list });
}

export async function handleRemoveFriend(request, env, nickname) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const target = await findUserByNickname(env, decodeURIComponent(nickname));
  if (!target) return json({ detail: "해당 닉네임의 사용자를 찾을 수 없습니다." }, 404);

  user.friends = (user.friends || []).filter((u) => u !== target.username);
  target.friends = (target.friends || []).filter((u) => u !== user.username);
  await putJSON(env, userKey(user.username), user);
  await putJSON(env, userKey(target.username), target);
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
