import { getJSON, putJSON } from "./kv.js";
import { KV_KEYS } from "./config.js";

// 라이브스코어(livescore.in)는 플래시스코어(FlashScore)와 같은 회사(Livesport) 제품이라 백엔드도
// 공유한다 - global.flashscore.ninja가 실제 데이터 서버다(웹 화면 도메인 livescore.in과는 별개).
// 응답은 JSON이 아니라 "키÷값" 쌍을 "¬"로 이어붙이고 레코드는 "~"로 끊는 독자 텍스트 포맷이다
// (사람이 읽을 수 있는 한글 라벨이 그대로 들어있어 scoreman123/AiScore처럼 카테고리 번호를 추측할
// 필요가 없다 - 2026-08-30, 사용자가 브라우저 devtools 네트워크 탭에서 직접 캡처해 찾아냄).
//
// 인증: 모든 요청에 정적 헤더 "x-fsign: SW9D1eZo"가 필요하다(실제 브라우저 요청에서 그대로 확인함,
// 이름은 "서명"이지만 고정값 - 시간이 지나면 이 값 자체가 바뀔 수 있으니 401이 나기 시작하면 가장
// 먼저 의심할 것). Referer도 같이 보낸다.
//
// - /{projectId}/x/feed/t_1_{ZB}_{ZEE}_9_ko_1 : 대회 일정(대회당 고정, 시즌 내내 안 바뀜) - 대회
//   헤더 레코드 하나 + 경기 레코드 여러 개. 경기 레코드 필드: AA=이벤트ID, AD=킥오프(UTC 초, 우리
//   utcDate와 그대로 비교 가능), CX=홈팀명, AF=원정팀명, PX/PY=팀ID, AG/AH=현재 스코어. {ZB}/{ZEE}는
//   대회별로 다른 고정 식별자라 대회 페이지를 열어 네트워크 탭에서 한 번씩 캡처해야 알 수 있다(경기당
//   아니라 대회당 한 번만 하면 됨) - FLASHSCORE_SCHEDULE_FEED에 등록해서 쓴다.
// - /{projectId}/x/feed/df_st_1_{eventId} : 그 경기의 통계. "경기"(전체 누적) 구간이 먼저 나오고
//   그 뒤에 "전반전"/"후반전" 구간이 이어지는데, 우리는 항상 맨 앞 "경기"(전체) 구간까지만 읽는다.
const PROJECT_ID = "79"; // 한국(ko) 로케일 프로젝트ID - livescore.in 자체가 이미 이 프로젝트로 고정
const FSIGN = "SW9D1eZo";
const HEADERS = {
  referer: "https://www.livescore.in/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "x-fsign": FSIGN,
};

// 대회별 일정 피드 이름. K4는 아직 캡처 전이라 비어있음 - 캡처되는 대로 추가.
const FLASHSCORE_SCHEDULE_FEED = {
  K3: "t_1_106_Q19CngBE_9_ko_1",
};

async function fetchFlashscoreFeed(feedName) {
  const res = await fetch(`https://global.flashscore.ninja/${PROJECT_ID}/x/feed/${feedName}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`flashscore ${feedName} ${res.status}`);
  return res.text();
}

// "~"로 레코드를 끊고, 레코드 안은 "¬"로 필드를 끊고, 필드는 "키÷값"이다. 가장 앞의 "÷"만 기준으로
// 나눈다(값 자체에 "÷"가 섞여 나올 일은 없지만 안전하게 first-split만 한다).
function parseFeedRecords(text) {
  return text.split("~").map((chunk) => {
    const record = {};
    for (const field of chunk.split("¬")) {
      const sep = field.indexOf("÷");
      if (sep === -1) continue;
      record[field.slice(0, sep)] = field.slice(sep + 1);
    }
    return record;
  });
}

function namesOverlap(a, b) {
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

export async function findFlashscoreMatchId(env, match) {
  const feedName = FLASHSCORE_SCHEDULE_FEED[match.competition.code];
  if (!feedName) return null;

  const refs = (await getJSON(env, KV_KEYS.flashscoreGameRefs)) || {};
  if (refs[match.id]) return refs[match.id];

  try {
    const records = parseFeedRecords(await fetchFlashscoreFeed(feedName));
    const targetKickoff = Math.round(new Date(match.utcDate).getTime() / 1000);
    const candidates = records.filter((r) => r.AA && r.AD && Number(r.AD) === targetKickoff);
    if (!candidates.length) return null;

    let found = candidates.find((r) => namesOverlap(r.CX, match.homeTeam.name) && namesOverlap(r.AF, match.awayTeam.name));
    // 동시킥오프 후보가 이거 하나뿐이면, 팀명 표기가 달라도(축구단 접미사 차이 등) 그대로 채택한다 -
    // 대회+킥오프 초 단위 일치라는 조건 자체가 이미 충분히 강한 식별자다.
    if (!found && candidates.length === 1) found = candidates[0];
    if (!found) return null;

    refs[match.id] = found.AA;
    await putJSON(env, KV_KEYS.flashscoreGameRefs, refs);
    return found.AA;
  } catch (err) {
    console.error("flashscore schedule feed fetch failed:", err);
    return null;
  }
}

// 라벨 문자열 -> {stats 필드, 값 변환}. 우리 통계 화면 기존 항목과 바로 연결되는 것만 켠다(오프사이드/
// 프리킥/스로우인/빗나간 슛은 화면에 항목 자체가 없어 보류 - 화면에 새 줄을 추가하면 그때 같이 켠다).
const LABEL_MAP = {
  볼점유율: { key: "possession", format: (v) => v }, // 이미 "49%" 형태 문자열로 옴
  "슈팅 합계": { key: "shotsTotal", format: (v) => Number(v) },
  유효슈팅: { key: "shotsOnGoal", format: (v) => Number(v) },
  코너킥: { key: "corners", format: (v) => Number(v) },
  반칙: { key: "fouls", format: (v) => Number(v) },
};

export async function fetchFlashscoreStatistics(eventId, match) {
  const records = parseFeedRecords(await fetchFlashscoreFeed(`df_st_1_${eventId}`));

  const homeStats = {};
  const awayStats = {};
  const seen = new Set();
  let inFullMatchSection = false;
  for (const r of records) {
    if (r.SE !== undefined) {
      // 첫 SE 레코드("경기")가 전체 누적 구간의 시작이고, 그다음 SE 레코드("전반전")부터는 그만 읽는다.
      if (!inFullMatchSection) {
        inFullMatchSection = true;
        continue;
      }
      break;
    }
    if (!inFullMatchSection || r.SG === undefined || r.SH === undefined || r.SI === undefined) continue;
    const mapping = LABEL_MAP[r.SG];
    if (!mapping || seen.has(mapping.key)) continue;
    seen.add(mapping.key);
    homeStats[mapping.key] = mapping.format(r.SH);
    awayStats[mapping.key] = mapping.format(r.SI);
  }

  if (!Object.keys(homeStats).length) return [];
  return [
    { teamId: String(match.homeTeam.id), stats: homeStats },
    { teamId: String(match.awayTeam.id), stats: awayStats },
  ];
}
