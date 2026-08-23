import { getJSON, putJSON } from "./kv.js";
import { KV_KEYS } from "./config.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
// Cloudflare Workers엔 Node의 Buffer가 없어서(nodejs_compat 없이는) Uint8Array + TextDecoder로만
// 다룬다 - 로컬 Node에서 테스트할 땐 Buffer가 있어서 문제가 안 보이다가 배포 후에야
// "Buffer is not defined"로 터졌다(2026-08-23).
const utf8Decoder = new TextDecoder("utf-8", { fatal: false });

// KFA 공식 사이트는 경기가 완전히 끝나야만 상세(라인업/이벤트)를 열어줘서 라이브 중엔 K3/K4가 계속
// 비어 보였다(2026-08-23 확인 - kfaMatchCenter.js 자체는 정상, KFA 사이트 구조의 한계). AiScore
// (api.aiscore.com)는 라이브 통계를 제공하는데, 응답이 JSON이 아니라 라벨 없는 Protobuf 바이너리라
// 브라우저 네트워크 탭으로 실제 호출을 캡처하고 바이트를 직접 역공학해서 구조를 알아냈다.
//
// - /v1/m/api/matches?date=YYYYMMDD&tz=09:00 : 그날 전세계 경기 목록(15.2 반복 필드) + 팀 이름
//   참조 목록(15.3 반복 필드). 경기 레코드에 걸린 이름이 팀마다 한글/영문이 뒤섞여 있어(예: 같은
//   응답 안에 "전북 현대 모터스 II"와 "Seosan Pioneer FC"가 공존) 이름 매칭은 신뢰할 수 없다 -
//   대신 대회ID(K3/K4 각각 고정)와 킥오프 유닉스타임(우리 utcDate와 초 단위까지 정확히 일치)으로
//   매칭한다.
// - /v1/m/api/match/team_stats?match_id=... : "카테고리번호" 문자열 -> "홈값" 문자열 -> "원정값"
//   문자열이 연속 3개 필드로 오는 반복 구조다(라벨 없음, 세 자리 카테고리 21개가 한 묶음). 처음엔
//   raw 바이트를 latin1로 대충 훑어보고 "1253169 = 125+31+69"처럼 세 값이 이어붙은 숫자 하나로
//   착각했는데(2026-08-23), 그건 protobuf 태그 바이트(필드1 반복 문자열의 태그가 마침 0x0A=개행문자라
//   raw 덤프에 우연히 줄바꿈처럼 보였을 뿐) 착시였다 - 실제로 이 파일과 같은 walkProtoLite 파서를
//   team_stats에도 그대로 돌려보고서야 "카테고리/홈/원정"이 애초에 별개 필드였다는 걸 확인했다.
//   같은 21개 카테고리 묶음이 응답 안에 3번 반복되는데(전체 누적 / 전반 / 후반 - 전반+후반 합이
//   전체와 정확히 일치하는 걸로 확인), 우리는 항상 첫 번째 묶음(전체 누적)만 쓴다.
//   실제 화면(m.aiscore.com 통계 탭) 스크린샷과 대조해서 지금까지 확인된 카테고리: 123=공격,
//   124=위험공격, 125=점유율. 슈팅/코너/카드로 추정되는 값들(101,102,109,113,121,128,183 등)은
//   한 경기 스냅샷만으론 후보가 여럿 겹쳐서(예: 세 카테고리가 동시에 1-2로 같은 값) 확실히 구분이
//   안 돼 더 확인 전까진 안 쓴다 - 확인되는 대로 STAT_CATEGORY_MAP에 추가하면 된다.
const K3_COMPETITION_ID = "r8lk2dig0ni0736";
const K4_COMPETITION_ID = "0ndkz6ix1gtgq3z";
const COMPETITION_IDS = { K3: K3_COMPETITION_ID, K4: K4_COMPETITION_ID };

// K3/K4는 매 라운드 여러 경기가 정각(예: 08:00 UTC)에 동시 킥오프하는 경우가 흔해서(2026-08-23
// 확인 - 서산FC:금산인삼FC와 거제시티즌:Haman FC가 같은 대회에서 초 단위까지 똑같은 킥오프), 대회ID
// +킥오프시각만으로는 유일하게 못 정한다. 이름은 응답 안에서도 한글/영문이 섞여 못 믿으니, 이미
// 확인된 경기에 한해 우리 API-Football 팀ID -> AiScore 팀ID를 여기 적어두고, 동시킥오프 후보가
// 여럿이면 이 표로 실제 우리 경기 팀과 일치하는 후보만 채택한다(모르는 팀이면 안전하게 건너뜀 -
// KLEAGUE_SITE_TEAM_ID_TO_APIFOOTBALL_ID와 같은 방식으로, 겹치는 경기가 제보될 때마다 추가한다).
const AISCORE_TEAM_ID_BY_APIFOOTBALL_ID = {
  27865: "ndkz6irv4zceq3z", // 서산에프씨
  9569: "edq09i9ez6s4qxg", // 금산인삼FC
};

function readVarint(buf, pos) {
  let result = 0n;
  let shift = 0n;
  while (true) {
    if (pos >= buf.length) throw new Error("varint out of bounds");
    const b = buf[pos++];
    result |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7n;
    if (shift > 70n) throw new Error("varint too long");
  }
  return [result, pos];
}

// 스키마(.proto)가 없어서 "어떤 필드가 문자열이고 어떤 게 중첩 메시지인지"를 정확히 구분할 방법이
// 없다 - 대신 length-delimited 필드의 내용이 사람이 읽을 수 있는 문자열처럼 보이면 문자열로 확정
// 짓고, 그렇지 않을 때만 중첩 메시지로 보고 재귀한다. 문자열로 이미 확정한 바이트를 또 메시지로
// 재귀하면(둘 다 시도) 우연히 그럴듯하게 파싱되는 가짜 필드가 섞여 들어가 실제 레코드 순서가
// 어긋나는 문제가 있었다(2026-08-23 확인 - 팀ID 바로 다음에 와야 할 팀 이름이 안 붙는 사고).
function walkProtoLite(buf, start, end, depth, path, out) {
  if (depth > 12) return;
  let pos = start;
  while (pos < end) {
    let tag, p1;
    try {
      [tag, p1] = readVarint(buf, pos);
    } catch {
      return;
    }
    if (p1 > end) return;
    const fieldNum = Number(tag >> 3n);
    const wireType = Number(tag & 7n);
    if (fieldNum === 0 || fieldNum > 5000) return; // 정렬이 어긋나면 태그가 말이 안 되는 값으로 튐 - 안전장치
    pos = p1;
    if (wireType === 0) {
      let val, p2;
      try {
        [val, p2] = readVarint(buf, pos);
      } catch {
        return;
      }
      out.push({ path: [...path, fieldNum].join("."), type: "varint", val });
      pos = p2;
    } else if (wireType === 2) {
      let len, p2;
      try {
        [len, p2] = readVarint(buf, pos);
      } catch {
        return;
      }
      pos = p2;
      const l = Number(len);
      if (l < 0 || pos + l > end) return;
      const slice = buf.slice(pos, pos + l);
      const asStr = utf8Decoder.decode(slice);
      const printableRatio = l ? [...asStr].filter((c) => c.codePointAt(0) >= 32 || c === "\n").length / asStr.length : 1;
      const looksLikeString = l >= 2 && l <= 80 && printableRatio > 0.98 && !asStr.includes("�");
      if (looksLikeString) {
        out.push({ path: [...path, fieldNum].join("."), type: "str", str: asStr });
      } else {
        walkProtoLite(buf, pos, pos + l, depth + 1, [...path, fieldNum], out);
      }
      pos += l;
    } else if (wireType === 1) {
      pos += 8;
    } else if (wireType === 5) {
      pos += 4;
    } else {
      return; // 그룹 등 안 쓰는 와이어타입 - 더 못 읽으니 중단
    }
  }
}

async function fetchAiscoreBinary(url) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/octet-stream" } });
  if (!res.ok) throw new Error(`aiscore ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// KST 자정 기준으로 하루치 전세계 경기 목록을 받아 K3/K4 경기만 골라, 대회ID+킥오프 초 단위 일치로
// 우리 내부 경기와 이어붙인다(이름은 한글/영문이 응답 안에서도 뒤섞여 있어 못 믿는다).
async function findAllTodayMatches(code, isoDate) {
  const yyyymmdd = isoDate.replace(/-/g, "");
  const buf = await fetchAiscoreBinary(`https://api.aiscore.com/v1/m/api/matches?lang=23&sport_id=1&date=${yyyymmdd}&tz=09:00`);
  const records = [];
  walkProtoLite(buf, 0, buf.length, 0, [], records);

  const compId = COMPETITION_IDS[code];
  const matches = [];
  let cur = null;
  for (const r of records) {
    if (r.path === "15.2.1") {
      if (cur) matches.push(cur);
      cur = { matchId: r.str };
    } else if (cur) {
      if (r.path === "15.2.4.1") cur.compId = r.str;
      else if (r.path === "15.2.6.1") cur.homeId = r.str;
      else if (r.path === "15.2.7.1") cur.awayId = r.str;
      else if (r.path === "15.2.15") cur.kickoff = Number(r.val);
    }
  }
  if (cur) matches.push(cur);

  return matches.filter((m) => m.compId === compId);
}

export async function findAiscoreMatchId(env, match) {
  if (!COMPETITION_IDS[match.competition.code]) return null;

  const refs = (await getJSON(env, KV_KEYS.aiscoreGameRefs)) || {};
  if (refs[match.id]) return refs[match.id];

  try {
    const kstDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(match.utcDate)
    );
    const targetKickoff = Math.round(new Date(match.utcDate).getTime() / 1000);
    const todays = await findAllTodayMatches(match.competition.code, kstDate);
    const candidates = todays.filter((m) => m.kickoff === targetKickoff);
    if (!candidates.length) return null;

    let found = candidates[0];
    if (candidates.length > 1) {
      // 동시 킥오프 경기가 여럿이면 팀ID 매핑으로 확인된 후보만 채택 - 모르면 안전하게 포기한다
      // (틀린 경기에 통계를 붙이는 것보다 아예 안 붙는 게 낫다).
      const homeAiscoreId = AISCORE_TEAM_ID_BY_APIFOOTBALL_ID[match.homeTeam.id];
      const awayAiscoreId = AISCORE_TEAM_ID_BY_APIFOOTBALL_ID[match.awayTeam.id];
      found = candidates.find((m) => (homeAiscoreId && m.homeId === homeAiscoreId) || (awayAiscoreId && m.awayId === awayAiscoreId));
      if (!found) return null;
    }

    refs[match.id] = found.matchId;
    await putJSON(env, KV_KEYS.aiscoreGameRefs, refs);
    return found.matchId;
  } catch (err) {
    console.error("aiscore matches list fetch failed:", err);
    return null;
  }
}

// 카테고리번호(문자열) -> {stats 필드, 값 변환}. possession만 우리 통계 화면의 기존 항목과 바로
// 연결된다(123 공격/124 위험공격은 우리 UI에 대응하는 항목이 없어 일단 보류 - 화면에 새 줄을
// 추가하면 그때 같이 켠다).
const STAT_CATEGORY_MAP = {
  125: { key: "possession", format: (v) => `${Number(v)}%` },
};

export async function fetchAiscoreStatistics(matchId, match) {
  const buf = await fetchAiscoreBinary(`https://api.aiscore.com/v1/m/api/match/team_stats?match_id=${matchId}`);
  const records = [];
  walkProtoLite(buf, 0, buf.length, 0, [], records);
  const strs = records.filter((r) => r.type === "str").map((r) => r.str);

  // [카테고리, 홈값, 원정값]이 21개 카테고리 묶음으로 3번(전체/전반/후반) 반복된다 - 카테고리가
  // 처음 나온 순간(=첫 번째 묶음=전체 누적)의 값만 쓰고, 같은 카테고리가 또 나오면(전반/후반 묶음)
  // 무시한다. 정확한 카테고리 개수에 의존하지 않아 응답 구조가 살짝 바뀌어도 안전하다.
  // 이 응답에 우리가 아는 카테고리 묶음 말고 다른 문자열 필드가 섞여 있을 가능성에 대비해,
  // "카테고리로 보이는(100~199, 숫자만) 값"이 나온 위치에서만 3개씩 묶어 읽는다 - 안 맞으면
  // 한 칸씩만 밀어서 정렬을 다시 맞춰본다(통째로 3칸씩 밀면 한 번 어긋난 뒤로 전부 못 읽는다).
  const isCategoryLike = (s) => /^1\d{2}$/.test(s);
  const isValueLike = (s) => /^\d{1,3}$/.test(s);
  const seen = new Set();
  const homeStats = {};
  const awayStats = {};
  for (let i = 0; i + 2 < strs.length; i++) {
    if (!isCategoryLike(strs[i]) || !isValueLike(strs[i + 1]) || !isValueLike(strs[i + 2])) continue;
    const cat = Number(strs[i]);
    const mapping = STAT_CATEGORY_MAP[cat];
    if (!mapping || seen.has(cat)) continue;
    seen.add(cat);
    homeStats[mapping.key] = mapping.format(strs[i + 1]);
    awayStats[mapping.key] = mapping.format(strs[i + 2]);
  }

  if (!Object.keys(homeStats).length) return [];
  return [
    { teamId: String(match.homeTeam.id), stats: homeStats },
    { teamId: String(match.awayTeam.id), stats: awayStats },
  ];
}
