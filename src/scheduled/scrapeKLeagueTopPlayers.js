import { getJSON, putJSON } from "../lib/kv.js";
import { getKLeaguePlayerPhotoByIdMap } from "../lib/kleaguePlayerPhotos.js";

// API-Football은 K리그1/K리그2 둘 다 득점 통계가 부실해서(K리그1은 도움은 정상인데 득점(topScorers)이
// 통째로 빈 배열로 오는 상태를 2026-08-08에 확인) 대신 K리그 공식 사이트(kleague.com)의 개인기록
// 페이지를 매주 스크랩해서 보여준다. leagueId=1은 K리그1, 2는 K리그2.
const YEAR = 2026;
const TARGETS = [
  { code: "KL1", leagueId: 1, recordType: "GOAL", key: "topScorers" },
  { code: "KL1", leagueId: 1, recordType: "ASSIST", key: "topAssists" },
  { code: "KL2", leagueId: 2, recordType: "GOAL", key: "topScorers" },
  { code: "KL2", leagueId: 2, recordType: "ASSIST", key: "topAssists" },
];

function makePlayerTableState() {
  return { rows: [], row: null, colIndex: -1 };
}

// <tr><td>순위</td><td>이름</td><td><img>팀명</td>...<td class="point">현재 정렬 기준 기록</td>...</tr>
function attachHandlers(rewriter, state) {
  rewriter
    .on("#player_rank tr", {
      element() {
        state.row = { playerId: null, name: "", team: "", teamCrest: null, value: "" };
        state.colIndex = -1;
        state.rows.push(state.row);
      },
    })
    .on("#player_rank tr td", {
      element(el) {
        state.colIndex += 1;
        if (state.colIndex === 1 && state.row) {
          const onclick = el.getAttribute("onclick") || "";
          const m = onclick.match(/playerId=(\d+)/);
          if (m) state.row.playerId = m[1];
        }
      },
      text(chunk) {
        if (!state.row) return;
        if (state.colIndex === 1) state.row.name += chunk.text;
        else if (state.colIndex === 2) state.row.team += chunk.text;
      },
    })
    .on("#player_rank tr td img", {
      element(el) {
        if (state.row && state.colIndex === 2) {
          const src = el.getAttribute("src");
          state.row.teamCrest = src ? `https://www.kleague.com${src}` : null;
        }
      },
    })
    .on("#player_rank tr td.point", {
      text(chunk) {
        if (state.row) state.row.value += chunk.text;
      },
    });
}

const HANGUL_RE = /[가-힣]/;

async function scrapeOne({ leagueId, recordType }, photoByPlayerId) {
  const url = `https://www.kleague.com/record/player.do?leagueId=${leagueId}&year=${YEAR}&recordType=${recordType}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; PitchProBot/1.0)" } });
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);

  const state = makePlayerTableState();
  const rewriter = new HTMLRewriter();
  attachHandlers(rewriter, state);
  await rewriter.transform(res).text(); // 스트림을 끝까지 읽어야 위 핸들러들이 전부 실행된다

  return state.rows
    .map((r) => ({
      playerId: r.playerId,
      name: r.name.trim(),
      team: r.team.trim(),
      teamCrest: r.teamCrest,
      photo: (r.playerId && photoByPlayerId[r.playerId]) || null,
      value: parseInt(r.value, 10) || 0,
    }))
    .filter((r) => r.name && r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
}

// kleague.com이 가끔(원인 불명, 2026-08-09 확인) 같은 선수를 한글 이름("야고") 대신 영문 풀네임
// ("Yago Cariello Ribeiro")으로 서빙할 때가 있다 - 한 번이라도 한글로 확인된 선수는 playerId 기준으로
// 기억해뒀다가, 이후 스크랩에서 한글이 아닌 이름이 오면 예전 한글 이름으로 대체한다.
async function applyKoreanNameMemory(env, rows) {
  const memory = (await getJSON(env, "kleague:playernames:v1")) || {};
  let memoryChanged = false;
  const fixed = rows.map((r) => {
    if (!r.playerId) return r;
    if (HANGUL_RE.test(r.name)) {
      if (memory[r.playerId] !== r.name) {
        memory[r.playerId] = r.name;
        memoryChanged = true;
      }
      return r;
    }
    const known = memory[r.playerId];
    return known ? { ...r, name: known } : r;
  });
  if (memoryChanged) await putJSON(env, "kleague:playernames:v1", memory);
  return fixed;
}

export async function scrapeKLeagueTopPlayers(env) {
  const byCode = {};
  let anyChanged = false;
  const photoByPlayerId = await getKLeaguePlayerPhotoByIdMap(env);

  for (const target of TARGETS) {
    if (!byCode[target.code]) {
      // 두 종류(득점/도움) 중 하나만 이번에 실패해도 다른 하나를 덮어쓰지 않도록 기존 값을 먼저 불러온다.
      const existing = await getJSON(env, `manualtopplayers:${target.code}`);
      byCode[target.code] = { topScorers: existing?.topScorers || [], topAssists: existing?.topAssists || [] };
    }
    try {
      const rows = await scrapeOne(target, photoByPlayerId);
      byCode[target.code][target.key] = (await applyKoreanNameMemory(env, rows)).map(({ playerId, ...rest }) => rest);
      anyChanged = true;
      console.log(`K리그 순위 스크랩 OK: ${target.code}/${target.key} (${byCode[target.code][target.key].length}명)`);
    } catch (err) {
      console.error(`K리그 순위 스크랩 실패: ${target.code}/${target.key}`, err);
    }
  }

  if (!anyChanged) return;
  for (const [code, data] of Object.entries(byCode)) {
    await putJSON(env, `manualtopplayers:${code}`, { ...data, scrapedAt: Date.now() });
  }
}
