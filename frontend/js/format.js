export const STATUS_KO = {
  SCHEDULED: "예정",
  TIMED: "예정",
  TIME_TBD: "시간 미정",
  IN_PLAY: "LIVE",
  PAUSED: "HT",
  FINISHED: "종료",
  POSTPONED: "연기",
  SUSPENDED: "중단",
  CANCELLED: "취소",
};

export const LIVE_STATUSES = new Set(["IN_PLAY", "PAUSED"]);

export const KST_TIME_ZONE = "Asia/Seoul";
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 기기의 시스템 시간대와 무관하게 항상 한국 시간(KST) 기준 날짜를 계산하기 위해,
// UTC 타임스탬프에 9시간을 더한 뒤 getUTC*로 읽는다(로컬 getter를 쓰면 기기 시간대가 다시 섞여 들어간다).
export function dateWithOffset(offset) {
  const kst = new Date(Date.now() + KST_OFFSET_MS);
  kst.setUTCDate(kst.getUTCDate() + offset);
  return kst;
}

export function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

export function formatDateLabel(offset) {
  const d = dateWithOffset(offset);
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][d.getUTCDay()];
  const dateStr = `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${weekday})`;
  if (offset === 0) return `${dateStr} 오늘`;
  if (offset === -1) return `${dateStr} 어제`;
  if (offset === 1) return `${dateStr} 내일`;
  return dateStr;
}

export function formatKickoff(utcDate) {
  const d = new Date(utcDate);
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: KST_TIME_ZONE });
}

// 며칠 뒤 경기인지 한눈에 보이도록 날짜까지 포함해서 표시(예: "7월 12일 19:00").
export function formatMatchDateTime(utcDate) {
  const d = new Date(utcDate);
  return d.toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: KST_TIME_ZONE,
  });
}

// API-Football이 실시간 경과 분(elapsed)을 직접 주므로 그대로 표시한다.
export function liveMinuteLabel(status, elapsed) {
  if (status === "PAUSED") return "HT";
  if (elapsed === null || elapsed === undefined) return "LIVE";
  return `${elapsed}'`;
}

const FALLBACK_CREST =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ctext y='18' font-size='18'%3E%E2%9A%BD%3C/text%3E%3C/svg%3E";

// team.crest/name은 대부분 API-Football 등 신뢰 소스에서 오지만, 커뮤니티 글의 팀 태그처럼 클라이언트가
// 실어보낸 값을 그대로 쓰는 경로도 생겨서(팀 이름 자체는 검색 결과에서만 고르지만, API 요청은 위조 가능)
// alt 속성 값은 항상 이스케이프한다 - 안 그러면 따옴표로 속성을 깨고 나가는 XSS가 가능해진다.
export function crestImg(team, size) {
  const src = team.crest || "";
  return `<img class="${size}" src="${escapeHtml(src || FALLBACK_CREST)}" onerror="this.src='${FALLBACK_CREST}'" alt="${escapeHtml(team.shortName || team.name || "")}" />`;
}

const FALLBACK_EMBLEM =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ctext y='18' font-size='18'%3E%F0%9F%8F%86%3C/text%3E%3C/svg%3E";

export function emblemImg(competition, size) {
  const src = competition?.emblem || "";
  return `<img class="${size}" src="${escapeHtml(src || FALLBACK_EMBLEM)}" onerror="this.src='${FALLBACK_EMBLEM}'" alt="${escapeHtml(competition?.name || "")}" />`;
}

// 팀/선수 상세 화면은 이름/스쿼드/일정 등을 서버에서 새로 받아와야 해서, 클릭 즉시 화면이 텅 빈
// 스켈레톤으로 바뀌었다가 몇백ms 뒤에야 내용이 채워지는 게 "로딩 없이 바로 랜딩되면 좋겠다"는
// 체감으로 이어졌다(2026-09-02 제보). 클릭한 요소 자체(크레스트 이미지 + 이름) 안에 이미 보여줄
// 정보가 들어있는 경우가 대부분이라, 그 DOM에서 바로 뽑아서 상세 화면 헤더를 먼저 그려두면(실제
// 데이터는 그 아래에서 계속 불러옴) 화면 전환 자체는 즉시 일어난 것처럼 느껴진다. 못 찾으면 null을
// 돌려주고, 호출부는 그냥 기존처럼 스켈레톤을 보여주면 되므로 어디에 붙여도 실패해도 안전하다.
function nameHintFromElement(elm) {
  if (!elm) return null;
  const img = elm.querySelector("img");
  const nameEl = elm.querySelector('[class*="name"]') || elm.querySelector("span");
  const name = nameEl?.textContent?.trim();
  return name ? { name, photoUrl: img?.src || null } : null;
}

export function teamHintFromElement(elm) {
  const hint = nameHintFromElement(elm);
  return hint ? { name: hint.name, crest: hint.photoUrl } : null;
}

export function playerHintFromElement(elm) {
  const hint = nameHintFromElement(elm);
  return hint ? { name: hint.name, photo: hint.photoUrl } : null;
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

// 선수 사진이 없을 때, 그 팀 고유 색(seed로 결정)의 유니폼을 입은 레고 미니피규어 아이콘으로 대체한다.
export function legoAvatarUri(seed) {
  const hue = hashString(String(seed)) % 360;
  const shirt = `hsl(${hue}, 60%, 45%)`;
  const shirtDark = `hsl(${hue}, 60%, 33%)`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="#eef2ef"/>` +
    `<path d="M4 64 Q4 39 32 39 Q60 39 60 64 Z" fill="${shirt}"/>` +
    `<path d="M4 64 Q4 39 32 39 Q60 39 60 64" fill="none" stroke="${shirtDark}" stroke-width="2"/>` +
    `<rect x="26" y="31" width="12" height="10" fill="#e8b923"/>` +
    `<circle cx="32" cy="21" r="15" fill="#f2c230"/>` +
    `<circle cx="25" cy="19" r="2.3" fill="#2b2b2b"/>` +
    `<circle cx="39" cy="19" r="2.3" fill="#2b2b2b"/>` +
    `<path d="M24 26 Q32 32 40 26" stroke="#2b2b2b" stroke-width="2.1" fill="none" stroke-linecap="round"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function playerAvatarImg(player, teamSeed, size) {
  const fallback = legoAvatarUri(teamSeed ?? player.id ?? player.name ?? "player");
  const src = player.photo || fallback;
  return `<img class="${size}" src="${src}" onerror="this.src='${fallback}'" alt="${player.name || ""}" />`;
}

// 이적시장 목록에서 선수 사진이 없을 때 쓰는 폴백 - 레고 미니피규어 대신 "이적"이라는 맥락에 맞게
// 유니폼/축구공/이적 화살표/축구화 4종을 seed 해시로 순환시켜(같은 사람은 항상 같은 아이콘) 단조로움을 줄인다.
const TRANSFER_ICON_BUILDERS = [
  // 유니폼
  (shirt, dark) =>
    `<path d="M14 14 L24 8 L32 15 L40 8 L50 14 L46 26 L40 22 L40 54 L24 54 L24 22 L18 26 Z" fill="${shirt}" stroke="${dark}" stroke-width="2"/>`,
  // 축구공
  (shirt, dark) =>
    `<circle cx="32" cy="32" r="21" fill="#ffffff" stroke="${dark}" stroke-width="2"/>` +
    `<polygon points="32,19 41,25 38,35 26,35 23,25" fill="${shirt}" stroke="${dark}" stroke-width="1.5"/>`,
  // 이적(교환) 화살표 - 팀을 옮긴다는 의미를 가장 직접적으로 담은 아이콘
  (shirt, dark) =>
    `<path d="M12 24 H42 M42 24 L34 16 M42 24 L34 32" stroke="${shirt}" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M52 42 H22 M22 42 L30 34 M22 42 L30 50" stroke="${dark}" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  // 축구화
  (shirt, dark) =>
    `<path d="M13 46 L13 31 Q13 25 21 25 L33 25 L45 35 L49 35 Q54 35 54 41 L54 46 Z" fill="${shirt}" stroke="${dark}" stroke-width="2"/>` +
    `<path d="M13 46 L54 46" stroke="${dark}" stroke-width="2"/>` +
    `<circle cx="21" cy="31" r="1.6" fill="${dark}"/><circle cx="27" cy="29" r="1.6" fill="${dark}"/><circle cx="33" cy="29" r="1.6" fill="${dark}"/>`,
];

export function transferAvatarUri(seed) {
  const key = String(seed);
  const hue = hashString(key) % 360;
  const shirt = `hsl(${hue}, 60%, 45%)`;
  const shirtDark = `hsl(${hue}, 60%, 33%)`;
  const build = TRANSFER_ICON_BUILDERS[hashString(`icon:${key}`) % TRANSFER_ICON_BUILDERS.length];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="#eef2ef"/>` +
    build(shirt, shirtDark) +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function transferAvatarImg(player, size) {
  const fallback = transferAvatarUri(player.id ?? player.name ?? "player");
  const src = player.photo || fallback;
  return `<img class="${size}" src="${src}" onerror="this.src='${fallback}'" alt="${player.name || ""}" />`;
}

// perspectiveTeamId 기준으로 이겼는지/비겼는지/졌는지를 계산한다(아직 스코어가 없는 예정 경기는 null).
export function matchResultForTeam(m, perspectiveTeamId) {
  const isHome = m.homeTeam.id === perspectiveTeamId;
  const my = isHome ? m.score.fullTime.home : m.score.fullTime.away;
  const opp = isHome ? m.score.fullTime.away : m.score.fullTime.home;
  if (my === null || my === undefined || opp === null || opp === undefined) return null;
  return my > opp ? "W" : my < opp ? "L" : "D";
}

const RESULT_CLASS = { W: "win", D: "draw", L: "loss" };

export function resultClass(result) {
  return result ? `result-${RESULT_CLASS[result]}` : "";
}

// 최근 경기 중 스코어가 확정된 것만 최근 것부터 count개 뽑아 W/D/L 뱃지 띠로 렌더링한다.
// recentMatches(팀 상세 API 응답)는 최신 경기가 배열 맨 앞에 오는 순서로 온다 - 예전엔 이걸
// 과거순(오래된 경기가 먼저)이라고 잘못 가정하고 .slice(-count)(배열 끝에서 count개, 즉 가장
// "오래된" count경기)를 뽑아서, 실제로는 최근 경기가 아니라 훨씬 예전 경기들을 보여주고 있었다
// (예: 최근 2연패가 있어도 그보다 앞선 시기의 무패 구간이 우연히 뽑혀 패배가 안 보이는 식).
// 배열 앞에서 count개(진짜 최신 순)를 뽑은 뒤, 좌→우로 "오래된 경기 -> 최근 경기" 순서로 읽히도록 뒤집는다.
// 예전엔 W/D/L 알파벳을 색칠된 정사각 배지(동그라미처럼 보임)에 담아 보여줬는데, "승/무/패 텍스트가
// 더 직관적"이라는 피드백에 따라 배지 없이 색깔만 입힌 한글 텍스트를 나란히 붙여 보여준다
// (예: 승승승무패) - 과거->최근 순으로 이미 뒤집어 놓은 배열이라 왼쪽이 오래된 경기, 오른쪽이 최근이다.
const FORM_RESULT_LABEL = { W: "승", D: "무", L: "패" };

export function formBadgesHtml(matches, perspectiveTeamId, count = 5) {
  const badges = (matches || [])
    .map((m) => matchResultForTeam(m, perspectiveTeamId))
    .filter(Boolean)
    .slice(0, count)
    .reverse()
    .map((result) => `<span class="form-badge ${result.toLowerCase()}">${FORM_RESULT_LABEL[result]}</span>`)
    .join("");
  return badges ? `<div class="form-strip">${badges}</div>` : "";
}

// 콘텐츠가 새로 그려질 때 "로딩중" 텍스트가 뚝 끊기듯 사라지는 대신 부드럽게 페이드인 되도록.
export function fadeIn(el) {
  if (!el) return;
  el.classList.remove("fade-in");
  void el.offsetWidth; // 애니메이션 재시작을 위한 강제 리플로우
  el.classList.add("fade-in");
}

// 목록류 화면의 첫 로딩 상태를 밋밋한 텍스트 대신 셰이머 스켈레톤으로.
export function skeletonList(count = 4) {
  return `<div class="skeleton-list">${Array.from({ length: count }, () => '<div class="skeleton-row"></div>').join("")}</div>`;
}

// 여긴 API-Football/kleague.com처럼 신뢰하는 소스가 아니라 다른 사용자가 직접 입력한 값(커뮤니티
// 글/댓글/닉네임)이 그대로 innerHTML에 들어가는 첫 사례라, 렌더링 전에 반드시 이스케이프해야 한다
// (안 그러면 <script> 등을 제목에 넣는 식으로 다른 사용자 화면에서 코드가 실행되는 stored XSS가 생김).
export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
