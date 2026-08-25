import { fetchJSON } from "../api.js";
import { pushDetail, onTabChange, openLeagueStandings } from "../router.js";
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
import { getTheme } from "../theme.js";

const state = {
  dayOffset: 0,
  pollTimer: null,
  // 이번 세션에서 이미 한 번 그려본 날짜는 탭을 오가거나 다시 새로고침해도 스켈레톤으로 안 비우고
  // 화면에 남겨둔 채 조용히 갱신한다 - 매번 탭 전환마다 깜빡이며 다시 로딩되는 느낌을 없앤다.
  loadedOffsets: new Set(),
  // 경기 상세는 목록 캐시로 먼저 한 번(라인업/스탯 없음) 그리고, 전체 조회가 끝나면 다시 그린다 -
  // 같은 경기를 다시 그릴 때는 그 사이 사용자가 눌러둔 탭(라인업 등)을 유지해야 한다(renderMatchDetail 참고).
  detailMatchId: null,
  // /api/matches는 live=all로 전세계 라이브 경기를 다 캐시에 합쳐서(pollLiveMatches.js) 코드에 없는
  // 변방 리그(해외 하부/유스 리그 등)까지 그대로 섞여 나온다 - 목록이 그 리그 수만큼 늘어나 원하는
  // 경기를 찾기 힘들다는 제보(2026-08-22)로, 기본은 아는 리그(=/competitions에 등록된 대회)만 보여주고
  // 나머지는 "다른 리그 보기"에서 사용자가 직접 고른 것만 추가로 보여준다. 마지막으로 받은 원본
  // matches를 들고 있어야 리그 선택이 바뀔 때 새로고침 없이 바로 다시 그릴 수 있다.
  lastMatches: null,
  extraLeagueCodes: loadExtraLeagueCodes(),
  pickerOpen: false,
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

const EXTRA_LEAGUES_KEY = "pitchpro.extraLeagues";

function loadExtraLeagueCodes() {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXTRA_LEAGUES_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveExtraLeagueCodes() {
  try {
    localStorage.setItem(EXTRA_LEAGUES_KEY, JSON.stringify([...state.extraLeagueCodes]));
  } catch {
    // 저장 실패해도(용량 초과 등) 이번 세션 안에서 선택 자체는 정상 동작하니 조용히 무시.
  }
}

// /competitions는 config.js에 등록된(=이름 있는) 대회만 돌려준다. 이 목록에 없는 코드는 전부
// live=all이 섞어온 변방 리그로 보고 기본 목록에서 뺀다. 탭 진입마다 새로 부를 필요 없어 한 번만
// 받아서 모듈 레벨에 캐싱한다.
// renderMatches는 여러 곳(최초 로드/자동 갱신/리그 선택 토글)에서 동기적으로 다시 불릴 수 있어서
// async로 만들지 않고, 최초 한 번만 fetch를 기다린 뒤(loadMatches에서 await) 이 변수를 읽게 한다.
// null이면 "아직 못 받음 또는 실패" -> 필터링 없이 예전처럼 전부 보여준다(fail-open).
let curatedCodes = null;
let curatedCodesPromise = null;
// 여기서 await하지 않고 백그라운드로만 쏜다 - 이 요청이 (reject가 아니라) 응답 자체를 못 받고
// 멈추는 상황이면, loadMatches에서 Promise.all로 묶어 기다릴 경우 경기 목록 자체가 영원히
// "불러오는 중"에서 멈춰버린다(토스 앱 내 webview에서 실제로 발생, 2026-08-25). curatedCodes가
// 늦게 채워져도 필터링이 fail-open(null이면 전부 표시)이라 문제없고, 다 받아온 뒤엔 이미 그려둔
// 목록을 한 번 더 다시 그려서 필터를 뒤늦게라도 적용한다.
function ensureCuratedCodes() {
  if (!curatedCodesPromise) {
    curatedCodesPromise = fetchJSON("/competitions")
      .then((data) => {
        curatedCodes = new Set((data.competitions || []).map((c) => c.code));
        if (state.lastMatches) renderMatches(state.lastMatches);
      })
      .catch(() => {}); // 실패하면 curatedCodes는 null로 남아 필터링을 건너뛴다.
  }
  return curatedCodesPromise;
}

export function setDayOffset(offset) {
  state.dayOffset = offset;
}

export async function loadMatches(opts = {}) {
  el.dateLabel.textContent = formatDateLabel(state.dayOffset);
  if (!opts.silent) saveViewState({ view: "matches", dayOffset: state.dayOffset });
  // 이 날짜를 이번 세션에 이미 한 번 그려봤으면(탭을 오가거나 재방문), 화면에 남겨둔 채 뒤에서
  // 조용히 새로 받아와서 갈아끼운다 - 매번 스켈레톤으로 비웠다 채우면 재방문할 때마다 로딩이 도는
  // 것처럼 느껴진다.
  const alreadyLoaded = state.loadedOffsets.has(state.dayOffset);
  if (!opts.silent && !alreadyLoaded) el.matchesList.innerHTML = skeletonList(5);
  ensureKLeagueRankMap(); // 백그라운드로 미리 채워둠(주요경기 우선순위 계산용) - 못 채워도 기존 정렬로 조용히 대체됨
  ensureCuratedCodes(); // 백그라운드 - 아래 fetch를 기다리게 하지 않는다(이유는 함수 선언부 주석 참고)
  try {
    const iso = toISODate(dateWithOffset(state.dayOffset));
    const data = await fetchJSON(`/matches?date=${iso}`);
    const matches = data.matches || [];
    state.lastMatches = matches;
    renderMatches(matches);
    state.loadedOffsets.add(state.dayOffset);
    if (!opts.silent && !alreadyLoaded) fadeIn(el.matchesList);
    startAutoRefresh();
  } catch (err) {
    if (!opts.silent && !alreadyLoaded) el.matchesList.innerHTML = `<div class="error-state">경기 정보를 불러오지 못했습니다.<br>${err.message}</div>`;
  }
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
// 사용자에게는 켜고 끄는 것만 노출하고(settings.js), 어떤 소리인지는 goal1로 고정한다.
const GOAL_SOUNDS = [
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

// 골이 감지되면 이 경기에서 내가 즐겨찾는 팀이 있는지부터 확인해서, 그 팀이 넣었는지(세리모니 애니메이션)
// 실점했는지(탄식 소리)를 가른다. 즐겨찾는 팀이 이 경기에 없으면(🔔로만 지켜보는 경기) 중립적으로 항상
// 세리모니를 보여준다.
function handleGoalDetected(match, side) {
  const scoringTeam = side === "home" ? match.homeTeam : match.awayTeam;
  const myTeamId = isFavorite(match.homeTeam.id) ? match.homeTeam.id : isFavorite(match.awayTeam.id) ? match.awayTeam.id : null;
  const conceded = myTeamId && scoringTeam.id !== myTeamId;

  if (conceded) {
    showConcedeToast(match, scoringTeam);
  } else {
    showGoalCelebration(match, scoringTeam);
  }
}

// 경기 목록 응답에는 득점자가 없어서(스코어만 옴), 세리모니에 이름을 띄우려고 상세를 한 번 더 불러온다.
// 실패해도(네트워크 등) 애니메이션 자체는 이름 없이 그대로 보여준다.
async function showGoalCelebration(match, scoringTeam) {
  playGoalSound();
  let scorerName = null;
  try {
    const detail = await fetchJSON(`/matches/${match.id}`);
    const teamGoals = (detail.goalEvents || []).filter((g) => g.teamId === scoringTeam.id);
    scorerName = teamGoals[teamGoals.length - 1]?.scorer || null;
  } catch {
    // 득점자 조회 실패 - 이름 없이 진행
  }
  renderGoalCelebration(match, scoringTeam, scorerName);
}

// 좌측 엠블럼+팀명 컬럼 / 우측 GOAL!·시간 헤더 + 득점자 컬럼 구조. 탭하면 그 경기 상세로 이동한다.
function renderGoalCelebration(match, scoringTeam, scorerName) {
  const minute = match.elapsed != null && match.elapsed !== "" ? `${match.elapsed}'` : "";
  const teamName = scoringTeam.shortName || scoringTeam.name;

  const wrap = document.createElement("div");
  wrap.className = "goal-banner-wrap";
  wrap.innerHTML = `
    <div class="goal-popup">
      <div class="goal-team-col">
        <div class="team-emblem-box">${crestImg(scoringTeam, "")}</div>
        <div class="goal-team-name">${teamName}</div>
      </div>
      <div class="goal-main-col">
        <div class="goal-header">
          <span class="goal-badge">⚽ GOAL!</span>
          ${minute ? `<span class="goal-time">${minute} ⚽</span>` : ""}
        </div>
        <div class="goal-scorer">${scorerName || teamName}</div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  requestAnimationFrame(() => wrap.classList.add("show"));
  wrap.addEventListener("click", () => {
    dismissCelebration(wrap);
    loadMatchDetail(match.id, match);
  });
  setTimeout(() => dismissCelebration(wrap), 4200);
}

function dismissCelebration(wrap) {
  if (!wrap.isConnected) return;
  wrap.classList.remove("show");
  setTimeout(() => wrap.remove(), 500);
}

function showConcedeToast(match, scoringTeam) {
  const home = match.score.fullTime.home;
  const away = match.score.fullTime.away;
  if (getGoalSound() !== "none") playConcedeSound();
  showSimpleToast({
    icon: "😩",
    title: "실점 ㅠㅠ",
    body: `${scoringTeam.shortName || scoringTeam.name} 득점 · ${match.homeTeam.shortName || match.homeTeam.name} ${home} - ${away} ${match.awayTeam.shortName || match.awayTeam.name}`,
    silent: true,
  });
}

// 실제 음원 파일이 있으면 그걸 우선 재생하고, 없거나(404) 재생에 실패하면 합성음(fallbackFn)으로
// 조용히 대체한다 - 나중에 파일만 추가/교체하면 코드 변경 없이 바로 실제 음원으로 바뀐다.
function playFileWithFallback(path, fallbackFn, volume = 0.8) {
  try {
    const audio = new Audio(path);
    audio.volume = volume;
    let usedFallback = false;
    const fallback = () => {
      if (usedFallback) return;
      usedFallback = true;
      fallbackFn();
    };
    audio.addEventListener("error", fallback, { once: true });
    audio.play().catch(fallback);
  } catch {
    fallbackFn();
  }
}

function playConcedeSound() {
  playFileWithFallback("/sounds/conced.mp3", playConcedeGroan);
}

function playLineupChime() {
  playFileWithFallback("/sounds/lineup.mp3", playDingDong);
}

// 초인종 "띵동" - 위 음(높은 종) 하나, 살짝 뒤에 아래 음(낮은 종) 하나를 겹쳐서 내림 진행으로 낸다.
function playDingDong() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    tone(ctx, { freq: 987, start: 0, duration: 0.5, type: "sine", gain: 0.26 });
    tone(ctx, { freq: 740, start: 0.32, duration: 0.6, type: "sine", gain: 0.24 });
  } catch {
    // Web Audio 미지원/차단 상태면 조용히 무시
  }
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

// 관중 탄식 소리에 해당하는 실제 녹음 파일이 없어서(구할 방법이 없어 합성으로 대체), 두 개의 톱니파를
// 살짝 어긋난 타이밍에 아래로 떨어뜨려 "아유..." 하고 힘 빠지는 느낌의 합성음으로 대신한다.
// 화이트노이즈를 저음역대로 스윕하는 필터에 통과시켜 "우~" 하는 관중 웅성거림 텍스처를 만들고,
// 그 위에 서로 살짝 어긋나게 튜닝한 목소리 톤 여러 개를 얹어 "여러 사람이 동시에 탄식하는" 두께를
// 더한다(실제 관중 소리 녹음을 구할 방법이 없어 Web Audio로 합성한 근사치).
function playConcedeGroan() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const duration = 1.3;
    const now = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.5, now + 0.08);
    master.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    master.connect(ctx.destination);

    // 관중 웅성거림 노이즈: 화이트노이즈 -> 대역통과 필터 주파수를 위에서 아래로 스윕
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.Q.value = 0.7;
    noiseFilter.frequency.setValueAtTime(1100, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(220, now + duration);

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.9;

    noise.connect(noiseFilter).connect(noiseGain).connect(master);
    noise.start(now);
    noise.stop(now + duration);

    // "아~" 하고 힘 빠지는 목소리 성분 - 서로 살짝 어긋난 3개 음을 겹쳐서 여러 명이 동시에 내는 소리처럼.
    [220, 233, 208].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.55, now + duration);
      const voiceGain = ctx.createGain();
      voiceGain.gain.value = 0.12 - i * 0.02;
      osc.connect(voiceGain).connect(master);
      osc.start(now + i * 0.03);
      osc.stop(now + duration);
    });
  } catch {
    // Web Audio 미지원/차단 상태면 조용히 무시
  }
}

function showSimpleToast({ icon, title, body, soundFile, silent = false }) {
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
  if (!silent && getGoalSound() !== "none") {
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
  if (getGoalSound() !== "none") playLineupChime();
  showSimpleToast({
    icon: "🏟️",
    title: "라인업 발표",
    body: `${m.homeTeam.shortName || m.homeTeam.name} vs ${m.awayTeam.shortName || m.awayTeam.name} 라인업이 발표됐습니다.`,
    silent: true,
  });
}

// 경기 시작/전반전 종료 모두 경기 종료(showFinishedToast)와 같은 효과음(end.mp3)을 그대로 쓴다.
function showKickoffToast(m) {
  showSimpleToast({
    icon: "⏱",
    title: "경기 시작",
    body: `${m.homeTeam.shortName || m.homeTeam.name} vs ${m.awayTeam.shortName || m.awayTeam.name} 킥오프!`,
    soundFile: "/sounds/end.mp3",
  });
}

function showHalftimeToast(m) {
  const home = m.score.fullTime.home;
  const away = m.score.fullTime.away;
  showSimpleToast({
    icon: "🟨",
    title: "전반전 종료",
    body: `${m.homeTeam.shortName || m.homeTeam.name} ${home} - ${away} ${m.awayTeam.shortName || m.awayTeam.name}`,
    soundFile: "/sounds/end.mp3",
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
  ["CL", "EC", "ACL"], // 대륙간컵대회
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

// K리그 라이브 경기끼리 우선순위를 매길 때 쓸 순위표(팀 id -> 순위). 사용자 요청(2026-08-08) - 같은
// 시간에 여러 K리그 경기가 진행 중이면 상위권 팀들의 맞대결을 주요 경기로 우선 보여준다. 순위는 하루에
// 몇 번 안 바뀌는 데이터라 세션당 한 번만 불러와 메모이즈하고, 아직 안 채워졌으면(첫 로딩 등) 그냥
// 기존 정렬(대회 다음 킥오프 시각순)로 조용히 넘어간다.
let kleagueRankMap = null;
let kleagueRankMapPromise = null;

function ensureKLeagueRankMap() {
  if (kleagueRankMap || kleagueRankMapPromise) return;
  kleagueRankMapPromise = Promise.all([fetchJSON("/standings/KL1").catch(() => null), fetchJSON("/standings/KL2").catch(() => null)]).then(
    ([kl1, kl2]) => {
      const map = new Map();
      [kl1, kl2].forEach((data) => {
        (data?.standings || []).forEach((table) => {
          (table.table || []).forEach((row) => map.set(String(row.team.id), row.position));
        });
      });
      kleagueRankMap = map;
    }
  );
}

// 두 팀 순위의 평균(낮을수록 상위권). 순위표에 없는 팀이 있으면(외국 리그 등) null.
function teamRankScore(m) {
  if (!kleagueRankMap) return null;
  const h = kleagueRankMap.get(String(m.homeTeam.id));
  const a = kleagueRankMap.get(String(m.awayTeam.id));
  if (h == null || a == null) return null;
  return (h + a) / 2;
}

// 경기 목록 화면의 대회 그룹 정렬 우선순위: K리그(1~4부) -> 챔피언스리그 -> 세계 5대리그 -> 컵대회(월드컵/유로/코리아컵),
// 그 외 대회는 기존 순서(패치 순) 그대로, 친선경기(FRIENDLY)는 별도 규칙으로 항상 맨 아래.
const MATCH_LIST_TIERS = [
  ["KL1", "KL2", "K3", "K4"],
  ["CL", "ACL"],
  ["PL", "PD", "BL1", "SA", "FL1"],
  ["WC", "EC", "KFA"],
];

function matchListRank(code) {
  const idx = MATCH_LIST_TIERS.findIndex((tier) => tier.includes(code));
  return idx === -1 ? MATCH_LIST_TIERS.length : idx;
}

function pickFeaturedMatch(matches) {
  // 내가 팔로우(즐겨찾기)한 팀의 경기가 있으면 무조건 최우선 - 예전엔 "라이브 경기가 하나라도 있으면
  // 라이브 경기 중에서만" 골랐었는데, 그러면 내 팀 경기가 아직 킥오프 전이고 다른 경기가 먼저 라이브면
  // 내 팀 경기가 아예 후보에서 밀려났다(사용자 요청, 2026-08-08).
  const followedMatches = matches.filter(isFollowedMatch);
  if (followedMatches.length) {
    const liveFollowed = followedMatches.filter((m) => LIVE_STATUSES.has(m.status));
    const pool = liveFollowed.length ? liveFollowed : followedMatches;
    return pool.slice().sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))[0];
  }

  const liveMatches = matches.filter((m) => LIVE_STATUSES.has(m.status));
  const pool = liveMatches.length ? liveMatches : matches;
  const isLivePool = liveMatches.length > 0;

  return pool
    .slice()
    .sort((a, b) => {
      const rankDiff = competitionRank(a.competition.code) - competitionRank(b.competition.code);
      if (rankDiff !== 0) return rankDiff;
      // 같은 티어의 라이브 K리그 경기끼리는 순위표상 더 상위권 팀들의 맞대결을 우선한다.
      if (isLivePool && a.competition.code === b.competition.code && (a.competition.code === "KL1" || a.competition.code === "KL2")) {
        const scoreA = teamRankScore(a);
        const scoreB = teamRankScore(b);
        if (scoreA != null && scoreB != null && scoreA !== scoreB) return scoreA - scoreB;
      }
      return new Date(a.utcDate) - new Date(b.utcDate);
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

  // 코드에 없는(=/competitions에 없는) 변방 리그는 기본적으로 접어서 숨긴다 - 단, 즐겨찾기한 팀이나
  // 🔔로 개별 지정한 경기가 그 리그에 있으면 사용자가 실제로 원해서 보는 경기이니 숨기지 않는다.
  // curatedCodes가 아직 안 왔으면(null, 최초 프리페치 실패 등) 필터링 없이 예전처럼 전부 보여준다.
  // "다른 리그 보기" 패널은 선택을 껐다 켰다 할 수 있어야 하므로, 변방 리그는 선택 여부와 무관하게
  // 전부 pickerCandidates에 넣어두고(체크박스 상태만 선택 여부를 반영), 실제 목록에 보일지는
  // visibleGroups에서 따로 판단한다.
  const alwaysShow = (m) => isFavorite(m.homeTeam.id) || isFavorite(m.awayTeam.id) || isWatched(m.id);
  const pickerCandidates = [];
  const visibleGroups = [];
  for (const group of groups.values()) {
    const isCurated = !curatedCodes || curatedCodes.has(group.info.code);
    if (isCurated) {
      visibleGroups.push(group);
      continue;
    }
    pickerCandidates.push(group);
    if (state.extraLeagueCodes.has(group.info.code) || group.matches.some(alwaysShow)) {
      visibleGroups.push(group);
    }
  }

  // 친선경기는 대회가 아니라 부가적인 목록이라 순서와 상관없이 항상 맨 아래, 그 위로는
  // K리그 -> 챔스 -> 5대리그 -> 컵대회 순으로 그룹을 재배열한다(Array.sort는 안정 정렬이라
  // 같은 우선순위 안에서는 기존 순서를 유지한다).
  const orderedGroups = visibleGroups.sort((a, b) => {
    const aFriendly = a.info.code === "FRIENDLY" ? 1 : 0;
    const bFriendly = b.info.code === "FRIENDLY" ? 1 : 0;
    if (aFriendly !== bFriendly) return aFriendly - bFriendly;
    return matchListRank(a.info.code) - matchListRank(b.info.code);
  });

  orderedGroups.forEach((group) => {
    const groupEl = document.createElement("div");
    groupEl.className = "competition-group";

    const header = document.createElement("div");
    header.className = "competition-header";
    // 헤더 대부분(엠블럼+이름)을 누르면 그 리그 순위로 넘어가고, 화살표만 따로 눌러야 목록을
    // 접었다 펼 수 있게 나눴다(둘 다 같은 영역이면 "순위 보기"와 "접기"가 서로 충돌함).
    header.innerHTML = `<span class="competition-header-link">${emblemImg(group.info, "competition-emblem")}<span class="competition-header-name">${group.info.name}</span></span><span class="competition-header-count">${group.matches.length}</span><span class="competition-header-arrow">▾</span>`;
    groupEl.appendChild(header);

    const body = document.createElement("div");
    body.className = "competition-body";
    group.matches
      .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
      .forEach((m) => body.appendChild(renderMatchRow(m)));
    groupEl.appendChild(body);

    header.querySelector(".competition-header-link").addEventListener("click", () => openLeagueStandings(group.info.code));

    // 화살표를 눌러서 그 안의 경기 목록을 접었다 펼 수 있게(리그 많은 날 스크롤 부담을 줄임).
    header.querySelector(".competition-header-arrow").addEventListener("click", (e) => {
      e.stopPropagation();
      const collapsed = groupEl.classList.toggle("collapsed");
      body.style.display = collapsed ? "none" : "";
    });

    el.matchesList.appendChild(groupEl);
  });

  if (pickerCandidates.length) el.matchesList.appendChild(renderLeaguePicker(pickerCandidates));
}

// 코드에 없는(변방) 리그 중 오늘 실제로 경기가 있는 것만 후보로 모아 "다른 리그 보기"에 체크박스로
// 보여준다 - 이미 선택해서 목록에 보이는 리그도 여기 그대로 남겨둬서 체크를 풀어 다시 숨길 수 있다.
function renderLeaguePicker(pickerCandidates) {
  const wrap = document.createElement("div");
  wrap.className = "league-picker";

  const toggle = document.createElement("button");
  toggle.className = `league-picker-toggle ${state.pickerOpen ? "open" : ""}`;
  toggle.innerHTML = `<span>+ 다른 리그 보기</span><span class="league-group-count">${pickerCandidates.length}</span><span class="league-group-toggle-arrow">▾</span>`;
  toggle.addEventListener("click", () => {
    state.pickerOpen = !state.pickerOpen;
    if (state.lastMatches) renderMatches(state.lastMatches);
  });
  wrap.appendChild(toggle);

  if (state.pickerOpen) {
    const body = document.createElement("div");
    body.className = "league-picker-body";
    pickerCandidates
      .slice()
      .sort((a, b) => b.matches.length - a.matches.length)
      .forEach((group) => {
        const checked = state.extraLeagueCodes.has(group.info.code);
        const row = document.createElement("label");
        row.className = "league-picker-row";
        row.innerHTML = `<input type="checkbox" data-league-code="${group.info.code}" ${checked ? "checked" : ""} />${emblemImg(group.info, "league-row-emblem")}<span class="league-row-name">${group.info.name}</span><span class="league-group-count">${group.matches.length}</span>`;
        body.appendChild(row);
      });
    wrap.appendChild(body);

    body.querySelectorAll("[data-league-code]").forEach((checkbox) => {
      checkbox.addEventListener("change", (e) => {
        const code = e.target.dataset.leagueCode;
        if (e.target.checked) state.extraLeagueCodes.add(code);
        else state.extraLeagueCodes.delete(code);
        saveExtraLeagueCodes();
        if (state.lastMatches) renderMatches(state.lastMatches);
      });
    });
  }

  return wrap;
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

  // dataStale: 킥오프 후 넉넉한 경기 지속시간이 지나도록 여전히 IN_PLAY/PAUSED면 크론 갱신이
  // 멈춘 것(API 쿼터 소진 등) - "지금도 라이브"라고 착각하게 두지 않고 지연 안내로 대체한다.
  const isLive = LIVE_STATUSES.has(m.status) && !m.dataStale;
  const isFinished = m.status === "FINISHED";
  const home = m.score.fullTime.home;
  const away = m.score.fullTime.away;
  const hasScore = home !== null && home !== undefined;
  card.classList.toggle("is-live", isLive);

  const statusText = m.dataStale
    ? "업데이트 지연"
    : isLive
    ? liveMinuteLabel(m.status, getDisplayElapsed(m.id, m.elapsed))
    : isFinished
    ? "종료"
    : m.status === "TIME_TBD"
    ? STATUS_KO.TIME_TBD
    : formatKickoff(m.utcDate);
  const statusClass = m.dataStale ? "stale" : isLive ? "live" : isFinished ? "finished" : "scheduled";

  card.innerHTML = `
    <div class="hero-match-top">
      <div class="hero-match-top-info">
        ${emblemImg(m.competition, "hero-match-comp-emblem")}
        <span class="hero-match-comp-name">${m.competition.name}</span>
      </div>
      <div class="match-row-actions">
        ${watchBellHtml(m.id)}
      </div>
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

  const isLive = LIVE_STATUSES.has(m.status) && !m.dataStale;
  const isFinished = m.status === "FINISHED";
  const home = m.score.fullTime.home;
  const away = m.score.fullTime.away;
  const hasScore = home !== null && home !== undefined;
  row.classList.toggle("is-live", isLive);

  let statusHtml;
  if (m.dataStale) {
    statusHtml = `<div class="match-status stale" title="실시간 정보 갱신이 지연되고 있습니다">⏱ 지연</div>`;
  } else if (isLive) {
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

// "매치 도미넌스" - API가 이 지표를 그대로 주진 않아서, 이미 갖고 있는 스탯(점유율/슈팅/유효슈팅/
// xG/코너킥)의 홈-원정 비율을 가중 평균해 "누가 경기를 지배했는지"를 하나의 막대로 압축해 보여준다.
// 슈팅/xG처럼 실제 득점 기회에 가까운 지표에 점유율보다 더 큰 비중을 둔다(단순 볼 소유보다 위협적인
// 공격 지표가 "지배력"에 가깝다는 통념을 반영).
const DOMINANCE_WEIGHTS = [
  ["possession", 0.2],
  ["shotsTotal", 0.15],
  ["shotsOnGoal", 0.2],
  ["xg", 0.3],
  ["corners", 0.15],
];

function computeDominance(statsHome, statsAway) {
  let weightedSum = 0;
  let weightTotal = 0;
  for (const [key, weight] of DOMINANCE_WEIGHTS) {
    const h = parseFloat(statsHome[key]) || 0;
    const a = parseFloat(statsAway[key]) || 0;
    const total = h + a;
    if (!total) continue;
    weightedSum += (h / total) * weight;
    weightTotal += weight;
  }
  if (!weightTotal) return null;
  const home = Math.round((weightedSum / weightTotal) * 100);
  return { home, away: 100 - home };
}

// 시간대별 도미넌스 구간 - API가 분 단위 슈팅/점유율 추이를 안 줘서(있는 건 경기 전체 누적 스탯뿐)
// 매 구간을 처음부터 다시 계산할 순 없다. 대신 "전체 도미넌스 비율"을 각 구간의 기본값으로 깔아두고,
// 그 구간 안에서 실제로 있었던 골/카드 이벤트(둘 다 분 단위 타임스탬프가 이미 있음)만큼 그 구간의
// 비율을 밀어준다 - 데이터가 없는 구간은 억지로 굴곡을 만들지 않고 "전체 평균과 비슷했다"로 남긴다.
// mid는 그래프 x축에 그 구간을 대표하는 점을 찍을 위치(분).
const DOMINANCE_SEGMENTS = [
  { label: "1-15'", start: 1, end: 15, mid: 8 },
  { label: "16-30'", start: 16, end: 30, mid: 23 },
  { label: "31-45'", start: 31, end: 45, mid: 38 },
  { label: "46-60'", start: 46, end: 60, mid: 53 },
  { label: "61-75'", start: 61, end: 75, mid: 68 },
  { label: "76-90'+", start: 76, end: 999, mid: 83 },
];
const DOMINANCE_MATCH_END_MINUTE = 96; // 추가시간까지 감안해 넉넉히 잡은 그래프 x축 끝
const GOAL_SWING = 22; // 골 하나가 그 구간 도미넌스에 주는 영향
const RED_CARD_SWING = 12;
const YELLOW_CARD_SWING = 4;

function eventMinute(ev) {
  return parseInt(ev.minute, 10) || 0;
}

function segmentEvents(events, segment) {
  return (events || []).filter((ev) => {
    const minute = eventMinute(ev);
    return minute >= segment.start && minute <= segment.end;
  });
}

function computeSegmentDominance(baseHomePct, segment, homeTeamId, goalEvents, cardEvents) {
  const goalSwing = segmentEvents(goalEvents, segment).reduce((sum, g) => sum + (g.teamId === homeTeamId ? GOAL_SWING : -GOAL_SWING), 0);
  const cardSwing = segmentEvents(cardEvents, segment).reduce((sum, c) => {
    const weight = c.red ? RED_CARD_SWING : YELLOW_CARD_SWING;
    // 카드를 받은 팀이 불리해지니, 상대 팀 쪽 도미넌스가 올라간다.
    return sum + (c.teamId === homeTeamId ? -weight : weight);
  }, 0);
  const home = Math.round(Math.min(92, Math.max(8, baseHomePct + goalSwing + cardSwing)));
  return { home, away: 100 - home };
}

// ---- 팀 색상을 차트에서 잘 보이는 명도/채도로 보정 ----
// 저지 색을 그대로 쓰면 너무 어둡거나(예: 진초록 유니폼) 채도가 낮아 차트 배경 위에서 거의 안 보이고,
// 색약 사용자에게는 구분이 더 어려워지는 경우가 많다. 색상(hue)은 유지한 채 명도/채도만 다크/라이트
// 배경 각각에서 잘 읽히는 범위로 당겨온다(dataviz 스킬의 validate_palette.js로 실측 확인한 범위).
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255,
    g = parseInt(hex.slice(3, 5), 16) / 255,
    b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h,
    s,
    l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  h /= 360;
  s /= 100;
  l /= 100;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function chartSafeColor(hex, theme) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const [h, s, l] = hexToHsl(hex);
  const targetL = theme === "light" ? clampNum(l, 34, 46) : clampNum(l, 46, 60);
  const targetS = clampNum(Math.max(s, 45), 45, 90);
  return hslToHex(h, targetS, targetL);
}

// 이번 경기 라인업에 실린 실제 유니폼 색(renderPitch의 피치 틴트와 같은 소스)을 우선 쓰고, 라인업이
// 아직 없으면(킥오프 전, 라인업 미제공 대회) 앱 기본 홈/원정 색으로 대체한다.
function dominanceTeamColors(m) {
  const home = m.lineups?.find((l) => l.teamId === m.homeTeam.id);
  const away = m.lineups?.find((l) => l.teamId === m.awayTeam.id);
  const theme = getTheme();
  return {
    home: chartSafeColor(home?.colors?.player, theme) || "var(--accent)",
    away: chartSafeColor(away?.colors?.player, theme) || "var(--accent-2)",
  };
}

const DOMINANCE_CHART_W = 620;
const DOMINANCE_BASELINE_Y = 110;
const DOMINANCE_AMPLITUDE = 1.6;
const DOMINANCE_EVENT_ICON = { goal: "⚽", yellow: "🟨", red: "🟥" };

function dominanceX(minute) {
  return (minute / DOMINANCE_MATCH_END_MINUTE) * DOMINANCE_CHART_W;
}
function dominanceY(pct) {
  return DOMINANCE_BASELINE_Y - (pct - 50) * DOMINANCE_AMPLITUDE;
}

// 시간대별 흐름 그래프 - 기준선(50%) 위는 홈 우세, 아래는 원정 우세. 각 구간 값 사이를 직선으로
// 이어서 "그래프"로 보이게 하되, 실제로는 여전히 6개 구간 표본이라는 걸 숨기지 않도록(가짜 매끈한
// 곡선 대신) 있는 그대로의 꺾은선만 그린다. 골/카드 아이콘은 구간 중앙이 아니라 실제 발생 분에
// 정확히 찍는다.
function renderDominanceChart(m, baseDominance, colors) {
  if (!m.goalEvents?.length && !m.cardEvents?.length) return "";
  const homeTeamId = m.homeTeam.id;
  const homeName = m.homeTeam.shortName || m.homeTeam.name;
  const awayName = m.awayTeam.shortName || m.awayTeam.name;

  const series = DOMINANCE_SEGMENTS.map((segment) => ({
    ...segment,
    ...computeSegmentDominance(baseDominance.home, segment, homeTeamId, m.goalEvents, m.cardEvents),
  }));

  const points = [
    { x: 0, y: dominanceY(series[0].home) },
    ...series.map((s) => ({ x: dominanceX(s.mid), y: dominanceY(s.home) })),
    { x: DOMINANCE_CHART_W, y: dominanceY(series[series.length - 1].home) },
  ];
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${DOMINANCE_CHART_W},${DOMINANCE_BASELINE_Y} L0,${DOMINANCE_BASELINE_Y} Z`;

  const gridlines = [0, 15, 30, 45, 60, 75, 90]
    .map((min) => `<line class="dominance-gridline" x1="${dominanceX(min).toFixed(1)}" x2="${dominanceX(min).toFixed(1)}" y1="6" y2="200" />`)
    .join("");
  const axisLabels = [0, 15, 30, 45, 60, 75, 90]
    .map((min) => {
      const x = dominanceX(min).toFixed(1);
      const label = min === 45 ? "HT" : min === 0 ? "0'" : `${min}'`;
      return `<text class="${min === 45 ? "dominance-ht-label" : "dominance-axis-label"}" x="${x}" y="216" text-anchor="middle">${label}</text>`;
    })
    .join("");

  const events = [
    ...(m.goalEvents || []).map((g) => ({ minute: eventMinute(g), teamId: g.teamId, icon: DOMINANCE_EVENT_ICON.goal, title: `${g.scorer} ${g.minute}'` })),
    ...(m.cardEvents || []).map((c) => ({
      minute: eventMinute(c),
      teamId: c.teamId,
      icon: c.red ? DOMINANCE_EVENT_ICON.red : DOMINANCE_EVENT_ICON.yellow,
      title: `${c.player} ${c.minute}'`,
    })),
  ];
  const eventIconsHtml = events
    .map((ev) => {
      const x = dominanceX(ev.minute).toFixed(1);
      const y = ev.teamId === homeTeamId ? 18 : 202;
      return `<text class="dominance-event-icon" x="${x}" y="${y}" text-anchor="middle">${ev.icon}</text>`;
    })
    .join("");

  // JSON을 <script> 태그 안에 그대로 넣을 거라, 선수 이름 등에 "</script"가 우연히 들어있어도 태그가
  // 조기 종료되지 않도록 "<"를 이스케이프해둔다.
  const dataPayload = JSON.stringify({ series, events, homeName, awayName, colors }).replace(/</g, "\\u003c");

  return `
    <div class="dominance-timeline">
      <div class="dominance-timeline-title">시간대별 흐름</div>
      <div class="legend">
        <span class="legend-item">${crestImg(m.homeTeam, "dominance-legend-crest")}<span class="legend-line" style="background:${colors.home}"></span>${homeName}</span>
        <span class="legend-item">${crestImg(m.awayTeam, "dominance-legend-crest")}<span class="legend-line" style="background:${colors.away}"></span>${awayName}</span>
      </div>
      <div class="dominance-chart-wrap" data-dominance-chart>
        <script type="application/json" data-dominance-data>${dataPayload}<\/script>
        <svg viewBox="0 0 ${DOMINANCE_CHART_W} 230" class="dominance-svg" preserveAspectRatio="none">
          <defs>
            <clipPath id="dominanceClipAbove-${m.id}"><rect x="0" y="0" width="${DOMINANCE_CHART_W}" height="${DOMINANCE_BASELINE_Y}" /></clipPath>
            <clipPath id="dominanceClipBelow-${m.id}"><rect x="0" y="${DOMINANCE_BASELINE_Y}" width="${DOMINANCE_CHART_W}" height="120" /></clipPath>
          </defs>
          ${gridlines}
          <line class="dominance-baseline" x1="0" y1="${DOMINANCE_BASELINE_Y}" x2="${DOMINANCE_CHART_W}" y2="${DOMINANCE_BASELINE_Y}" />
          <path d="${areaPath}" fill="${colors.home}" opacity="0.14" clip-path="url(#dominanceClipAbove-${m.id})" />
          <path d="${areaPath}" fill="${colors.away}" opacity="0.14" clip-path="url(#dominanceClipBelow-${m.id})" />
          <path d="${linePath}" fill="none" stroke="${colors.home}" stroke-width="2" stroke-linejoin="round" clip-path="url(#dominanceClipAbove-${m.id})" />
          <path d="${linePath}" fill="none" stroke="${colors.away}" stroke-width="2" stroke-linejoin="round" clip-path="url(#dominanceClipBelow-${m.id})" />
          ${eventIconsHtml}
          ${axisLabels}
          <line class="dominance-crosshair" x1="0" y1="10" x2="0" y2="200" data-dominance-crosshair />
          <circle class="dominance-hover-dot" style="fill:${colors.home}" data-dominance-dot r="4" />
          <rect x="0" y="0" width="${DOMINANCE_CHART_W}" height="230" fill="transparent" data-dominance-hitrect />
        </svg>
        <div class="dominance-tooltip" data-dominance-tooltip></div>
      </div>
      <div class="foot-note dominance-foot-note">기준선 위는 ${homeName} 우세, 아래는 ${awayName} 우세 - 그래프 위에 손가락/마우스를 올리면 구간별 수치가 나옵니다.</div>
    </div>
  `;
}

// 차트 렌더링 이후(renderMatchDetail의 DOM 삽입 뒤) 호출 - 호버 시 크로스헤어/점/툴팁을 갱신한다.
function wireDominanceChart(wrap) {
  const dataEl = wrap.querySelector("[data-dominance-data]");
  const svg = wrap.querySelector(".dominance-svg");
  const hitRect = wrap.querySelector("[data-dominance-hitrect]");
  const crosshair = wrap.querySelector("[data-dominance-crosshair]");
  const dot = wrap.querySelector("[data-dominance-dot]");
  const tooltip = wrap.querySelector("[data-dominance-tooltip]");
  if (!dataEl || !svg || !hitRect || !crosshair || !dot || !tooltip) return;

  let data;
  try {
    data = JSON.parse(dataEl.textContent);
  } catch {
    return;
  }

  function nearestSegment(minute) {
    let best = data.series[0];
    let bestDist = Infinity;
    for (const s of data.series) {
      const d = Math.abs(s.mid - minute);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    }
    return best;
  }

  function showAt(clientX) {
    const rect = svg.getBoundingClientRect();
    const relX = ((clientX - rect.left) / rect.width) * DOMINANCE_CHART_W;
    const minute = clampNum((relX / DOMINANCE_CHART_W) * DOMINANCE_MATCH_END_MINUTE, 0, DOMINANCE_MATCH_END_MINUTE);
    const seg = nearestSegment(minute);
    const x = dominanceX(seg.mid);
    const y = dominanceY(seg.home);

    crosshair.setAttribute("x1", x);
    crosshair.setAttribute("x2", x);
    crosshair.style.opacity = 1;
    dot.setAttribute("cx", x);
    dot.setAttribute("cy", y);
    dot.style.opacity = 1;

    const evs = data.events.filter((e) => e.minute >= seg.start && e.minute <= seg.end);
    const evHtml = evs.length ? `<div class="dominance-tooltip-events">${evs.map((e) => `${e.icon} ${e.title}`).join(" · ")}</div>` : "";
    tooltip.innerHTML = `<strong>${seg.label}</strong><br><span style="color:${data.colors.home};font-weight:700">${data.homeName} ${seg.home}%</span> · <span style="color:${data.colors.away};font-weight:700">${data.awayName} ${seg.away}%</span>${evHtml}`;
    tooltip.style.opacity = 1;
    const leftPct = (x / DOMINANCE_CHART_W) * 100;
    tooltip.style.left = `clamp(0px, ${leftPct}% - 60px, calc(100% - 190px))`;
  }
  function hide() {
    crosshair.style.opacity = 0;
    dot.style.opacity = 0;
    tooltip.style.opacity = 0;
  }
  hitRect.addEventListener("pointermove", (e) => showAt(e.clientX));
  hitRect.addEventListener("pointerleave", hide);
  hitRect.addEventListener("touchstart", (e) => showAt(e.touches[0].clientX), { passive: true });
}

function renderDominance(m, statsHome, statsAway) {
  const dominance = computeDominance(statsHome, statsAway);
  if (!dominance) return "";
  const homeName = m.homeTeam.shortName || m.homeTeam.name;
  const awayName = m.awayTeam.shortName || m.awayTeam.name;
  const colors = dominanceTeamColors(m);
  return `
    <div class="dominance-section">
      <div class="dominance-title">매치 도미넌스</div>
      <div class="dominance-bar">
        <div class="dominance-fill" style="width:${dominance.home}%;background:${colors.home}"></div>
        <div class="dominance-fill" style="width:${dominance.away}%;background:${colors.away}"></div>
      </div>
      <div class="dominance-labels">
        <span class="dominance-label" style="color:${colors.home}">${homeName} ${dominance.home}%</span>
        <span class="dominance-label" style="color:${colors.away}">${dominance.away}% ${awayName}</span>
      </div>
      ${renderDominanceChart(m, dominance, colors)}
    </div>
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
  return `<div class="team-section"><h3 class="team-section-title">경기 스탯</h3>${rows}${renderDominance(m, statsHome, statsAway)}</div>`;
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

// 골 이벤트엔 선수 id가 없어(API-Football 이벤트 응답 자체가 이름만 줌, adapters/apiFootballAdapter.js
// normalizeGoalEvents 참고) 이름으로 대조한다 - 같은 경기 안에서 라인업과 골 이벤트가 같은 소스(API-Football
// 또는 KFA 스크랩 하나)에서 나오므로 이름 표기가 서로 어긋날 일은 없다. 자책골은 상대팀 골이라 득점
// 표시에서 제외한다(scorer 이름은 자책골 넣은 선수 본인이라 헷갈릴 수 있어서).
function playerGoalAssistCounts(playerName, goalEvents) {
  if (!playerName || !goalEvents?.length) return { goals: 0, assists: 0 };
  const goals = goalEvents.filter((g) => g.scorer === playerName && !g.ownGoal).length;
  const assists = goalEvents.filter((g) => g.assist === playerName).length;
  return { goals, assists };
}

function playerEventBadgesHtml(playerName, goalEvents) {
  const { goals, assists } = playerGoalAssistCounts(playerName, goalEvents);
  if (!goals && !assists) return "";
  const goalHtml = goals ? `<span class="lineup-event-icon goal" title="골 ${goals}개">⚽${goals > 1 ? `×${goals}` : ""}</span>` : "";
  const assistHtml = assists ? `<span class="lineup-event-icon assist" title="어시스트 ${assists}개">👟${assists > 1 ? `×${assists}` : ""}</span>` : "";
  return `<span class="lineup-event-badges">${goalHtml}${assistHtml}</span>`;
}

function pitchPlayerDot(p, x, y, ringColor, teamId, goalEvents) {
  const lastName = p.name.split(" ").slice(-1)[0];
  const ratingHtml =
    typeof p.rating === "number"
      ? `<div class="pitch-rating ${ratingClass(p.rating)}">${p.rating.toFixed(1)}</div>`
      : "";
  const subOffHtml = p.subbedOffMinute ? `<div class="pitch-sub-off">${p.subbedOffMinute}'</div>` : "";
  // 골/평점/교체시간이 사진 테두리 네 귀퉁이 중 위쪽 두 곳(평점=우상, 교체시간=좌상)을 이미 쓰고
  // 있어서, 골/어시스트 배지는 아래쪽(좌하)에 겹치지 않게 배치한다.
  const { goals, assists } = playerGoalAssistCounts(p.name, goalEvents);
  const eventBadgeHtml =
    goals || assists
      ? `<div class="pitch-event-badge" title="${goals ? `골 ${goals}개 ` : ""}${assists ? `어시스트 ${assists}개` : ""}">${goals ? "⚽" : ""}${assists ? "👟" : ""}</div>`
      : "";
  return `
    <div class="pitch-player-abs" style="left:${x}%; top:${y}%;">
      <div class="pitch-photo-wrap">
        ${subOffHtml}
        <div class="pitch-photo-ring" style="border-color:${ringColor};" data-player-id="${p.id}">
          ${playerAvatarImg(p, teamId, "pitch-photo")}
        </div>
        ${ratingHtml}
        ${eventBadgeHtml}
      </div>
      <div class="pitch-player-name">${lastName}</div>
    </div>
  `;
}

// isHome이면 자기 골문(하단)에서 하프라인 쪽(위)으로, 원정이면 자기 골문(상단)에서 하프라인 쪽(아래)으로.
function renderSidePlayers(startXI, isHome, jerseyColor, gkColor, teamId, goalEvents) {
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
      dots.push(pitchPlayerDot(p, x, y, color, teamId, goalEvents));
    });
  });

  return dots.join("");
}

function benchColumn(lineup, side, goalEvents) {
  const avgAge = lineup ? averageAge(lineup.startXI) : null;
  const subs = lineup?.substitutes || [];
  return `
    <div class="pitch-bench-col ${side}">
      ${
        subs.length
          ? subs
              .map((p) => `<div class="pitch-bench-player" data-player-id="${p.id}">${p.number ?? ""} ${p.name}${playerEventBadgesHtml(p.name, goalEvents)}</div>`)
              .join("")
          : '<div class="empty-state">교체 명단 없음</div>'
      }
      <div class="pitch-side-footer">
        ${avgAge ? `<div class="pitch-stat"><b>${avgAge}세</b><span>평균 나이</span></div>` : ""}
        ${lineup?.coach ? `<div class="pitch-stat"><b>${lineup.coach}</b><span>감독</span></div>` : ""}
      </div>
    </div>
  `;
}

function renderPitch(home, away, homeTeam, awayTeam, goalEvents) {
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
      ${home ? renderSidePlayers(home.startXI, true, home.colors?.player, home.colors?.goalkeeper, homeTeam?.id, goalEvents) : ""}
      ${away ? renderSidePlayers(away.startXI, false, away.colors?.player, away.colors?.goalkeeper, awayTeam?.id, goalEvents) : ""}
    </div>
    <div class="pitch-bench-row">
      ${benchColumn(home, "home", goalEvents)}
      ${benchColumn(away, "away", goalEvents)}
    </div>
  `;
}

const POSITION_ORDER = { GK: 0, DF: 1, MF: 2, FW: 3 };

// kleague.com 폴백 라인업은 API-Football처럼 grid(row:col) 좌표가 없어서(pitchPosition은 있지만
// 좌표계가 달라 기존 세로 피치 UI로 바로 변환하기 어렵다), 피치 다이어그램 대신 포지션별로 묶은
// 간단한 리스트로 보여준다 - "라인업이 아예 안 나오는" 것보단 훨씬 낫다.
function renderSimpleLineupList(lineup, team, goalEvents) {
  if (!lineup?.startXI?.length) return "";
  const sorted = lineup.startXI.slice().sort((a, b) => (POSITION_ORDER[a.position] ?? 9) - (POSITION_ORDER[b.position] ?? 9));
  const subs = lineup.substitutes || [];
  return `
    <div class="lineup-simple-team">
      <div class="lineup-simple-header">
        ${team ? crestImg(team, "team-crest") : ""}
        <span>${team?.shortName || team?.name || ""}</span>
        ${lineup.formation ? `<span class="pitch-formation-tag">${lineup.formation}</span>` : ""}
      </div>
      <div class="lineup-simple-list">
        ${sorted
          .map(
            (p) => `
          <div class="lineup-simple-row" data-player-id="${p.id}">
            <span class="lineup-simple-num">${p.number ?? ""}</span>
            ${playerAvatarImg(p, team?.id, "lineup-simple-photo")}
            <span class="lineup-simple-name">${p.name}</span>
            ${playerEventBadgesHtml(p.name, goalEvents)}
            <span class="lineup-simple-pos">${p.position ?? ""}</span>
          </div>
        `
          )
          .join("")}
      </div>
      ${
        subs.length
          ? `<div class="lineup-simple-subs">${subs.map((p) => `<span data-player-id="${p.id}">${p.number ?? ""} ${p.name}${playerEventBadgesHtml(p.name, goalEvents)}</span>`).join("")}</div>`
          : ""
      }
      ${lineup.coach ? `<div class="lineup-simple-coach">감독: ${lineup.coach}</div>` : ""}
    </div>
  `;
}

function renderLineups(m) {
  if (!m.lineups || m.lineups.length < 2) return "";
  const home = m.lineups.find((l) => l.teamId === m.homeTeam.id);
  const away = m.lineups.find((l) => l.teamId === m.awayTeam.id);
  const pitchHtml = renderPitch(home, away, m.homeTeam, m.awayTeam, m.goalEvents);
  const simpleListHtml = pitchHtml ? "" : renderSimpleLineupList(home, m.homeTeam, m.goalEvents) + renderSimpleLineupList(away, m.awayTeam, m.goalEvents);

  return `
    <div class="team-section">
      <h3 class="team-section-title">라인업</h3>
      ${pitchHtml || simpleListHtml || '<div class="empty-state">라인업 정보가 없습니다.</div>'}
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
            <div class="mini-status">${new Date(match.utcDate).toLocaleDateString("ko-KR", { timeZone: KST_TIME_ZONE, year: "numeric", month: "short", day: "numeric" })}</div>
            <div class="mini-team">${crestImg(match.homeTeam, "team-crest")}<span>${match.homeTeam.shortName || match.homeTeam.name}</span></div>
            <div class="mini-score">${hasScore ? `${home}:${away}` : "vs"}</div>
            <div class="mini-team">${crestImg(match.awayTeam, "team-crest")}<span>${match.awayTeam.shortName || match.awayTeam.name}</span></div>
          </div>
        `;
      })
      .join("")}
  `;
}

// "45+2"처럼 추가시간 표기가 섞여 있어도 실제 시간 순으로 정렬되도록, 추가시간은 소수점으로 얹는다
// (본 시간 45분 골보다 45+2분 골이 항상 뒤로 오게).
function parseMinuteValue(minute) {
  const [base, extra] = String(minute).split("+").map(Number);
  return (base || 0) + (extra ? extra / 100 : 0);
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
  // 목록 캐시로 먼저 그린 뒤(라인업/스탯 없음) 전체 조회가 끝나 다시 그릴 때, 그 사이 사용자가
  // "라인업"/"통계" 등으로 탭을 옮겨놨으면 그대로 유지한다 - 예전엔 매번 무조건 "정보" 탭으로
  // 리셋돼서, 로딩 딜레이 동안 라인업 탭을 눌러도 데이터가 도착하는 순간 정보 탭으로 튕겨나갔다.
  // 다른 경기로 넘어온 경우(id가 다름)는 지금처럼 "정보"부터 보여주는 게 맞다.
  const isSameMatch = state.detailMatchId === m.id;
  const previousActiveTab = isSameMatch ? el.detailContent.querySelector(".team-tab-btn.active")?.dataset.detailTab : null;
  state.detailMatchId = m.id;

  const isLive = LIVE_STATUSES.has(m.status) && !m.dataStale;
  const isFinished = m.status === "FINISHED";
  const home = m.score.fullTime.home;
  const away = m.score.fullTime.away;
  const hasScore = home !== null && home !== undefined;

  const statusClass = m.dataStale ? "stale" : isLive ? "live" : isFinished ? "finished" : "";
  const statusText = m.dataStale
    ? "⏱ 업데이트 지연"
    : isLive
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
          .slice()
          .sort((a, b) => parseMinuteValue(a.minute) - parseMinuteValue(b.minute))
          .map((g) => {
            const isHome = g.teamId === m.homeTeam.id;
            const line = `⚽ ${g.scorer} ${g.minute}'${g.penalty ? " (PK)" : ""}${g.ownGoal ? " (OG)" : ""}${g.assist ? ` <span class="goal-assist">(도움: ${g.assist})</span>` : ""}`;
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

    ${
      m.broadcastUrl || m.ticketUrl
        ? `
      <div class="detail-actions">
        ${m.broadcastUrl ? `<a class="detail-action-btn" href="${m.broadcastUrl}" target="_blank" rel="noopener">📺 ${m.broadcastProvider}에서 중계 보기</a>` : ""}
        ${m.ticketUrl ? `<a class="detail-action-btn" href="${m.ticketUrl}" target="_blank" rel="noopener"><img class="detail-action-icon" src="/img/ticket-icon.png" alt="" />티켓 예매하기</a>` : ""}
      </div>
    `
        : ""
    }

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

  el.detailContent.querySelectorAll("[data-dominance-chart]").forEach((wrap) => wireDominanceChart(wrap));

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

  if (previousActiveTab && previousActiveTab !== "info") activateDetailTab(previousActiveTab);

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

// 경기 목록을 좌우로 스와이프해도 이전/다음 날짜로 넘어가게(fotmob처럼). 세로 스크롤과 헷갈리지
// 않도록 수평 이동이 수직 이동보다 충분히 클 때만 날짜를 바꾼다.
let matchesTouchStartX = 0;
let matchesTouchStartY = 0;
el.matchesList.addEventListener(
  "touchstart",
  (e) => {
    matchesTouchStartX = e.touches[0].clientX;
    matchesTouchStartY = e.touches[0].clientY;
  },
  { passive: true }
);
el.matchesList.addEventListener(
  "touchend",
  (e) => {
    const dx = e.changedTouches[0].clientX - matchesTouchStartX;
    const dy = e.changedTouches[0].clientY - matchesTouchStartY;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    state.dayOffset += dx < 0 ? 1 : -1;
    loadMatches();
  },
  { passive: true }
);
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

// ---------- 알림/사운드 데모(?demo=goals) ----------
// 실제 경기에서 골/하프타임/종료가 일어나길 기다리지 않고도 새 알림·세리모니를 눈으로 바로 확인할 수
// 있도록, URL에 ?demo=goals가 있으면 가짜 경기로 전체 시퀀스를 순서대로 재생한다. 일반 사용자는 이
// 쿼리 파라미터를 붙일 일이 없어 평소 사용에는 아무 영향이 없다.
function buildDemoMatch(homeScore, awayScore, status, elapsed) {
  return {
    id: "demo-match",
    utcDate: new Date().toISOString(),
    status,
    elapsed,
    competition: { code: "PL", name: "데모 리그", emblem: null },
    homeTeam: { id: "demo-home", name: "우리팀", shortName: "우리팀", crest: null },
    awayTeam: { id: "demo-away", name: "상대팀", shortName: "상대팀", crest: null },
    score: { fullTime: { home: homeScore, away: awayScore }, halfTime: { home: null, away: null } },
  };
}

function runNotificationDemo() {
  const steps = [
    () => showKickoffToast(buildDemoMatch(0, 0, "IN_PLAY", 1)),
    () => showHalftimeToast(buildDemoMatch(0, 0, "PAUSED", 45)),
    () => {
      // renderGoalCelebration은 화면만 그리고, 실제 골 감지 흐름에서는 showGoalCelebration이
      // 상세 조회 전에 소리부터 먼저 재생한다 - 데모도 같은 순서를 그대로 재현한다.
      playGoalSound();
      const m = buildDemoMatch(1, 0, "IN_PLAY", 55);
      renderGoalCelebration(m, m.homeTeam, "테스트 선수");
    },
    () => showConcedeToast(buildDemoMatch(1, 1, "IN_PLAY", 70), buildDemoMatch(1, 1, "IN_PLAY", 70).awayTeam),
    () => showFinishedToast(buildDemoMatch(1, 1, "FINISHED", 90)),
  ];
  steps.forEach((step, i) => setTimeout(step, 400 + i * 4000));
}

// "경기" 탭은 앱 시작 시 기본으로 이미 활성화돼 있어(onTabChange는 탭 버튼 클릭時에만 발동하므로 여기선
// 못 쓴다) 페이지 로드 후 바로 한 번 재생한다.
if (new URLSearchParams(window.location.search).get("demo") === "goals") {
  setTimeout(runNotificationDemo, 1200);
}
