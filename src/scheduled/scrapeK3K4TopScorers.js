import { putJSON } from "../lib/kv.js";

// KFA 공식 사이트가 API-Football이 주지 않는 K3/K4 득점 순위를 표로 직접 제공하고 있어서,
// 매주 일요일 밤에 이 표를 파싱해서 가져온다(도움 순위는 이 페이지에 없어 득점만 스크랩됨).
const SOURCES = {
  K3: { url: "https://www.kfa.or.kr/competition/k3_2026.php", chartId: "goal_chart1" },
  K4: { url: "https://www.kfa.or.kr/competition/k4_2026.php", chartId: "goal_chart2" },
};

function makeScorerTableState() {
  return { rows: [], row: null, colIndex: -1 };
}

// <tr><td>순위</td><td>선수이름</td><td><img src="...">팀명</td><td>득점</td><td>출전경기수</td></tr>
function attachHandlers(rewriter, selectorPrefix, state) {
  rewriter
    .on(`${selectorPrefix} tr`, {
      element() {
        state.row = { name: "", team: "", teamCrest: null, value: 0 };
        state.colIndex = -1;
        state.rows.push(state.row);
      },
    })
    .on(`${selectorPrefix} tr td`, {
      element() {
        state.colIndex += 1;
      },
      text(chunk) {
        if (!state.row) return;
        const text = chunk.text;
        if (!text) return;
        if (state.colIndex === 1) state.row.name += text;
        else if (state.colIndex === 2) state.row.team += text;
        else if (state.colIndex === 3) state.row.value += text;
      },
    })
    .on(`${selectorPrefix} tr td img`, {
      element(el) {
        if (state.row && state.colIndex === 2) {
          state.row.teamCrest = el.getAttribute("src");
        }
      },
    });
}

async function scrapeOne(env, code, { url, chartId }) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; PitchProBot/1.0)" } });
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);

  const state = makeScorerTableState();
  const selectorPrefix = `#${chartId} table.rank tbody`;
  const rewriter = new HTMLRewriter();
  attachHandlers(rewriter, selectorPrefix, state);
  const transformed = rewriter.transform(res);
  await transformed.text(); // 스트림을 끝까지 읽어야 위 핸들러들이 전부 실행된다

  const topScorers = state.rows
    .map((r) => ({ name: r.name.trim(), team: r.team.trim(), teamCrest: r.teamCrest, value: parseInt(r.value, 10) || 0 }))
    .filter((r) => r.name && r.value > 0)
    .sort((a, b) => b.value - a.value);

  if (!topScorers.length) throw new Error(`${code}: 파싱된 득점 데이터가 없음(사이트 구조 변경 가능성)`);

  await putJSON(env, `manualtopplayers:${code}`, { topScorers, topAssists: [], scrapedAt: Date.now() });
  console.log(`K3/K4 scorer scrape OK: ${code} (${topScorers.length}명)`);
}

export async function scrapeK3K4TopScorers(env) {
  for (const [code, source] of Object.entries(SOURCES)) {
    try {
      await scrapeOne(env, code, source);
    } catch (err) {
      console.error(`K3/K4 scorer scrape failed: ${code}`, err);
    }
  }
}
