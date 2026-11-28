// 최신뉴스 기사를 리그별로 묶어서 보여달라는 요청(2026-11-28) - BBC/동아/경향 RSS 피드 자체엔
// "이 기사가 어느 리그 소식인지" 알려주는 필드가 없어서(일반 축구 섹션 피드일 뿐, 대회별로 안
// 나뉨), 제목+본문 텍스트에서 리그/대회 이름과 팀 이름을 검색해서 직접 분류한다.
//
// 두 종류의 키워드를 쓴다:
// 1) 정적 목록(LEAGUE_KEYWORDS/BIG_CLUB_ALIASES) - 리그/대회 자체 이름(영문+한글)과, 한국 매체가
//    자주 쓰는 빅클럽 한글 표기(맨유/토트넘 등). 해외 클럽은 우리 DB에 한글 이름이 따로 없어서
//    (K리그만 있음, apiFootballAdapter.js KLEAGUE_TEAM_NAMES 참고) 자주 보도되는 몇 개만 수동으로
//    보강했다 - 전부 못 커버해도 괜찮다(분류 안 되면 그냥 미분류로 남을 뿐).
// 2) 동적 목록 - 이미 캐싱된 순위표(KV_KEYS.standings)에서 각 대회 소속 팀의 실제 영문명을 그대로
//    끌어와 추가한다. 사람이 일일이 안 적어도 추적 중인 대회 전부에 자동으로 적용되고, 지어낸
//    데이터가 아니라 API-Football이 실제로 준 이름 그대로라 신뢰할 수 있다.
import { getJSON } from "./kv.js";
import { KV_KEYS } from "./config.js";

const LEAGUE_KEYWORDS = [
  { code: "PL", label: "프리미어리그", keywords: ["premier league", "프리미어리그", "프리미어 리그"] },
  { code: "PD", label: "라리가", keywords: ["la liga", "라리가"] },
  { code: "BL1", label: "분데스리가", keywords: ["bundesliga", "분데스리가"] },
  { code: "SA", label: "세리에A", keywords: ["serie a", "세리에"] },
  { code: "FL1", label: "리그앙", keywords: ["ligue 1", "리그앙"] },
  { code: "CL", label: "챔피언스리그", keywords: ["champions league", "챔피언스리그", "챔스"] },
  { code: "EL", label: "유로파리그", keywords: ["europa league", "유로파리그"] },
  { code: "ECL", label: "컨퍼런스리그", keywords: ["conference league", "컨퍼런스리그"] },
  { code: "KL1", label: "K리그1", keywords: ["k리그1", "k리그 1", "k league 1"] },
  { code: "KL2", label: "K리그2", keywords: ["k리그2", "k리그 2", "k league 2"] },
  { code: "WC", label: "월드컵", keywords: ["world cup", "월드컵"] },
  { code: "ACL", label: "AFC챔피언스리그", keywords: ["afc champions league", "아시아챔피언스리그", "afc 챔피언스리그"] },
];

// 영문 기사(BBC)가 흔히 쓰는 팀 축약/별칭(Man Utd, Spurs 등)과 한국 매체가 흔히 쓰는 한글 표기를
// 묶었다 - 둘 다 해당 리그 코드 하나로 잡힌다.
const BIG_CLUB_ALIASES = [
  { code: "PL", keywords: ["manchester united", "man utd", "맨체스터 유나이티드", "맨유"] },
  { code: "PL", keywords: ["manchester city", "man city", "맨체스터 시티", "맨시티"] },
  { code: "PL", keywords: ["liverpool", "리버풀"] },
  { code: "PL", keywords: ["arsenal", "아스널"] },
  { code: "PL", keywords: ["chelsea", "첼시"] },
  { code: "PL", keywords: ["tottenham", "spurs", "토트넘"] },
  { code: "PL", keywords: ["newcastle", "뉴캐슬"] },
  { code: "PD", keywords: ["real madrid", "레알 마드리드", "레알마드리드"] },
  { code: "PD", keywords: ["barcelona", "바르셀로나"] },
  { code: "PD", keywords: ["atletico madrid", "atlético madrid", "아틀레티코 마드리드"] },
  { code: "BL1", keywords: ["bayern munich", "bayern", "바이에른 뮌헨", "바이에른"] },
  { code: "BL1", keywords: ["borussia dortmund", "dortmund", "도르트문트"] },
  { code: "SA", keywords: ["juventus", "유벤투스"] },
  { code: "SA", keywords: ["inter milan", "인터 밀란", "인테르"] },
  { code: "SA", keywords: ["ac milan", "ac밀란", "ac 밀란"] },
  { code: "SA", keywords: ["napoli", "나폴리"] },
  { code: "FL1", keywords: ["paris saint-germain", "psg", "파리생제르맹", "파리 생제르맹"] },
];

const LEAGUE_LABEL_BY_CODE = Object.fromEntries(LEAGUE_KEYWORDS.map((l) => [l.code, l.label]));

// 리그 코드별로 팀 이름을 너무 짧게 주면(예: 2~3글자) 전혀 다른 문맥의 단어와 우연히 겹쳐서 엉뚱한
// 리그로 분류될 위험이 커진다 - 일정 길이 이상인 이름만 동적 목록에 넣는다.
const MIN_DYNAMIC_KEYWORD_LENGTH = 4;

export async function buildNewsClassifier(env) {
  const index = [];
  for (const { code, label, keywords } of LEAGUE_KEYWORDS) {
    for (const kw of keywords) index.push({ code, label, kw: kw.toLowerCase() });
  }
  for (const { code, keywords } of BIG_CLUB_ALIASES) {
    const label = LEAGUE_LABEL_BY_CODE[code];
    if (!label) continue;
    for (const kw of keywords) index.push({ code, label, kw: kw.toLowerCase() });
  }

  try {
    const standingsBlob = await getJSON(env, KV_KEYS.standings);
    for (const [code, data] of Object.entries(standingsBlob?.byCode || {})) {
      const label = LEAGUE_LABEL_BY_CODE[code];
      if (!label) continue; // 한글 표시 이름을 안 정해둔 대회는 분류 대상에서 뺀다
      for (const group of data.standings || []) {
        for (const row of group.table || []) {
          for (const n of [row.team?.name, row.team?.shortName]) {
            if (n && n.length >= MIN_DYNAMIC_KEYWORD_LENGTH) index.push({ code, label, kw: n.toLowerCase() });
          }
        }
      }
    }
  } catch {
    // 순위표 캐시를 못 읽어도 정적 키워드만으로 분류를 계속 진행한다.
  }

  return function classify(text) {
    const lower = text.toLowerCase();
    for (const { code, label, kw } of index) {
      if (lower.includes(kw)) return { leagueCode: code, leagueLabel: label };
    }
    return null;
  };
}
