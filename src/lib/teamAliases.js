// API-Football은 팀 이름을 전부 영문으로 준다("FC Seoul", "Manchester City" 등). 한국어 사용자는
// 한글로 검색하는 게 자연스러워서(예: "맨시티", "서울"), 팀 이름에 포함된 영문 키워드 <-> 한글 별칭을
// 매핑해둔다. K리그1/2는 전 구단, 그 외는 자주 검색될 법한 유럽 빅클럽/국가대표 위주로 커버한다
// (전 세계 모든 팀을 다 담을 순 없어 완전하지 않음 - 필요하면 여기에 계속 추가하면 된다).
export const TEAM_KOREAN_ALIASES = [
  // K리그1
  { en: "fc seoul", ko: ["서울", "fc서울"] },
  { en: "jeonbuk", ko: ["전북", "전북현대"] },
  { en: "gangwon", ko: ["강원"] },
  { en: "pohang", ko: ["포항", "포항스틸러스"] },
  { en: "ulsan", ko: ["울산", "울산현대"] },
  { en: "fc anyang", ko: ["안양", "fc안양"] },
  { en: "incheon united", ko: ["인천"] },
  { en: "jeju united", ko: ["제주"] },
  { en: "bucheon", ko: ["부천"] },
  { en: "daejeon", ko: ["대전"] },
  { en: "gimcheon", ko: ["김천", "김천상무"] },
  { en: "gwangju fc", ko: ["광주"] },
  // K리그2
  { en: "busan i park", ko: ["부산", "부산아이파크"] },
  { en: "suwon bluewings", ko: ["수원삼성", "수원블루윙즈"] },
  { en: "daegu fc", ko: ["대구"] },
  { en: "suwon city", ko: ["수원fc", "수원시"] },
  { en: "seoul e-land", ko: ["서울이랜드", "이랜드"] },
  { en: "hwaseong", ko: ["화성"] },
  { en: "asan", ko: ["아산", "아산무궁화"] },
  { en: "gimpo", ko: ["김포"] },
  { en: "gyeongnam", ko: ["경남"] },
  { en: "cheonan", ko: ["천안"] },
  { en: "yongin", ko: ["용인"] },
  { en: "paju", ko: ["파주"] },
  { en: "seongnam", ko: ["성남"] },
  { en: "cheongju", ko: ["청주"] },
  { en: "ansan", ko: ["안산"] },
  { en: "jeonnam", ko: ["전남"] },
  { en: "gimhae", ko: ["김해"] },
  // 유럽 빅클럽
  { en: "manchester city", ko: ["맨시티", "맨체스터시티"] },
  { en: "manchester united", ko: ["맨유", "맨체스터유나이티드"] },
  { en: "chelsea", ko: ["첼시"] },
  { en: "liverpool", ko: ["리버풀"] },
  { en: "arsenal", ko: ["아스날"] },
  { en: "tottenham", ko: ["토트넘"] },
  { en: "newcastle", ko: ["뉴캐슬"] },
  { en: "aston villa", ko: ["아스톤빌라"] },
  { en: "real madrid", ko: ["레알마드리드", "레알"] },
  { en: "barcelona", ko: ["바르셀로나", "바르사"] },
  { en: "atletico madrid", ko: ["아틀레티코마드리드", "아틀레티코"] },
  { en: "bayern", ko: ["바이에른뮌헨", "바이에른"] },
  { en: "borussia dortmund", ko: ["도르트문트"] },
  { en: "juventus", ko: ["유벤투스"] },
  { en: "inter", ko: ["인터밀란"] },
  { en: "ac milan", ko: ["ac밀란", "밀란"] },
  { en: "napoli", ko: ["나폴리"] },
  { en: "paris saint germain", ko: ["psg", "파리생제르맹"] },
  { en: "marseille", ko: ["마르세유"] },
  { en: "ajax", ko: ["아약스"] },
  { en: "porto", ko: ["포르투"] },
  { en: "benfica", ko: ["벤피카"] },
  // 국가대표
  { en: "korea republic", ko: ["한국", "대한민국"] },
  { en: "japan", ko: ["일본"] },
  { en: "brazil", ko: ["브라질"] },
  { en: "argentina", ko: ["아르헨티나"] },
  { en: "england", ko: ["잉글랜드"] },
  { en: "france", ko: ["프랑스"] },
  { en: "germany", ko: ["독일"] },
  { en: "spain", ko: ["스페인"] },
  { en: "portugal", ko: ["포르투갈"] },
];

// 팀 이름(name/shortName, 영문)이 한글 검색어와 별칭으로 연결되는지 확인한다.
export function matchesKoreanAlias(query, ...names) {
  const lowerNames = names.filter(Boolean).map((n) => n.toLowerCase());
  return TEAM_KOREAN_ALIASES.some(({ en, ko }) => {
    if (!lowerNames.some((n) => n.includes(en))) return false;
    return ko.some((alias) => alias.includes(query) || query.includes(alias));
  });
}
