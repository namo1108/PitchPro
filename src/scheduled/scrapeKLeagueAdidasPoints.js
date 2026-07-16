import { putJSON } from "../lib/kv.js";
import { KV_KEYS } from "../lib/config.js";

// K리그 공식 사이트(kleague.com)의 "ADIDAS POINT" 파워랭킹 - 최근 5경기 가중치를 둔 자체 지표로,
// AI 분석에 "이 팀 지금 폼 좋은 핵심 선수" 같은 좀 더 정밀한(공식) 근거를 보태기 위해 매일 몇 번 긁어온다.
// 표에 대회 코드가 아니라 클럽명(한글)만 나와서, 매치 분석 쪽에서 teamAliases.js로 팀을 대조한다.
const YEAR = 2026;
const TARGETS = [
  { code: "KL1", leagueId: 1 },
  { code: "KL2", leagueId: 2 },
];
const TOP_N = 30; // 리그 팀 수(12~17개)를 대부분 커버할 수 있을 만큼 넉넉히.

function makeState() {
  return { rows: [], row: null, colIndex: -1 };
}

// <tr class="main-point-col"><td>확장버튼</td><td>순위</td><td>순위변동</td>
//   <td><a title="클럽명"><img></a>클럽명</td><td>선수명</td><td>번호</td><td>포지션</td><td>포인트</td>...</tr>
function attachHandlers(rewriter, state) {
  rewriter
    .on("tr.main-point-col", {
      element() {
        state.row = { club: "", player: "", position: "", point: "" };
        state.colIndex = -1;
        state.rows.push(state.row);
      },
    })
    .on("tr.main-point-col td", {
      element() {
        state.colIndex += 1;
      },
      text(chunk) {
        if (!state.row) return;
        if (state.colIndex === 4) state.row.player += chunk.text;
        else if (state.colIndex === 6) state.row.position += chunk.text;
        else if (state.colIndex === 7) state.row.point += chunk.text;
      },
    })
    .on("tr.main-point-col td a", {
      element(el) {
        const title = el.getAttribute("title");
        if (state.row && title) state.row.club = title;
      },
    });
}

async function scrapeOne({ leagueId }) {
  const url = `https://www.kleague.com/record/dynamicPoint.do?leagueId=${leagueId}&year=${YEAR}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; PitchProBot/1.0)" } });
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);

  const state = makeState();
  const rewriter = new HTMLRewriter();
  attachHandlers(rewriter, state);
  await rewriter.transform(res).text();

  return state.rows
    .map((r) => ({
      club: r.club.trim(),
      player: r.player.trim(),
      position: r.position.trim(),
      point: parseInt(r.point, 10) || 0,
    }))
    .filter((r) => r.club && r.player && r.point > 0)
    .sort((a, b) => b.point - a.point)
    .slice(0, TOP_N);
}

export async function scrapeKLeagueAdidasPoints(env) {
  const byCode = {};
  for (const target of TARGETS) {
    try {
      byCode[target.code] = await scrapeOne(target);
      console.log(`K리그 ADIDAS Point 스크랩 OK: ${target.code} (${byCode[target.code].length}명)`);
    } catch (err) {
      console.error(`K리그 ADIDAS Point 스크랩 실패: ${target.code}`, err);
    }
  }

  if (!Object.keys(byCode).length) return;
  await putJSON(env, KV_KEYS.kleagueAdidasPoints, { byCode, scrapedAt: Date.now() });
}
