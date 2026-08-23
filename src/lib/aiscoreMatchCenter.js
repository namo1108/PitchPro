import { getJSON, putJSON } from "./kv.js";
import { KV_KEYS } from "./config.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
// - /v1/m/api/match/team_stats?match_id=... : 통계도 라벨이 없고, "3자리 카테고리번호 + 홈값 +
//   원정값"을 그냥 이어붙인 십진수 하나로 옴(예: 1253169 = 카테고리125 + 홈31 + 원정69 = 점유율
//   31%-69%). 실제 화면(m.aiscore.com 라인업/통계 탭) 스크린샷과 대조해서 지금까지 확인된 카테고리:
//   123=공격, 124=위험공격, 125=점유율. 나머지(슈팅/코너/카드 등으로 추정되는 값들)는 이 매치 하나의
//   스냅샷만으로는 확실히 구분이 안 돼(여러 후보가 같은 값으로 겹침) 더 확인 전까진 안 쓴다 -
//   확인되는 대로 STAT_CATEGORY_MAP에 추가하면 된다.
const K3_COMPETITION_ID = "r8lk2dig0ni0736";
const K4_COMPETITION_ID = "0ndkz6ix1gtgq3z";
const COMPETITION_IDS = { K3: K3_COMPETITION_ID, K4: K4_COMPETITION_ID };

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
      const asStr = slice.toString("utf8");
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
  return Buffer.from(await res.arrayBuffer());
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
    const found = todays.find((m) => m.kickoff === targetKickoff);
    if (!found) return null;

    refs[match.id] = found.matchId;
    await putJSON(env, KV_KEYS.aiscoreGameRefs, refs);
    return found.matchId;
  } catch (err) {
    console.error("aiscore matches list fetch failed:", err);
    return null;
  }
}

// 카테고리번호 -> {stats 필드, 자릿수 폭}. possession만 우리 통계 화면의 기존 항목과 바로 연결된다
// (123 공격/124 위험공격은 우리 UI에 대응하는 항목이 없어 일단 보류 - 화면에 새 줄을 추가하면 그때
// 같이 켠다).
const STAT_CATEGORY_MAP = {
  125: { key: "possession", digits: 2, format: (v) => `${v}%` },
};

function decodeStatValue(raw) {
  const s = String(raw);
  for (const digits of [2, 1]) {
    const catLen = s.length - digits * 2;
    if (catLen < 1) continue;
    const cat = Number(s.slice(0, catLen));
    const mapping = STAT_CATEGORY_MAP[cat];
    if (mapping && mapping.digits === digits) {
      const home = Number(s.slice(catLen, catLen + digits));
      const away = Number(s.slice(catLen + digits));
      return { key: mapping.key, home: mapping.format ? mapping.format(home) : home, away: mapping.format ? mapping.format(away) : away };
    }
  }
  return null;
}

export async function fetchAiscoreStatistics(matchId, match) {
  const buf = await fetchAiscoreBinary(`https://api.aiscore.com/v1/m/api/match/team_stats?match_id=${matchId}`);
  const records = [];
  walkProtoLite(buf, 0, buf.length, 0, [], records);

  const homeStats = {};
  const awayStats = {};
  for (const r of records) {
    if (r.type !== "str") continue;
    const decoded = decodeStatValue(r.str);
    if (!decoded) continue;
    homeStats[decoded.key] = decoded.home;
    awayStats[decoded.key] = decoded.away;
  }

  if (!Object.keys(homeStats).length) return [];
  return [
    { teamId: String(match.homeTeam.id), stats: homeStats },
    { teamId: String(match.awayTeam.id), stats: awayStats },
  ];
}
