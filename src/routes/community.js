import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import {
  KV_KEYS,
  COMMUNITY_MAX_POSTS,
  COMMUNITY_TITLE_MAX_LENGTH,
  COMMUNITY_BODY_MAX_LENGTH,
  COMMUNITY_COMMENT_MAX_LENGTH,
  GOAT_USERNAMES,
} from "../lib/config.js";
import { getAuthedUser } from "../lib/auth.js";
import { findBlockedWord } from "../lib/contentFilter.js";

function postKey(id) {
  return `${KV_KEYS.communityPostPrefix}${id}`;
}

async function loadIndex(env) {
  const blob = await getJSON(env, KV_KEYS.communityPostIndex);
  return blob?.posts || [];
}

function canModerate(username) {
  return GOAT_USERNAMES.includes(String(username || "").toLowerCase());
}

const COMMUNITY_CATEGORIES = ["국축", "해축"];

// 팬 커뮤니티 게시판 목록 - 최신순 요약(제목/닉네임/댓글 수/태그한 팀/국축·해축 구분)만 돌려준다.
// 로그인 여부와 무관하게 누구나 읽을 수 있고(경기/뉴스처럼), 글쓰기/댓글만 로그인이 필요하다.
// ?category=국축|해축 로 국내/해외축구 탭을 나누고, ?teamId=로 특정 팀 얘기만 더 좁혀볼 수 있다.
export async function handleListPosts(request, env, url) {
  const posts = await loadIndex(env);
  const teamId = url?.searchParams.get("teamId");
  const category = url?.searchParams.get("category");
  // category 필드가 없는 예전 글(이 구분을 넣기 전에 작성됨)이 필터링 때문에 아예 안 보이는 일이
  // 없도록, 없으면 기본값 "국축"으로 취급한다.
  const filtered = posts
    .filter((p) => !category || (p.category || "국축") === category)
    .filter((p) => !teamId || p.team?.id === teamId);
  return json({ posts: filtered });
}

export async function handleCreatePost(request, env) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const body = await request.json().catch(() => null);
  const title = String(body?.title || "").trim();
  const text = String(body?.body || "").trim();
  const category = String(body?.category || "");
  if (!COMMUNITY_CATEGORIES.includes(category)) return json({ detail: "국축/해축 중 하나를 선택해주세요." }, 400);
  if (!title || !text) return json({ detail: "제목과 내용을 모두 입력해주세요." }, 400);
  if (title.length > COMMUNITY_TITLE_MAX_LENGTH) return json({ detail: `제목은 ${COMMUNITY_TITLE_MAX_LENGTH}자 이내로 입력해주세요.` }, 400);
  if (text.length > COMMUNITY_BODY_MAX_LENGTH) return json({ detail: `내용은 ${COMMUNITY_BODY_MAX_LENGTH}자 이내로 입력해주세요.` }, 400);
  const blocked = findBlockedWord(title) || findBlockedWord(text);
  if (blocked) return json({ detail: "욕설/음란/혐오 표현이 포함되어 있어 게시할 수 없습니다." }, 400);

  // 팀 태그는 선택사항 - 글쓴이가 팀 검색에서 고른 걸 그대로 실어보낸다(서버가 다시 조회할 필요 없음).
  const teamId = body?.teamId ? String(body.teamId) : null;
  const team = teamId ? { id: teamId, name: String(body?.teamName || "").slice(0, 60), crest: body?.teamCrest || null } : null;

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const post = { id, title, body: text, category, team, username: user.username, nickname: user.nickname, createdAt, comments: [] };
  await putJSON(env, postKey(id), post);

  const index = await loadIndex(env);
  index.unshift({ id, title, category, team, nickname: user.nickname, createdAt, commentCount: 0 });
  // 목록 캡을 넘어가는 오래된 글은 상세도 같이 지운다(아카이브 없는 최신 위주 게시판이라는 설계 그대로).
  const overflow = index.splice(COMMUNITY_MAX_POSTS);
  await putJSON(env, KV_KEYS.communityPostIndex, { posts: index });
  for (const dropped of overflow) {
    await env.CACHE.delete(postKey(dropped.id)).catch(() => {});
  }

  return json({ status: "ok", post: { ...post, comments: [] } });
}

export async function handleGetPost(request, env, id) {
  const post = await getJSON(env, postKey(id));
  if (!post) return json({ detail: "게시글을 찾을 수 없습니다." }, 404);
  return json({ post });
}

export async function handleCreateComment(request, env, id) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const body = await request.json().catch(() => null);
  const text = String(body?.body || "").trim();
  if (!text) return json({ detail: "댓글 내용을 입력해주세요." }, 400);
  if (text.length > COMMUNITY_COMMENT_MAX_LENGTH) return json({ detail: `댓글은 ${COMMUNITY_COMMENT_MAX_LENGTH}자 이내로 입력해주세요.` }, 400);
  if (findBlockedWord(text)) return json({ detail: "욕설/음란/혐오 표현이 포함되어 있어 게시할 수 없습니다." }, 400);

  const post = await getJSON(env, postKey(id));
  if (!post) return json({ detail: "게시글을 찾을 수 없습니다." }, 404);

  const comment = { id: crypto.randomUUID(), body: text, username: user.username, nickname: user.nickname, createdAt: new Date().toISOString() };
  post.comments = [...(post.comments || []), comment];
  await putJSON(env, postKey(id), post);

  const index = await loadIndex(env);
  const entry = index.find((p) => p.id === id);
  if (entry) {
    entry.commentCount = post.comments.length;
    await putJSON(env, KV_KEYS.communityPostIndex, { posts: index });
  }

  return json({ status: "ok", comment });
}

export async function handleDeletePost(request, env, id) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const post = await getJSON(env, postKey(id));
  if (!post) return json({ detail: "게시글을 찾을 수 없습니다." }, 404);
  if (post.username !== user.username && !canModerate(user.username)) {
    return json({ detail: "본인 글만 삭제할 수 있습니다." }, 403);
  }

  await env.CACHE.delete(postKey(id));
  const index = await loadIndex(env);
  await putJSON(env, KV_KEYS.communityPostIndex, { posts: index.filter((p) => p.id !== id) });

  return json({ status: "ok" });
}

export async function handleEditComment(request, env, id, commentId) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const body = await request.json().catch(() => null);
  const text = String(body?.body || "").trim();
  if (!text) return json({ detail: "댓글 내용을 입력해주세요." }, 400);
  if (text.length > COMMUNITY_COMMENT_MAX_LENGTH) return json({ detail: `댓글은 ${COMMUNITY_COMMENT_MAX_LENGTH}자 이내로 입력해주세요.` }, 400);
  if (findBlockedWord(text)) return json({ detail: "욕설/음란/혐오 표현이 포함되어 있어 게시할 수 없습니다." }, 400);

  const post = await getJSON(env, postKey(id));
  if (!post) return json({ detail: "게시글을 찾을 수 없습니다." }, 404);

  const comment = (post.comments || []).find((c) => c.id === commentId);
  if (!comment) return json({ detail: "댓글을 찾을 수 없습니다." }, 404);
  // 삭제와 달리 수정은 작성자 본인만 가능하다(운영자가 남의 댓글 내용을 바꿔치기할 수 있게 하는 건
  // 과한 권한이라 canModerate는 여기 적용하지 않음 - 문제되는 댓글은 삭제로 대응).
  if (comment.username !== user.username) return json({ detail: "본인 댓글만 수정할 수 있습니다." }, 403);

  comment.body = text;
  comment.editedAt = new Date().toISOString();
  await putJSON(env, postKey(id), post);

  return json({ status: "ok", comment });
}

const REPORT_LIST_MAX = 300;

async function loadReports(env) {
  const blob = await getJSON(env, KV_KEYS.communityReportIndex);
  return blob?.reports || [];
}

// 게시글/댓글 신고 - 관리자가 모든 글을 다 훑어볼 수 없으니, 이용자가 문제 있는 글/댓글을 표시해두면
// 관리자 신고함(handleListReports)에 모여서 검토 후 삭제할 수 있다. 같은 사람이 같은 대상을 여러 번
// 눌러도 신고함이 중복으로 쌓이지 않게 dedupe한다.
async function createReport(request, env, { postId, commentId, targetSnapshot }) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const reports = await loadReports(env);
  const already = reports.some((r) => r.postId === postId && r.commentId === commentId && r.reporterUsername === user.username && r.status === "open");
  if (already) return json({ status: "ok" });

  const reason = String((await request.json().catch(() => null))?.reason || "").slice(0, 200);
  const report = {
    id: crypto.randomUUID(),
    postId,
    commentId: commentId || null,
    reason,
    reporterUsername: user.username,
    targetSnapshot,
    status: "open",
    createdAt: new Date().toISOString(),
  };
  reports.unshift(report);
  await putJSON(env, KV_KEYS.communityReportIndex, { reports: reports.slice(0, REPORT_LIST_MAX) });

  return json({ status: "ok" });
}

export async function handleReportPost(request, env, id) {
  const post = await getJSON(env, postKey(id));
  if (!post) return json({ detail: "게시글을 찾을 수 없습니다." }, 404);
  return createReport(request, env, {
    postId: id,
    commentId: null,
    targetSnapshot: { title: post.title, body: post.body, authorUsername: post.username, authorNickname: post.nickname },
  });
}

export async function handleReportComment(request, env, id, commentId) {
  const post = await getJSON(env, postKey(id));
  if (!post) return json({ detail: "게시글을 찾을 수 없습니다." }, 404);
  const comment = (post.comments || []).find((c) => c.id === commentId);
  if (!comment) return json({ detail: "댓글을 찾을 수 없습니다." }, 404);
  return createReport(request, env, {
    postId: id,
    commentId,
    targetSnapshot: { body: comment.body, authorUsername: comment.username, authorNickname: comment.nickname, postTitle: post.title },
  });
}

// 관리자 전용 - 처리 대기중(open)인 신고만 최신순으로 돌려준다.
export async function handleListReports(request, env) {
  const user = await getAuthedUser(request, env);
  if (!user || !canModerate(user.username)) return json({ detail: "권한이 없습니다." }, 403);

  const reports = await loadReports(env);
  return json({ reports: reports.filter((r) => r.status === "open") });
}

// 관리자가 신고를 처리 - action이 "delete"면 신고된 게시글/댓글도 함께 지운다(dismiss는 신고만 닫음).
export async function handleResolveReport(request, env, reportId) {
  const user = await getAuthedUser(request, env);
  if (!user || !canModerate(user.username)) return json({ detail: "권한이 없습니다." }, 403);

  const body = await request.json().catch(() => null);
  const action = body?.action === "delete" ? "delete" : "dismiss";

  const reports = await loadReports(env);
  const report = reports.find((r) => r.id === reportId);
  if (!report) return json({ detail: "신고 내역을 찾을 수 없습니다." }, 404);

  if (action === "delete") {
    if (report.commentId) {
      await handleDeleteComment(request, env, report.postId, report.commentId);
    } else {
      await handleDeletePost(request, env, report.postId);
    }
  }

  // 같은 글/댓글을 겨냥한 다른 열린 신고도 이번에 같이 처리된 걸로 정리한다(한 게시물에 신고가 여러 건
  // 쌓였는데 하나씩 처리할 때마다 나머지가 신고함에 계속 남아있으면 관리자가 중복으로 다시 봐야 함).
  for (const r of reports) {
    if (r.status === "open" && r.postId === report.postId && r.commentId === report.commentId) {
      r.status = "resolved";
    }
  }
  await putJSON(env, KV_KEYS.communityReportIndex, { reports });

  return json({ status: "ok" });
}

export async function handleDeleteComment(request, env, id, commentId) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const post = await getJSON(env, postKey(id));
  if (!post) return json({ detail: "게시글을 찾을 수 없습니다." }, 404);

  const comment = (post.comments || []).find((c) => c.id === commentId);
  if (!comment) return json({ detail: "댓글을 찾을 수 없습니다." }, 404);
  if (comment.username !== user.username && !canModerate(user.username)) {
    return json({ detail: "본인 댓글만 삭제할 수 있습니다." }, 403);
  }

  post.comments = post.comments.filter((c) => c.id !== commentId);
  await putJSON(env, postKey(id), post);

  const index = await loadIndex(env);
  const entry = index.find((p) => p.id === id);
  if (entry) {
    entry.commentCount = post.comments.length;
    await putJSON(env, KV_KEYS.communityPostIndex, { posts: index });
  }

  return json({ status: "ok" });
}
