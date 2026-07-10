export const STATUS_KO = {
  SCHEDULED: "예정",
  TIMED: "예정",
  IN_PLAY: "LIVE",
  PAUSED: "HT",
  FINISHED: "종료",
  POSTPONED: "연기",
  SUSPENDED: "중단",
  CANCELLED: "취소",
};

export const LIVE_STATUSES = new Set(["IN_PLAY", "PAUSED"]);

export function dateWithOffset(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
}

export function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

export function formatDateLabel(offset) {
  if (offset === 0) return "오늘";
  if (offset === -1) return "어제";
  if (offset === 1) return "내일";
  const d = dateWithOffset(offset);
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekday})`;
}

export function formatKickoff(utcDate) {
  const d = new Date(utcDate);
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

const FALLBACK_CREST =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ctext y='18' font-size='18'%3E%E2%9A%BD%3C/text%3E%3C/svg%3E";

export function crestImg(team, size) {
  const src = team.crest || "";
  return `<img class="${size}" src="${src || FALLBACK_CREST}" onerror="this.src='${FALLBACK_CREST}'" alt="${team.shortName || team.name || ""}" />`;
}
