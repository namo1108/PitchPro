import { fetchAllNewsFeeds } from "../sources/newsRss.js";
import { normalizeNewsItem } from "../adapters/newsAdapter.js";
import { putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";
import { buildNewsClassifier, leagueCodeOptions } from "../lib/newsClassifier.js";
import { classifyNewsWithLlm } from "../lib/newsLlmClassifier.js";

// BBC 피드 자체가 같은 기사를 카테고리 중복 등의 이유로 두 번씩 내려줄 때가 있어(link 기준 실제 확인됨),
// 링크 기준으로 한 번만 남긴다 - 안 그러면 목록에 똑같은 카드가 겹쳐 보인다.
function dedupeByLink(items) {
  const seen = new Set();
  return items.filter((n) => {
    if (seen.has(n.link)) return false;
    seen.add(n.link);
    return true;
  });
}

export async function refreshNews(env) {
  const [raw, classify] = await Promise.all([fetchAllNewsFeeds(), buildNewsClassifier(env)]);
  const deduped = dedupeByLink(
    raw
      .map(normalizeNewsItem)
      .filter((n) => n.title && n.link)
      .sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0))
  ).slice(0, 40);

  // LLM으로 한 번에 분류를 시도하고(2026-11-28 - 키워드 매칭보다 축약어/암시적 표현을 훨씬 잘
  // 잡는다), 기사별로 LLM이 못 맡혔거나 호출 자체가 실패했으면 기존 키워드 분류로 대체한다 - 이
  // 기능 하나 때문에 리그 배지가 아예 안 뜨는 일은 없게 한다.
  const llmCodes = await classifyNewsWithLlm(env, deduped).catch(() => null);
  const labelByCode = Object.fromEntries(leagueCodeOptions().map((o) => [o.code, o.label]));

  const news = deduped.map((n, i) => {
    const llmCode = llmCodes?.[i];
    if (llmCode && labelByCode[llmCode]) return { ...n, leagueCode: llmCode, leagueLabel: labelByCode[llmCode] };
    return { ...n, ...classify(`${n.title} ${n.description}`) };
  });

  if (news.length > 0) {
    await putJSON(env, KV_KEYS.news, { items: news, lastUpdated: new Date().toISOString() });
  }
}
