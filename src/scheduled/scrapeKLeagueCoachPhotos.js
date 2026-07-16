import { putJSON } from "../lib/kv.js";

// kleague.com 선수 목록 페이지를 pos=manager로 필터링하면 K리그2 17개 구단 감독이 그대로 나온다.
// (player.do와 완전히 같은 마크업/선수 사진 CDN을 그대로 쓴다 - scrapeKLeaguePlayerPhotos.js와 동일 구조)
const URL = "https://www.kleague.com/player.do?type=active&leagueId=2&pos=manager&page=1";

function makeState() {
  return { rows: [], row: null };
}

function attachHandlers(rewriter, state) {
  rewriter
    .on(".player .cont-box", {
      element() {
        state.row = { team: null, nameBuf: "", splitAt: null, photo: null };
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
    });
}

export async function scrapeKLeagueCoachPhotos(env) {
  const res = await fetch(URL, { headers: { "User-Agent": "Mozilla/5.0 (compatible; PitchProBot/1.0)" } });
  if (!res.ok) throw new Error(`fetch ${URL} failed: ${res.status}`);

  const state = makeState();
  const rewriter = new HTMLRewriter();
  attachHandlers(rewriter, state);
  await rewriter.transform(res).text(); // 스트림을 끝까지 읽어야 위 핸들러들이 전부 실행된다

  const byTeam = {};
  for (const row of state.rows) {
    const name = row.nameBuf.slice(0, row.splitAt ?? row.nameBuf.length).trim();
    if (!row.team || !name || !row.photo) continue;
    if (!row.photo.includes("/v1/player/")) continue; // 사진 없는 경우 CDN 루트만 오는 깨진 URL
    byTeam[row.team] = { name, photo: row.photo };
  }

  const count = Object.keys(byTeam).length;
  if (!count) return;
  await putJSON(env, "kleague:coachphotos:v1", { byTeam, scrapedAt: Date.now() });
  console.log(`kleague 감독 사진 스크랩 OK: ${count}명`);
}
