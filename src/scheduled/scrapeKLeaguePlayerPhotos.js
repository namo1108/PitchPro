import { putJSON } from "../lib/kv.js";

// API-Football이 lineups/squads에 주는 K리그 선수 사진이 부실하거나 없는 경우가 있어서,
// kleague.com 공식 선수 목록(현역만)을 매주 스크랩해서 등번호 기준으로 대체한다. K리그2뿐 아니라
// K리그1도 득점왕 photo 매칭(byPlayerId)에 필요해서 2026-08-08부터 같이 스크랩한다.
const BASE_URL = "https://www.kleague.com/player.do";
const LEAGUE_IDS = [1, 2];
const MAX_PAGES_SAFETY = 40;

function makeState() {
  return { rows: [], row: null, lastPage: null };
}

// <div class="cont-box ... player-hover"><div class="img-box"><img src="사진"></div>
//   <div class="txt-box"><img alt="팀명"><div class="txt"><span class="name">이름<span class="small">팀명</span></span>
//   <span class="num">No.11</span></div></div></div>
function attachHandlers(rewriter, state) {
  rewriter
    .on(".player .cont-box", {
      element(el) {
        const onclick = el.getAttribute("onclick") || "";
        const m = onclick.match(/onPlayerClicked\((\d+)\)/);
        state.row = { kleagueId: m ? m[1] : null, team: null, nameBuf: "", splitAt: null, numberBuf: "", photo: null };
        state.rows.push(state.row);
      },
    })
    .on(".player .cont-box .img-box img", {
      element(el) {
        if (state.row) state.row.photo = el.getAttribute("src");
      },
    })
    .on(".player .cont-box .txt-box img", {
      element(el) {
        if (state.row) state.row.team = el.getAttribute("alt");
      },
    })
    .on(".player .cont-box .name", {
      text(chunk) {
        if (state.row) state.row.nameBuf += chunk.text;
      },
    })
    .on(".player .cont-box .name .small", {
      element() {
        if (state.row && state.row.splitAt === null) state.row.splitAt = state.row.nameBuf.length;
      },
    })
    .on(".player .cont-box .num", {
      text(chunk) {
        if (state.row) state.row.numberBuf += chunk.text;
      },
    })
    .on(".last", {
      element(el) {
        const onclick = el.getAttribute("onclick") || "";
        const m = onclick.match(/goToPage\((\d+)\)/);
        if (m) state.lastPage = parseInt(m[1], 10);
      },
    });
}

async function fetchPage(leagueId, page) {
  const url = `${BASE_URL}?type=active&leagueId=${leagueId}&page=${page}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; PitchProBot/1.0)" } });
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);

  const state = makeState();
  const rewriter = new HTMLRewriter();
  attachHandlers(rewriter, state);
  await rewriter.transform(res).text(); // 스트림을 끝까지 읽어야 위 핸들러들이 전부 실행된다
  return state;
}

function collectRows(state, photoMap, byPlayerId) {
  for (const row of state.rows) {
    const name = row.nameBuf.slice(0, row.splitAt ?? row.nameBuf.length).trim();
    const number = parseInt((row.numberBuf || "").replace(/[^0-9]/g, ""), 10);
    if (!row.team || !name || !Number.isFinite(number) || !row.photo) continue;
    if (!row.photo.includes("/v1/player/")) continue; // 사진 없는 선수는 CDN 루트만 오는 깨진 URL
    photoMap[`${row.team}#${number}`] = row.photo;
    if (row.kleagueId) byPlayerId[row.kleagueId] = row.photo;
  }
}

export async function scrapeKLeaguePlayerPhotos(env) {
  const photoMap = {};
  const byPlayerId = {};

  for (const leagueId of LEAGUE_IDS) {
    const first = await fetchPage(leagueId, 1);
    collectRows(first, photoMap, byPlayerId);

    const lastPage = Math.min(first.lastPage || 1, MAX_PAGES_SAFETY);
    for (let page = 2; page <= lastPage; page++) {
      try {
        const state = await fetchPage(leagueId, page);
        collectRows(state, photoMap, byPlayerId);
      } catch (err) {
        console.error(`kleague 선수 사진 스크랩 실패(leagueId ${leagueId}, page ${page}):`, err);
      }
    }
  }

  const count = Object.keys(photoMap).length;
  if (!count) return;
  await putJSON(env, "kleague:playerphotos:v1", { byKey: photoMap, byPlayerId, scrapedAt: Date.now() });
  console.log(`kleague 선수 사진 스크랩 OK: ${count}명`);
}
