// K리그1/2 홈구장 정보 + 티켓 예매 링크(NOL 티켓/티켓링크 실제 확인). API-Football 팀 id 기준.
// ticketlink.co.kr는 SPA라 링크를 직접 렌더링해서 확인하지 못하고 검색엔진에 색인된 페이지 제목으로만
// 대조했으므로(numeric id가 시즌마다 바뀔 수 있음), 주기적으로 재확인이 필요할 수 있다.
// 좌표가 없어 도착지는 주소 문자열로 넘기고(구글이 지오코딩), 출발지만 사용자 위치(Geolocation)를 쓴다.
export const KLEAGUE_VENUES = {
  // K리그1
  2766: { stadium: "서울월드컵경기장", address: "서울특별시 마포구 월드컵로 240", ticketUrl: "https://www.ticketlink.co.kr/sports/football/65" },
  2762: { stadium: "전주월드컵경기장", address: "전북특별자치도 전주시 덕진구 기린대로 1055", ticketUrl: "https://www.ticketlink.co.kr/sports/football/73" },
  2746: { stadium: "강릉종합운동장", address: "강원특별자치도 강릉시 종합운동장길 69", ticketUrl: "https://nol.yanolja.com/ticket/genre/sports/gangwonfc" },
  2764: { stadium: "포항스틸야드", address: "경상북도 포항시 남구 괴동동", ticketUrl: "https://www.ticketlink.co.kr/sports/football/74" },
  2767: { stadium: "울산문수축구경기장", address: "울산광역시 남구 문수로 44", ticketUrl: "https://www.ticketlink.co.kr/sports/football/66" },
  2748: { stadium: "안양종합운동장", address: "경기도 안양시 동안구 평촌대로 389", ticketUrl: "https://www.ticketlink.co.kr/sports/138/86" },
  2763: { stadium: "인천축구전용경기장(숭의아레나)", address: "인천광역시 중구 참외전로 246", ticketUrl: "https://www.ticketlink.co.kr/sports/football/77" },
  2761: { stadium: "제주월드컵경기장", address: "제주특별자치도 서귀포시 월드컵로 31", ticketUrl: "https://www.ticketlink.co.kr/sports/football/76" },
  2745: { stadium: "부천종합운동장", address: "경기도 부천시 원미구 소사로 482", ticketUrl: "https://nol.yanolja.com/ticket/genre/sports/bucheon" },
  2750: { stadium: "대전월드컵경기장(퍼플아레나)", address: "대전광역시 유성구 월드컵대로 32", ticketUrl: "https://www.ticketlink.co.kr/sports/football/83" },
  2768: { stadium: "김천종합운동장", address: "경상북도 김천시 운동장길 1", ticketUrl: "https://www.ticketlink.co.kr/sports/football/80" },
  2759: { stadium: "광주월드컵경기장", address: "광주광역시 서구 금화로 240", ticketUrl: "https://www.ticketlink.co.kr/sports/football/79" },
  // K리그2
  2752: { stadium: "구덕운동장", address: "부산광역시 서구 망양로 57", ticketUrl: "https://nol.yanolja.com/ticket/genre/sports/busanipark" },
  2765: { stadium: "수원월드컵경기장(빅버드)", address: "경기도 수원시 팔달구 월드컵로 310", ticketUrl: "https://nol.yanolja.com/ticket/genre/sports/bluewings" },
  2747: { stadium: "대구iM뱅크파크", address: "대구광역시 북구 고성로 191", ticketUrl: "https://www.ticketlink.co.kr/sports/football/84" },
  2756: { stadium: "수원종합운동장", address: "경기도 수원시 장안구 경수대로 893", ticketUrl: "https://nol.yanolja.com/ticket/genre/sports/swfc" },
  2749: { stadium: "목동종합운동장", address: "서울특별시 양천구 안양천로 939", ticketUrl: "https://www.seoulelandfc.com/ticket/reserve" },
  7087: { stadium: "화성종합경기타운 주경기장", address: "경기도 화성시 향남읍 향남로 470", ticketUrl: "https://nol.yanolja.com/ticket/genre/sports/hwaseong" },
  2753: { stadium: "이순신종합운동장", address: "충청남도 아산시 남부로 370-24", ticketUrl: "https://nol.yanolja.com/ticket/genre/sports/asan" },
  7078: { stadium: "김포솔터축구장", address: "경기도 김포시 김포한강3로 385", ticketUrl: "https://www.ticketlink.co.kr/sports/football/493" },
  2751: { stadium: "창원축구센터", address: "경상남도 창원시 성산구 비음로 97", ticketUrl: "https://www.ticketlink.co.kr/sports/football/88" },
  7060: { stadium: "천안종합운동장(스카이피치)", address: "충청남도 천안시 서북구 번영로 208", ticketUrl: "https://nol.yanolja.com/ticket/genre/sports/ccfc" },
  9171: { stadium: "용인미르스타디움", address: "경기도 용인시 처인구 동백죽전대로 61", ticketUrl: "https://www.ticketlink.co.kr/sports/football/" },
  7098: { stadium: "파주스타디움", address: "경기도 파주시 중앙로 160", ticketUrl: "https://nol.yanolja.com/ticket/genre/sports/pajufc" },
  2757: { stadium: "탄천종합운동장", address: "경기도 성남시 분당구 탄천로 215", ticketUrl: "https://nol.yanolja.com/ticket/genre/sports/seongnamfc" },
  7061: { stadium: "청주종합경기장", address: "충청북도 청주시 서원구 사직대로 229", ticketUrl: "https://nol.yanolja.com/ticket/genre/sports/cheongjufc" },
  2758: { stadium: "안산와~스타디움", address: "경기도 안산시 단원구 화랑로 260", ticketUrl: "https://nol.yanolja.com/ticket/genre/sports/ansan" },
  2760: { stadium: "광양축구전용구장(드래곤즈파크)", address: "전라남도 광양시 백운로 1641", ticketUrl: "https://nol.yanolja.com/ticket/genre/sports/jndragons" },
  7076: { stadium: "김해종합운동장", address: "경상남도 김해시 가야로 243", ticketUrl: "https://nol.yanolja.com/ticket/genre/sports/gimhaefc" },
};

export function findKLeagueVenue(teamId) {
  return KLEAGUE_VENUES[String(teamId)] || KLEAGUE_VENUES[teamId] || null;
}
