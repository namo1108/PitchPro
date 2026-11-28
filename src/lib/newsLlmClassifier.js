// 키워드 매칭(newsClassifier.js)은 기사에 리그/팀 이름이 명확히 안 나오면 분류를 못 하고, 해외
// 빅클럽의 한글 표기도 수동으로 넣은 몇 개뿐이라 커버리지가 떨어진다 - LLM에게 기사 제목+본문을
// 통째로 보여주고 리그를 매기게 하면 축약어/암시적 표현까지 훨씬 정확하게 잡는다(2026-11-28 요청,
// "2번[LLM 분류] 적용해볼래?"). 기사 하나하나 호출하면 호출 수만큼 비용이 커지니 한 번의 호출에
// 전부 묶어서 보낸다. API 키가 없거나 호출/응답 파싱이 하나라도 실패하면 null을 돌려줘서, 호출부
// (refreshNews.js)가 기존 키워드 분류로 조용히 대체하게 한다 - 이 기능 하나 때문에 뉴스 탭 자체가
// 안 뜨는 일은 없어야 한다.
import { leagueCodeOptions } from "./newsClassifier.js";

const MODEL = "claude-haiku-5-5";
const MAX_DESCRIPTION_CHARS = 160;

function buildPrompt(items) {
  const options = leagueCodeOptions()
    .map(({ code, label }) => `${code}=${label}`)
    .join(", ");
  const list = items
    .map((n, i) => `${i}. ${n.title}${n.description ? " - " + n.description.slice(0, MAX_DESCRIPTION_CHARS) : ""}`)
    .join("\n");
  return (
    `다음은 축구 뉴스 기사 제목(+일부 본문) 목록이다. 각 기사가 아래 리그 코드 중 하나에 명확히 ` +
    `해당하면 그 코드를, 해당하는 리그가 없거나 애매하면 null을 매겨라. 코드를 지어내지 말고 반드시 ` +
    `아래 목록에 있는 코드만 써라.\n\n` +
    `사용 가능한 코드: ${options}\n\n` +
    `기사 목록:\n${list}\n\n` +
    `반드시 아래 JSON 배열 형식으로만 답하라. 설명이나 다른 텍스트는 절대 넣지 마라. 기사 전부를 ` +
    `빠짐없이, 받은 순서 그대로 포함해라.\n` +
    `[{"i":0,"code":"PL"},{"i":1,"code":null}]`
  );
}

function parseResponse(text, count) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const byIndex = new Map();
  for (const entry of parsed) {
    if (entry && typeof entry.i === "number") byIndex.set(entry.i, entry.code || null);
  }
  const result = [];
  for (let i = 0; i < count; i++) result.push(byIndex.has(i) ? byIndex.get(i) : null);
  return result;
}

// items: 분류할 뉴스 아이템 배열({title, description}). 반환값은 items와 같은 길이의
// 리그 코드(또는 null) 배열이거나, 전체 실패 시 null.
export async function classifyNewsWithLlm(env, items) {
  if (!env.ANTHROPIC_API_KEY || !items.length) return null;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        messages: [{ role: "user", content: buildPrompt(items) }],
      }),
    });
    if (!res.ok) {
      console.error("news LLM classify failed:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json();
    const text = (data.content || []).map((c) => c.text || "").join("");
    return parseResponse(text, items.length);
  } catch (err) {
    console.error("news LLM classify error:", err);
    return null;
  }
}
