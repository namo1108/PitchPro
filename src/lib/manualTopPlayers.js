import { getJSON } from "./kv.js";

// API-Football이 K3/K4는 득점/도움 통계를 전혀 제공하지 않아서(K4는 0건, K3는 거의 없음),
// 대한축구협회(KFA) 사이트를 매주 자동으로 스크랩한 결과(scrapeK3K4TopScorers.js)를 대신 보여준다.
// 아래 MANUAL_TOP_PLAYERS는 스크랩이 아직 한 번도 성공하지 않았을 때 쓰는 최초 부트스트랩 데이터.
//
// 작성 형식: { name: "선수명", team: "팀명", value: 골/도움 수 }
// (API-Football 선수 ID가 없어 선수 상세 페이지로는 연결되지 않고, 순위 목록에만 표시됨)
export const MANUAL_TOP_PLAYERS = {
  K3: {
    topScorers: [
      { name: "덴젤", team: "양평FC", value: 8 },
      { name: "빅토르", team: "경주한수원FC", value: 8 },
      { name: "얀", team: "부산교통공사축구단", value: 8 },
      { name: "김홍", team: "시흥시민축구단", value: 7 },
      { name: "이재건", team: "포천시민축구단", value: 7 },
    ],
    topAssists: [],
  },
  K4: {
    topScorers: [
      { name: "김도윤", team: "진주시민축구단", value: 11 },
      { name: "이동규", team: "진주시민축구단", value: 10 },
      { name: "김훈욱", team: "서산에프씨", value: 9 },
      { name: "홍수호", team: "진천HRFC", value: 8 },
      { name: "노의왕", team: "거제시민축구단", value: 7 },
    ],
    topAssists: [],
  },
};

export async function getManualTopPlayers(env, code) {
  const scraped = await getJSON(env, `manualtopplayers:${code}`);
  if (scraped) return scraped;
  return MANUAL_TOP_PLAYERS[code] || null;
}
