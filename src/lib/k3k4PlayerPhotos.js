// K3/K4는 각 구단 홈페이지 구조가 제각각이고(공식 사이트가 아예 없는 신생 구단도 있음) 봇 차단이
// 걸린 곳도 많아 kleague.com처럼 자동 스크랩이 안 된다 - 대신 구단 공식 홈페이지에서 직접 확인한
// 선수 사진을 여기 수동으로 등록해둔다(사용자 요청, 2026-08-08). 이름만으로는 동명이인 충돌 위험이
// 있어 "팀명|이름"을 키로 쓴다. scrapeK3K4TopScorers.js가 득점 순위를 다시 긁어올 때마다 이 표를
// 참고해 photo를 붙인다. manualTopPlayers.js의 withPhotos()가 K3/K4뿐 아니라 K리그2 득점왕 목록에도
// 똑같이 적용하기 때문에, kleague.com 자체 스크랩이 개별 선수만 놓친 경우도 여기 추가해서 메꾼다.
export const K3K4_PLAYER_PHOTOS = {
  "부산교통공사축구단|얀": "/img/k3k4players/yan.png", // https://www.humetro.busan.kr (부산교통공사 축구단 공식)
  "경주한수원FC|빅토르": "/img/k3k4players/victor.jpg", // https://www.khnpfc.co.kr (경주한수원 축구단 공식)
  "화성|페트로프": "https://d2tfp74nsbbrkr.cloudfront.net/v1/player/player_20260136.png", // kleague.com 자체 CDN(공식 사진, 다만 스크랩 코드가 놓침)
};

export function lookupK3K4PlayerPhoto(team, name) {
  return K3K4_PLAYER_PHOTOS[`${team}|${name}`] || null;
}
