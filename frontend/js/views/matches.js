import { fetchJSON } from "../api.js";
import { pushDetail, onTabChange } from "../router.js";
import {
  STATUS_KO,
  LIVE_STATUSES,
  crestImg,
  emblemImg,
  formatKickoff,
  liveMinuteLabel,
  dateWithOffset,
  toISODate,
  formatDateLabel,
  KST_TIME_ZONE,
  fadeIn,
  skeletonList,
  playerAvatarImg,
} from "../format.js";
import { goToTeam } from "./teamDetail.js";
import { goToPlayer } from "./playerDetail.js";
import { isWatched, toggleWatch } from "../watchlist.js";
import { setMatchWatch } from "../push.js";
import { isFavorite } from "../favorites.js";
import { saveViewState } from "../viewState.js";

const state = {
  dayOffset: 0,
  lastScores: new Map(),
  lastStatus: new Map(),
  lineupNotified: new Set(),
  pollTimer: null,
  hasCheckedLineupsOnce: false,
};

const el = {
  matchesList: document.getElementById("matches-list"),
  dateLabel: document.getElementById("current-date-label"),
  prevDay: document.getElementById("prev-day"),
  nextDay: document.getElementById("next-day"),
  refreshBtn: document.getElementById("refresh-btn"),
  datePickerBtn: document.getElementById("date-picker-btn"),
  dateInput: document.getElementById("date-picker-input"),
  detailContent: document.getElementById("match-detail-content"),
};

export function setDayOffset(offset) {
  state.dayOffset = offset;
}

export async function loadMatches(opts = {}) {
  el.dateLabel.textContent = formatDateLabel(state.dayOffset);
  if (!opts.silent) saveViewState({ view: "matches", dayOffset: state.dayOffset });
  if (!opts.silent) el.matchesList.innerHTML = skeletonList(5);
  try {
    const iso = toISODate(dateWithOffset(state.dayOffset));
    const data = await fetchJSON(`/matches?date=${iso}`);
    const matches = data.matches || [];
    checkForGoals(matches);
    checkForLineupAnnouncements(matches);
    renderMatches(matches);
    if (!opts.silent) fadeIn(el.matchesList);
    startAutoRefresh();
  } catch (err) {
    if (!opts.silent) el.matchesList.innerHTML = `<div class="error-state">경기 정보를 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

// 즐겨찾기 팀 경기이거나 🔔로 지켜보고 있는 경기인지.
function isWatchedMatch(m) {
  return isWatched(m.id) || isFavorite(m.homeTeam.id) || isFavorite(m.awayTeam.id);
}

// 이전에 불러온 스코어/상태와 비교해서, 지켜보는 경기에 골이 들어가거나 시작/종료되면 토스트+효과음을 띄운다.
function checkForGoals(matches) {
  const scoredEvents = [];
  const kickoffEvents = [];
  const finishedEvents = [];

  matches.forEach((m) => {
    const isLive = LIVE_STATUSES.has(m.status);
    const isFinished = m.status === "FINISHED";
    const home = m.score.fullTime.home ?? 0;
    const away = m.score.fullTime.away ?? 0;
    const prevScore = state.lastScores.get(m.id);
    const prevStatus = state.lastStatus.get(m.id);
    const watched = isWatchedMatch(m);

    if (isLive && prevScore && (home > prevScore.home || away > prevScore.away) && watched) {
      scoredEvents.push(m);
    }
    if (isLive && prevStatus && !LIVE_STATUSES.has(prevStatus) && watched) {
      kickoffEvents.push(m);
    }
    if (isFinished && prevStatus && LIVE_STATUSES.has(prevStatus) && watched) {
      finishedEvents.push(m);
    }

    if (isLive) {
      state.lastScores.set(m.id, { home, away });
    } else {
      state.lastScores.delete(m.id);
    }
    state.lastStatus.set(m.id, m.status);
  });

  scoredEvents.forEach(showGoalToast);
  kickoffEvents.forEach(showKickoffToast);
  finishedEvents.forEach(showFinishedToast);
}

// 라인업 발표 여부는 서버 크론(notifyLineups)이 이미 확인해서 목록 응답에 lineupsAnnounced로 실어주므로,
// 여기서는 그 플래그만 보고 토스트를 띄운다(예전엔 후보 경기마다 상세를 직접 조회해서 30초마다 API 요청이
// 몰렸었는데, 그 문제를 없애기 위해 서버 쪽 플래그를 그대로 읽는 방식으로 바꿨다).
function checkForLineupAnnouncements(matches) {
  // 새로고침/첫 로딩 시점엔 "새로 발표됨"이 아니라 "이미 발표돼 있던 상태"일 뿐이니, 이번 로딩에서 처음
  // 본 발표 건들은 토스트 없이 조용히 기록만 하고, 그 다음부터 바뀌는 것만 알림으로 띄운다.
  const isFirstCheck = !state.hasCheckedLineupsOnce;
  state.hasCheckedLineupsOnce = true;

  matches.forEach((m) => {
    if (!m.lineupsAnnounced) return;
    if (!isWatchedMatch(m)) return;
    if (state.lineupNotified.has(m.id)) return;
    state.lineupNotified.add(m.id);
    if (!isFirstCheck) showLineupToast(m);
  });
}

// 크론이 몇 분마다 도는 거라 elapsed 값 자체가 실시간은 아니다. 같은 값이 여러 번 반복되는 동안
// 벽시계 기준으로 얼마나 지났는지 더해서, 다음 서버 갱신 전까지도 화면상 시계가 자연스럽게 흘러가게 한다
// (실제 갱신이 오면 그 값으로 바로 리셋되니 오차가 누적되진 않는다).
const elapsedBaseMap = new Map();
const MAX_INTERPOLATED_MINUTES = 4;

function getDisplayElapsed(matchId, elapsed) {
  if (elapsed === null || elapsed === undefined) return elapsed;
  const prev = elapsedBaseMap.get(matchId);
  if (!prev || prev.elapsed !== elapsed) {
    elapsedBaseMap.set(matchId, { elapsed, seenAt: Date.now() });
    return elapsed;
  }
  const extra = Math.min(Math.floor((Date.now() - prev.seenAt) / 60000), MAX_INTERPOLATED_MINUTES);
  return elapsed + extra;
}

function startAutoRefresh() {
  if (state.pollTimer) return;
  state.pollTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (!document.getElementById("view-matches")?.classList.contains("active")) return;
    loadMatches({ silent: true });
  }, 30000);
}

const GOAL_SOUND_KEY = "pitchpro.goalSound";

// 골 알림음 종류. "none"은 무음(진동/시각 효과만). file이 있으면 실제 mp3, 없으면 합성음(폴백용).
export const GOAL_SOUNDS = [
  { id: "goal1", label: "골 사운드 1", file: "/sounds/goal1.mp3" },
  { id: "goal2", label: "골 사운드 2", file: "/sounds/goal2.mp3" },
  { id: "chime", label: "차임(합성음)" },
  { id: "none", label: "무음" },
];

export function getGoalSound() {
  return localStorage.getItem(GOAL_SOUND_KEY) || "goal1";
}

export function setGoalSound(id) {
  localStorage.setItem(GOAL_SOUND_KEY, id);
}

function tone(ctx, { freq, endFreq, start, duration, type = "sine", gain = 0.3 }) {
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + start + duration);
  gainNode.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  gainNode.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  osc.connect(gainNode).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.05);
}

function playFile(path, volume = 0.85) {
  try {
    const audio = new Audio(path);
    audio.volume = volume;
    audio.play().catch(() => {});
  } catch {
    // 오디오 재생 불가 환경이면 조용히 무시
  }
}

export function previewGoalSound() {
  playGoalSound();
}

function playGoalSound() {
  const soundId = getGoalSound();
  if (soundId === "none") return;

  const sound = GOAL_SOUNDS.find((s) => s.id === soundId);
  if (sound?.file) {
    playFile(sound.file);
    return;
  }

  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    tone(ctx, { freq: 880, endFreq: 1320, start: 0, duration: 0.6, type: "sine", gain: 0.3 });
  } catch {
    // Web Audio 미지원/차단 상태면 조용히 무시
  }
}

function showGoalToast(m) {
  const home = m.score.fullTime.home;
  const away = m.score.fullTime.away;
  const toast = document.createElement("div");
  toast.className = "goal-toast";
  toast.innerHTML = `
    <div class="goal-toast-ball">⚽</div>
    <div class="goal-toast-text">
      <div class="goal-toast-title">GOAL!</div>
      <div class="goal-toast-body">${m.homeTeam.shortName || m.homeTeam.name} ${home} - ${away} ${m.awayTeam.shortName || m.awayTeam.name}</div>
    </div>
  `;
  document.body.appendChild(toast);

  const flash = document.createElement("div");
  flash.className = "goal-flash";
  document.body.appendChild(flash);

  playGoalSound();

  requestAnimationFrame(() => {
    toast.classList.add("show");
    flash.classList.add("show");
  });
  setTimeout(() => flash.remove(), 700);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 400);
  }, 4200);
}

function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    tone(ctx, { freq: 1046, start: 0, duration: 0.15, type: "sine", gain: 0.22 });
    tone(ctx, { freq: 1318, start: 0.15, duration: 0.28, type: "sine", gain: 0.22 });
  } catch {
    // Web Audio 미지원/차단 상태면 조용히 무시
  }
}

function showSimpleToast({ icon, title, body, soundFile }) {
  const toast = document.createElement("div");
  toast.className = "simple-toast";
  toast.innerHTML = `
    <div class="simple-toast-icon">${icon}</div>
    <div class="goal-toast-text">
      <div class="simple-toast-title">${title}</div>
      <div class="goal-toast-body">${body}</div>
    </div>
  `;
  document.body.appendChild(toast);
  if (getGoalSound() !== "none") {
    if (soundFile) playFile(soundFile, 0.7);
    else playChime();
  }

  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 400);
  }, 3200);
}

function showLineupToast(m) {
  showSimpleToast({
    icon: "🏟️",
    title: "라인업 발표",
    body: `${m.homeTeam.shortName || m.homeTeam.name} vs ${m.awayTeam.shortName || m.awayTeam.name} 라인업이 발표됐습니다.`,
  });
}

function showKickoffToast(m) {
  showSimpleToast({
    icon: "⏱",
    title: "경기 시작",
    body: `${m.homeTeam.shortName || m.homeTeam.name} vs ${m.awayTeam.shortName || m.awayTeam.name} 킥오프!`,
    soundFile: "/sounds/start.mp3",
  });
}

function showFinishedToast(m) {
  const home = m.score.fullTime.home;
  const away = m.score.fullTime.away;
  showSimpleToast({
    icon: "🏁",
    title: "경기 종료",
    body: `${m.homeTeam.shortName || m.homeTeam.name} ${home} - ${away} ${m.awayTeam.shortName || m.awayTeam.name}`,
    soundFile: "/sounds/end.mp3",
  });
}

// 화면 상단에 크게 보여줄 "주요 경기" 하나를 고른다: 라이브 경기가 있으면 그중 우선순위가 높은 대회,
// 없으면 오늘 경기 중 우선순위가 높은 대회의 가장 이른 경기.
// 우선순위: (0) 나의 팀(즐겨찾기) 경기는 isFollowedMatch로 이미 별도 필터링되어 항상 최우선이고,
// 그 다음은 대회 격 순서로 월드컵 > 대륙간컵대회(챔피언스리그/유로) > 세계 상위 리그 > 컵대회.
const COMPETITION_TIERS = [
  ["WC"], // 월드컵
  ["CL", "EC"], // 대륙간컵대회
  ["PL", "PD", "BL1", "SA", "FL1", "DED", "PPL", "ELC", "BSA", "KL1", "KL2"], // 세계 상위 리그
  ["KFA"], // 컵대회
];

function competitionRank(code) {
  const idx = COMPETITION_TIERS.findIndex((tier) => tier.includes(code));
  return idx === -1 ? COMPETITION_TIERS.length : idx;
}

function isFollowedMatch(m) {
  return isFavorite(m.homeTeam.id) || isFavorite(m.awayTeam.id);
}

function pickFeaturedMatch(matches) {
  const liveMatches = matches.filter((m) => LIVE_STATUSES.has(m.status));
  const pool = liveMatches.length ? liveMatches : matches;

  // 내가 팔로우(즐겨찾기)한 팀의 경기가 있으면 그중에서 우선 고른다.
  const followedPool = pool.filter(isFollowedMatch);
  const searchPool = followedPool.length ? followedPool : pool;

  return searchPool
    .slice()
    .sort((a, b) => {
      const rankDiff = competitionRank(a.competition.code) - competitionRank(b.competition.code);
      return rankDiff !== 0 ? rankDiff : new Date(a.utcDate) - new Date(b.utcDate);
    })[0];
}

function renderMatches(matches) {
  if (!matches.length) {
    el.matchesList.innerHTML = '<div class="empty-state">해당 날짜에 예정된 경기가 없습니다.</div>';
    fadeIn(el.matchesList);
    return;
  }

  el.matchesList.innerHTML = "";

  const featured = pickFeaturedMatch(matches);
  const rest = featured ? matches.filter((m) => m.id !== featured.id) : matches;

  if (featured) {
    const section = document.createElement("div");
    section.className = "featured-section";

    const header = document.createElement("div");
    header.className = "section-header-row";
    header.innerHTML = '<div class="section-subtitle">🏆 주요 경기</div>';
    if (rest.length) {
      const link = document.createElement("button");
      link.className = "section-link";
      link.textContent = "전체 보기 ›";
      link.addEventListener("click", () => {
        el.matchesList.querySelector(".competition-group")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      header.appendChild(link);
    }
    section.appendChild(header);

    section.appendChild(renderHeroCard(featured));
    el.matchesList.appendChild(section);
  }

  if (!rest.length) return;

  const groups = new Map();
  rest.forEach((m) => {
    const key = m.competition.code || m.competition.name;
    if (!groups.has(key)) groups.set(key, { info: m.competition, matches: [] });
    groups.get(key).matches.push(m);
  });

  // 친선경기는 대회가 아니라 부가적인 목록이라, 순서와 상관없이 항상 맨 아래로 보낸다.
  const orderedGroups = [...groups.values()].sort((a, b) => {
    const aFriendly = a.info.code === "FRIENDLY" ? 1 : 0;
    const bFriendly = b.info.code === "FRIENDLY" ? 1 : 0;
    return aFriendly - bFriendly;
  });

  orderedGroups.forEach((group) => {
    const groupEl = document.createElement("div");
    groupEl.className = "competition-group";

    const header = document.createElement("div");
    header.className = "competition-header";
    header.innerHTML = `${emblemImg(group.info, "competition-emblem")}<span class="competition-header-name">${group.info.name}</span><span class="competition-header-count">${group.matches.length}</span><span class="competition-header-arrow">▾</span>`;
    groupEl.appendChild(header);

    const body = document.createElement("div");
    body.className = "competition-body";
    group.matches
      .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
      .forEach((m) => body.appendChild(renderMatchRow(m)));
    groupEl.appendChild(body);

    // 대회 헤더를 눌러서 그 안의 경기 목록을 접었다 펼 수 있게(리그 많은 날 스크롤 부담을 줄임).
    header.addEventListener("click", () => {
      const collapsed = groupEl.classList.toggle("collapsed");
      body.style.display = collapsed ? "none" : "";
    });

    el.matchesList.appendChild(groupEl);
  });
}

// 경기별 알림 벨(★즐겨찾기와 무관하게 이 경기 하나만 골 알림)의 공용 마크업.
function watchBellHtml(matchId) {
  const watched = isWatched(matchId);
  return `<button class="watch-bell ${watched ? "active" : ""}" data-watch-id="${matchId}" aria-label="경기 알림 설정" title="경기 알림 설정">${watched ? "🔔" : "🔕"}</button>`;
}

function attachWatchBells(root) {
  root.querySelectorAll("[data-watch-id]").forEach((bellEl) => {
    bellEl.addEventListener("click", async (e) => {
      e.stopPropagation();
      const matchId = bellEl.dataset.watchId;
      const nowWatched = toggleWatch(matchId);
      bellEl.classList.toggle("active", nowWatched);
      bellEl.textContent = nowWatched ? "🔔" : "🔕";

      const ok = await setMatchWatch(matchId, nowWatched);
      if (!ok) {
        const reverted = toggleWatch(matchId);
        bellEl.classList.toggle("active", reverted);
        bellEl.textContent = reverted ? "🔔" : "🔕";
        alert("알림을 받으려면 브라우저 알림 권한이 필요합니다.");
      }
    });
  });
}

function renderHeroCard(m) {
  const card = document.createElement("div");
  card.className = "hero-match-card";

  const isLive = LIVE_STATUSES.has(m.status);
  const isFinished = m.status === "FINISHED";
  const home = m.score.fullTime.home;
  const away = m.score.fullTime.away;
  const hasScore = home !== null && home !== undefined;

  const statusText = isLive
    ? liveMinuteLabel(m.status, getDisplayElapsed(m.id, m.elapsed))
    : isFinished
    ? "종료"
    : m.status === "TIME_TBD"
    ? STATUS_KO.TIME_TBD
    : formatKickoff(m.utcDate);
  const statusClass = isLive ? "live" : isFinished ? "finished" : "scheduled";

  card.innerHTML = `
    <div class="hero-match-top">
      <div class="hero-match-top-info">
        ${emblemImg(m.competition, "hero-match-comp-emblem")}
        <span class="hero-match-comp-name">${m.competition.name}</span>
      </div>
      ${watchBellHtml(m.id)}
    </div>
    <div class="hero-match-teams">
      <div class="hero-match-team" data-team-id="${m.homeTeam.id}">
        ${crestImg(m.homeTeam, "hero-match-crest")}
        <span>${m.homeTeam.shortName || m.homeTeam.name}</span>
      </div>
      <div class="hero-match-center">
        <div class="hero-match-score">${hasScore ? `${home} - ${away}` : "vs"}</div>
        <div class="hero-match-status ${statusClass}">${isLive ? '<span class="live-dot"></span>' : ""}${statusText}</div>
      </div>
      <div class="hero-match-team" data-team-id="${m.awayTeam.id}">
        ${crestImg(m.awayTeam, "hero-match-crest")}
        <span>${m.awayTeam.shortName || m.awayTeam.name}</span>
      </div>
    </div>
  `;

  card.querySelectorAll("[data-team-id]").forEach((teamEl) => {
    teamEl.addEventListener("click", (e) => {
      e.stopPropagation();
      goToTeam(teamEl.dataset.teamId);
    });
  });
  attachWatchBells(card);

  card.addEventListener("click", () => loadMatchDetail(m.id, m));
  return card;
}

function renderMatchRow(m) {
  const row = document.createElement("div");
  row.className = "match-row";

  const isLive = LIVE_STATUSES.has(m.status);
  const isFinished = m.status === "FINISHED";
  const home = m.score.fullTime.home;
  const away = m.score.fullTime.away;
  const hasScore = home !== null && home !== undefined;

  let statusHtml;
  if (isLive) {
    statusHtml = `<div class="match-status live"><span class="live-dot"></span>${liveMinuteLabel(m.status, getDisplayElapsed(m.id, m.elapsed))}</div>`;
  } else if (isFinished) {
    statusHtml = `<div class="match-status finished">종료</div>`;
  } else if (["POSTPONED", "SUSPENDED", "CANCELLED"].includes(m.status)) {
    statusHtml = `<div class="match-status finished">${STATUS_KO[m.status]}</div>`;
  } else if (m.status === "TIME_TBD") {
    statusHtml = `<div class="match-status scheduled">${STATUS_KO.TIME_TBD}</div>`;
  } else {
    statusHtml = `<div class="match-status scheduled">${formatKickoff(m.utcDate)}</div>`;
  }

  const scoreHtml = hasScore
    ? `<div class="score-box ${isLive ? "live-score" : ""}">${home}<span class="score-dash">:</span>${away}</div>`
    : `<div class="score-box">vs</div>`;

  row.innerHTML = `
    ${statusHtml}
    <div class="team home" data-team-id="${m.homeTeam.id}">
      ${crestImg(m.homeTeam, "team-crest")}
      <span class="team-name">${m.homeTeam.shortName || m.homeTeam.name}</span>
    </div>
    ${scoreHtml}
    <div class="team away" data-team-id="${m.awayTeam.id}">
      ${crestImg(m.awayTeam, "team-crest")}
      <span class="team-name">${m.awayTeam.shortName || m.awayTeam.name}</span>
    </div>
    <div class="match-row-actions">
      ${m.ticketUrl ? `<a class="match-ticket-btn" href="${m.ticketUrl}" target="_blank" rel="noopener" title="티켓 예매하기" onclick="event.stopPropagation()">🎟</a>` : ""}
      ${watchBellHtml(m.id)}
    </div>
  `;

  row.querySelectorAll("[data-team-id]").forEach((teamEl) => {
    teamEl.addEventListener("click", (e) => {
      e.stopPropagation();
      goToTeam(teamEl.dataset.teamId);
    });
  });
  attachWatchBells(row);

  row.addEventListener("click", () => loadMatchDetail(m.id, m));
  return row;
}

// knownMatch가 있으면(목록에서 이미 갖고 있던 경기 정보) 네트워크 응답을 기다리지 않고 스코어보드부터
// 바로 그려서 "뚝뚝 끊기는" 느낌 없이 전환되게 하고, 득점자/스탯/라인업처럼 상세 전용 데이터만 뒤이어 채운다.
export async function loadMatchDetail(matchId, knownMatch) {
  pushDetail("detail");
  saveViewState({ view: "detail", matchId });
  if (knownMatch) {
    renderMatchDetail(knownMatch);
    fadeIn(el.detailContent);
  } else {
    el.detailContent.innerHTML = skeletonList(6);
  }

  try {
    const data = await fetchJSON(`/matches/${matchId}`);
    const m = data.match || data;
    renderMatchDetail(m);
    if (!knownMatch) fadeIn(el.detailContent);

    // 상대전적은 별도 엔드포인트라 메인 정보가 먼저 뜬 뒤 이어서 채운다.
    fetchJSON(`/head2head?a=${m.homeTeam.id}&b=${m.awayTeam.id}`)
      .then((h2h) => renderHeadToHead(h2h, m))
      .catch(() => {});
  } catch (err) {
    if (!knownMatch) {
      el.detailContent.innerHTML = `<div class="error-state">경기 상세 정보를 불러오지 못했습니다.<br>${err.message}</div>`;
    }
  }
}

function statRow(label, home, away, statsHome, statsAway, key) {
  const h = statsHome[key];
  const a = statsAway[key];
  if (h === undefined && a === undefined) return "";
  const hNum = parseFloat(h) || 0;
  const aNum = parseFloat(a) || 0;
  const total = hNum + aNum || 1;
  const hPct = Math.round((hNum / total) * 100);
  return `
    <div class="stat-row">
      <div class="stat-value home">${h ?? "-"}</div>
      <div class="stat-label">${label}</div>
      <div class="stat-value away">${a ?? "-"}</div>
    </div>
    <div class="stat-bar"><div class="stat-bar-fill" style="width:${hPct}%"></div></div>
  `;
}

function renderStatistics(m) {
  if (!m.statistics || m.statistics.length < 2) return "";
  const statsHome = m.statistics.find((s) => s.teamId === m.homeTeam.id)?.stats || {};
  const statsAway = m.statistics.find((s) => s.teamId === m.awayTeam.id)?.stats || {};

  const rows = [
    ["점유율", "possession"],
    ["슈팅", "shotsTotal"],
    ["유효 슈팅", "shotsOnGoal"],
    ["선방", "saves"],
    ["코너킥", "corners"],
    ["파울", "fouls"],
    ["경고", "yellowCards"],
    ["퇴장", "redCards"],
    ["패스 성공률", "passAccuracy"],
    ["xG", "xg"],
  ]
    .map(([label, key]) => statRow(label, m.homeTeam, m.awayTeam, statsHome, statsAway, key))
    .join("");

  if (!rows.trim()) return "";
  return `<div class="team-section"><h3 class="team-section-title">경기 스탯</h3>${rows}</div>`;
}

// grid는 API-Football이 주는 "row:col" 좌표. 팀별로 자기 진영 골라인 쪽에서 하프라인 쪽으로
// row가 커지도록 배치하고, 같은 row 안에서는 col 순서대로 좌우 균등 배치한다.
function layoutSide(startXI) {
  const rows = new Map();
  startXI.forEach((p) => {
    if (!p.grid) return;
    const [row] = p.grid.split(":").map(Number);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push(p);
  });
  return rows;
}

// 한 화면 공유 피치(양 팀이 하프라인을 두고 마주보는 모양) 배경 라인. 팀 크레스트 이미지와 달리
// 우리가 직접 그린 벡터라 투명 배경이 100% 보장돼서 예전처럼 얼룩이 생길 걱정이 없다.
const PITCH_LINES_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<g fill="none" stroke="#ffffff" stroke-width="0.7" opacity="0.14">` +
    `<rect x="2" y="2" width="96" height="96"/>` +
    `<path d="M22 98 L22 85 L78 85 L78 98"/>` +
    `<path d="M38 98 L38 92 L62 92 L62 98"/>` +
    `<path d="M22 2 L22 15 L78 15 L78 2"/>` +
    `<path d="M38 2 L38 8 L62 8 L62 2"/>` +
    `<line x1="2" y1="50" x2="98" y2="50"/>` +
    `<circle cx="50" cy="50" r="9"/>` +
    `</g>` +
    `</svg>`
);
const PITCH_LINES_BG = `url("data:image/svg+xml,${PITCH_LINES_SVG}")`;

function ratingClass(rating) {
  if (rating >= 7.5) return "great";
  if (rating >= 6.5) return "ok";
  return "poor";
}

function averageAge(startXI) {
  const ages = startXI.map((p) => p.age).filter((a) => typeof a === "number");
  if (!ages.length) return null;
  return (ages.reduce((sum, a) => sum + a, 0) / ages.length).toFixed(1);
}

function pitchPlayerDot(p, x, y, ringColor, teamId) {
  const lastName = p.name.split(" ").slice(-1)[0];
  const ratingHtml =
    typeof p.rating === "number"
      ? `<div class="pitch-rating ${ratingClass(p.rating)}">${p.rating.toFixed(1)}</div>`
      : "";
  const subOffHtml = p.subbedOffMinute ? `<div class="pitch-sub-off">${p.subbedOffMinute}'</div>` : "";
  return `
    <div class="pitch-player-abs" style="left:${x}%; top:${y}%;">
      <div class="pitch-photo-wrap">
        ${subOffHtml}
        <div class="pitch-photo-ring" style="border-color:${ringColor};" data-player-id="${p.id}">
          ${playerAvatarImg(p, teamId, "pitch-photo")}
        </div>
        ${ratingHtml}
      </div>
      <div class="pitch-player-name">${lastName}</div>
    </div>
  `;
}

// isHome이면 자기 골문(하단)에서 하프라인 쪽(위)으로, 원정이면 자기 골문(상단)에서 하프라인 쪽(아래)으로.
function renderSidePlayers(startXI, isHome, jerseyColor, gkColor, teamId) {
  const rows = layoutSide(startXI);
  const maxRow = Math.max(...rows.keys(), 1);
  const dots = [];

  rows.forEach((players, row) => {
    const sorted = players.slice().sort((a, b) => Number(a.grid.split(":")[1]) - Number(b.grid.split(":")[1]));
    sorted.forEach((p, i) => {
      const x = ((i + 1) / (sorted.length + 1)) * 100;
      // 하프라인 쪽 여유 공간을 넉넉히 남겨야(42~58%) 두 팀 최전방 줄 선수 사진이 겹치지 않는다.
      const y = isHome
        ? 92 - ((row - 1) / Math.max(maxRow - 1, 1)) * 34
        : 8 + ((row - 1) / Math.max(maxRow - 1, 1)) * 34;
      const color = row === 1 ? gkColor || "#f2c230" : jerseyColor || (isHome ? "#24e583" : "#5a8bff");
      dots.push(pitchPlayerDot(p, x, y, color, teamId));
    });
  });

  return dots.join("");
}

function benchColumn(lineup, side) {
  const avgAge = lineup ? averageAge(lineup.startXI) : null;
  const subs = lineup?.substitutes || [];
  return `
    <div class="pitch-bench-col ${side}">
      ${subs.length ? subs.map((p) => `<div class="pitch-bench-player" data-player-id="${p.id}">${p.number ?? ""} ${p.name}</div>`).join("") : '<div class="empty-state">교체 명단 없음</div>'}
      <div class="pitch-side-footer">
        ${avgAge ? `<div class="pitch-stat"><b>${avgAge}세</b><span>평균 나이</span></div>` : ""}
        ${lineup?.coach ? `<div class="pitch-stat"><b>${lineup.coach}</b><span>감독</span></div>` : ""}
      </div>
    </div>
  `;
}

function renderPitch(home, away, homeTeam, awayTeam) {
  if (!home?.startXI?.some((p) => p.grid) && !away?.startXI?.some((p) => p.grid)) return "";

  const homeTint = home?.colors?.player || "#24e583";
  const awayTint = away?.colors?.player || "#5a8bff";
  const bgStyle =
    `background-image: radial-gradient(circle at 50% 78%, ${homeTint}1f, transparent 45%), ` +
    `radial-gradient(circle at 50% 22%, ${awayTint}1f, transparent 45%), ${PITCH_LINES_BG}; ` +
    `background-size: auto, auto, 100% 100%; background-repeat: no-repeat, no-repeat, no-repeat;`;

  return `
    <div class="pitch-shared" style="${bgStyle}">
      <div class="pitch-team-tag home">
        ${homeTeam ? crestImg(homeTeam, "team-crest") : ""}
        <span>${homeTeam?.shortName || homeTeam?.name || ""}</span>
        ${home?.formation ? `<span class="pitch-formation-tag">${home.formation}</span>` : ""}
      </div>
      <div class="pitch-team-tag away">
        ${away?.formation ? `<span class="pitch-formation-tag">${away.formation}</span>` : ""}
        <span>${awayTeam?.shortName || awayTeam?.name || ""}</span>
        ${awayTeam ? crestImg(awayTeam, "team-crest") : ""}
      </div>
      ${home ? renderSidePlayers(home.startXI, true, home.colors?.player, home.colors?.goalkeeper, homeTeam?.id) : ""}
      ${away ? renderSidePlayers(away.startXI, false, away.colors?.player, away.colors?.goalkeeper, awayTeam?.id) : ""}
    </div>
    <div class="pitch-bench-row">
      ${benchColumn(home, "home")}
      ${benchColumn(away, "away")}
    </div>
  `;
}

function renderLineups(m) {
  if (!m.lineups || m.lineups.length < 2) return "";
  const home = m.lineups.find((l) => l.teamId === m.homeTeam.id);
  const away = m.lineups.find((l) => l.teamId === m.awayTeam.id);
  const pitchHtml = renderPitch(home, away, m.homeTeam, m.awayTeam);

  return `
    <div class="team-section">
      <h3 class="team-section-title">라인업</h3>
      ${pitchHtml || '<div class="empty-state">포메이션 좌표 정보가 없습니다.</div>'}
      ${m.tacticalNote ? `<p class="tactical-note">💡 ${m.tacticalNote}</p>` : ""}
    </div>
  `;
}

function renderHeadToHead(h2h, m) {
  const wrap = document.getElementById("h2h-section");
  if (!wrap) return;

  if (!h2h.matches || !h2h.matches.length) {
    wrap.innerHTML = '<h3 class="team-section-title">상대전적</h3><div class="empty-state">상대전적 정보가 없습니다.</div>';
    return;
  }

  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  h2h.matches.forEach((match) => {
    const home = match.score.fullTime.home;
    const away = match.score.fullTime.away;
    if (home === null || home === undefined) return;
    const homeWasHome = match.homeTeam.id === m.homeTeam.id;
    const homeGoals = homeWasHome ? home : away;
    const awayGoals = homeWasHome ? away : home;
    if (homeGoals > awayGoals) homeWins++;
    else if (homeGoals < awayGoals) awayWins++;
    else draws++;
  });

  wrap.innerHTML = `
    <h3 class="team-section-title">상대전적</h3>
    <div class="h2h-summary">${m.homeTeam.shortName || m.homeTeam.name} ${homeWins}승 ${draws}무 ${awayWins}패 ${m.awayTeam.shortName || m.awayTeam.name}</div>
    ${h2h.matches
      .slice(0, 5)
      .map((match) => {
        const home = match.score.fullTime.home;
        const away = match.score.fullTime.away;
        const hasScore = home !== null && home !== undefined;
        return `
          <div class="mini-match-row">
            <div class="mini-status">${new Date(match.utcDate).toLocaleDateString("ko-KR", { timeZone: KST_TIME_ZONE, month: "short", day: "numeric" })}</div>
            <div class="mini-team">${crestImg(match.homeTeam, "team-crest")}<span>${match.homeTeam.shortName || match.homeTeam.name}</span></div>
            <div class="mini-score">${hasScore ? `${home}:${away}` : "vs"}</div>
            <div class="mini-team">${crestImg(match.awayTeam, "team-crest")}<span>${match.awayTeam.shortName || match.awayTeam.name}</span></div>
          </div>
        `;
      })
      .join("")}
  `;
}

// 리그별로 라인업/스탯 데이터 형태가 들쭉날쭉해서(K리그2 일부 경기는 포메이션은 있는데 선수 좌표가
// 없는 등) 특정 경기에서 렌더링이 예외를 던지면, 그게 전체 상세 페이지 렌더링(템플릿 리터럴 하나로
// 이어져 있음)을 통째로 실패시켜서 화면이 "튕기는" 것처럼 보일 수 있었다. 섹션별로 감싸서 하나가
// 실패해도 나머지는 정상적으로 보이게 한다.
function safeRender(fn, fallback) {
  try {
    return fn();
  } catch (err) {
    console.error("section render failed:", err);
    return fallback;
  }
}

function renderMatchDetail(m) {
  const isLive = LIVE_STATUSES.has(m.status);
  const isFinished = m.status === "FINISHED";
  const home = m.score.fullTime.home;
  const away = m.score.fullTime.away;
  const hasScore = home !== null && home !== undefined;

  const statusClass = isLive ? "live" : isFinished ? "finished" : "";
  const statusText = isLive
    ? `🟢 ${liveMinuteLabel(m.status, getDisplayElapsed(m.id, m.elapsed))}`
    : isFinished
    ? "경기 종료"
    : m.status === "TIME_TBD"
    ? STATUS_KO.TIME_TBD
    : `${new Date(m.utcDate).toLocaleString("ko-KR", { timeZone: KST_TIME_ZONE })} 예정`;

  const ht = m.score.halfTime;
  const htHtml =
    ht && ht.home !== null && ht.home !== undefined
      ? `<div class="detail-halftime">전반전 ${ht.home} : ${ht.away}</div>`
      : "";

  const goalsHtml = (m.goalEvents || []).length
    ? `<div class="team-section">
        <h3 class="team-section-title">득점자</h3>
        ${m.goalEvents
          .map((g) => {
            const isHome = g.teamId === m.homeTeam.id;
            const line = `⊕ ${g.scorer} ${g.minute}'${g.penalty ? " (PK)" : ""}${g.ownGoal ? " (OG)" : ""}${g.assist ? ` <span class="goal-assist">(도움: ${g.assist})</span>` : ""}`;
            return `<div class="goal-scorer-row ${isHome ? "home" : "away"}">${line}</div>`;
          })
          .join("")}
      </div>`
    : "";

  const subsHtml = (m.substitutions || []).length
    ? `<div class="team-section">
        <h3 class="team-section-title">선수 교체</h3>
        ${m.substitutions
          .map((s) => {
            const isHome = s.teamId === m.homeTeam.id;
            const line = `⇄ ${s.minute}' <span class="sub-out">${s.playerOut}</span> → <span class="sub-in">${s.playerIn}</span>`;
            return `<div class="goal-scorer-row ${isHome ? "home" : "away"}">${line}</div>`;
          })
          .join("")}
      </div>`
    : "";

  const infoHtml = `
    ${goalsHtml}
    ${subsHtml}
    <div class="detail-info-grid">
      <div class="detail-info-item">
        <div class="detail-info-label">경기장</div>
        <div class="detail-info-value">${m.venue || "정보 없음"}</div>
      </div>
      <div class="detail-info-item">
        <div class="detail-info-label">대회</div>
        <div class="detail-info-value">${m.competition?.name || "-"}</div>
      </div>
      <div class="detail-info-item">
        <div class="detail-info-label">심판</div>
        <div class="detail-info-value">${(m.referees || []).map((r) => r.name).join(", ") || "정보 없음"}</div>
      </div>
    </div>
  `;

  el.detailContent.innerHTML = `
    <div class="scoreboard-card">
      <div class="scoreboard-competition">${m.competition?.name || ""}${m.matchday ? ` · ${m.matchday}` : ""}</div>
      <div class="scoreboard-teams">
        <div class="scoreboard-team" data-team-id="${m.homeTeam.id}">
          ${crestImg(m.homeTeam, "scoreboard-crest")}
          <div class="scoreboard-team-name">${m.homeTeam.name}</div>
        </div>
        <div class="scoreboard-score">${hasScore ? `${home} : ${away}` : "vs"}</div>
        <div class="scoreboard-team" data-team-id="${m.awayTeam.id}">
          ${crestImg(m.awayTeam, "scoreboard-crest")}
          <div class="scoreboard-team-name">${m.awayTeam.name}</div>
        </div>
      </div>
      <div class="scoreboard-status ${statusClass}">${statusText}</div>
      ${htHtml}
    </div>

    <div class="team-tabs">
      <button class="team-tab-btn active" data-detail-tab="info">정보</button>
      <button class="team-tab-btn" data-detail-tab="lineup">라인업</button>
      <button class="team-tab-btn" data-detail-tab="stats">통계</button>
      <button class="team-tab-btn" data-detail-tab="h2h">상대전적</button>
    </div>

    <div class="detail-tab-panels">
      <div class="detail-tab-panel" data-detail-panel="info">${infoHtml}</div>
      <div class="detail-tab-panel" data-detail-panel="lineup" style="display: none;">${safeRender(() => renderLineups(m), '<div class="empty-state">라인업 정보를 표시할 수 없습니다.</div>')}</div>
      <div class="detail-tab-panel" data-detail-panel="stats" style="display: none;">${safeRender(() => renderStatistics(m), "") || '<div class="empty-state">스탯 정보가 없습니다.</div>'}</div>
      <div class="detail-tab-panel" data-detail-panel="h2h" style="display: none;">
        <div class="team-section" id="h2h-section">
          <div class="loading">상대전적 불러오는 중...</div>
        </div>
      </div>
    </div>
  `;

  el.detailContent.querySelectorAll("[data-team-id]").forEach((teamEl) => {
    teamEl.style.cursor = "pointer";
    teamEl.addEventListener("click", () => goToTeam(teamEl.dataset.teamId));
  });

  el.detailContent.querySelectorAll(".pitch-photo-ring[data-player-id], .pitch-bench-player[data-player-id]").forEach((dotEl) => {
    dotEl.addEventListener("click", () => goToPlayer(dotEl.dataset.playerId));
  });

  const DETAIL_TAB_ORDER = ["info", "lineup", "stats", "h2h"];

  function activateDetailTab(tabName) {
    el.detailContent.querySelectorAll(".team-tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.detailTab === tabName));
    el.detailContent.querySelectorAll(".detail-tab-panel").forEach((panel) => {
      panel.style.display = panel.dataset.detailPanel === tabName ? "block" : "none";
    });
  }

  el.detailContent.querySelectorAll(".team-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => activateDetailTab(btn.dataset.detailTab));
  });

  // 탭을 좌우 스와이프로도 넘길 수 있게(fotmob처럼). 세로 스크롤과 헷갈리지 않도록 수평 이동이
  // 수직 이동보다 충분히 클 때만 탭을 전환한다.
  const panelsEl = el.detailContent.querySelector(".detail-tab-panels");
  let touchStartX = 0;
  let touchStartY = 0;
  panelsEl.addEventListener(
    "touchstart",
    (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    },
    { passive: true }
  );
  panelsEl.addEventListener(
    "touchend",
    (e) => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const activeBtn = el.detailContent.querySelector(".team-tab-btn.active");
      const currentIndex = DETAIL_TAB_ORDER.indexOf(activeBtn?.dataset.detailTab);
      if (currentIndex === -1) return;
      const nextIndex = dx < 0 ? Math.min(currentIndex + 1, DETAIL_TAB_ORDER.length - 1) : Math.max(currentIndex - 1, 0);
      if (nextIndex !== currentIndex) activateDetailTab(DETAIL_TAB_ORDER[nextIndex]);
    },
    { passive: true }
  );
}

el.prevDay.addEventListener("click", () => {
  state.dayOffset -= 1;
  loadMatches();
});
el.nextDay.addEventListener("click", () => {
  state.dayOffset += 1;
  loadMatches();
});
el.refreshBtn.addEventListener("click", () => {
  el.refreshBtn.classList.add("spinning");
  loadMatches().finally(() => {
    setTimeout(() => el.refreshBtn.classList.remove("spinning"), 600);
  });
});

el.datePickerBtn.addEventListener("click", () => {
  el.dateInput.value = toISODate(dateWithOffset(state.dayOffset));
  if (el.dateInput.showPicker) el.dateInput.showPicker();
  else el.dateInput.click();
});

el.dateInput.addEventListener("change", () => {
  if (!el.dateInput.value) return;
  const picked = new Date(`${el.dateInput.value}T00:00:00Z`);
  const today = new Date(`${toISODate(dateWithOffset(0))}T00:00:00Z`);
  state.dayOffset = Math.round((picked - today) / 86400000);
  loadMatches();
});

onTabChange("matches", loadMatches);
