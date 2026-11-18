import { fetchJSON, API } from "../api.js";
import { onTabChange } from "../router.js";
import { authFetch, isLoggedIn, onAuthChange, getCurrentUser, getToken } from "../auth.js";
import { escapeHtml, fadeIn } from "../format.js";
import { trackEvent } from "../analytics.js";

const el = { root: document.getElementById("career-root") };

// 피치에서 클릭하는 포지션 선택 UI - 레퍼런스(simulador-carrera)처럼 공격수 쪽을 위, 골키퍼를
// 아래에 두고 6줄로 배치한다.
const POSITION_ROWS = [
  ["LW", "ST", "RW"],
  ["CAM"],
  ["LM", "CM", "RM"],
  ["CDM"],
  ["LB", "CB", "RB"],
  ["GK"],
];

const DECISION_ICON = { stay: "🛡", move: "✈️", extend: "📝", loan: "🔁", overseas: "🌍" };
// 이적 선택지가 2곳으로 늘면서(2026-11-18) 옵션 id가 move1/move2/overseas1/overseas2처럼 숫자가
// 붙어서 나온다 - 아이콘은 끝자리 숫자를 떼고 찾는다.
function decisionIconFor(optionId) {
  return DECISION_ICON[String(optionId).replace(/\d+$/, "")] || "⚽";
}

const CAREER_CLUB_DISCLAIMER =
  "이 시뮬레이션에 등장하는 구단명과 엠블럼은 재미를 위한 식별 목적으로만 사용되며, 실제 구단과 제휴·후원·공식적인 관계가 없습니다.";

let nationalitiesCache = null;
async function loadNationalities() {
  if (nationalitiesCache) return nationalitiesCache;
  try {
    const data = await fetchJSON("/career/nationalities");
    nationalitiesCache = data.nationalities || [];
  } catch {
    nationalitiesCache = [];
  }
  return nationalitiesCache;
}

// 폼 입력값은 화면을 다시 그려도(예: 국적 검색 결과 클릭) 안 날아가도록 모듈 레벨에 들고 있는다.
// lookSeed는 예전 SVG 생성형 얼굴 버전의 흔적 - 지금은 카드 템플릿 이미지의 얼굴이 고정이라 화면
// 표시에는 안 쓰이지만, 이미 저장된 세이브의 identity.lookSeed 필드와 호환되게 계속 채워서 보낸다.
const draft = { name: "", jerseyNumber: "", nationality: null, preferredFoot: "right", position: null, lookSeed: null };

function randomLookSeed() {
  return Math.floor(Math.random() * 1e9);
}

// ---------- 선수 카드(FC 온라인/FIFA 얼티밋팀 카드 참고, 전부 코드로 그림) ----------
// 레퍼런스 이미지(player card.png)를 "재색칠"하려던 시도가 네 번 연속 버그가 나서(2026-11-16~18)
// 템플릿 이미지 의존을 완전히 버렸는데도 "디자인 좀 잘좀 해줘"라는 피드백을 받았다. 사용자가 실제
// FC 온라인 카드 사진과 "YOUR NAME" 플레이스홀더 카드 이미지를 보여주며 "fc온라인 카드 이미지로
// 입혀주고, 선수 이미지 만들기가 어려우면 unnamed 이미지처럼 만들어줘"라고 요청해서(2026-11-18),
// 1) 카드 테두리를 단순 둥근 사각형이 아니라 방패(크레스트) 모양으로 바꾸고, 2) 사실적인 얼굴을
// 직접 그리는 대신(계속 "그럴듯해 보이는 얼굴"을 그리기가 어려웠다) 공식 카드 플레이스홀더 템플릿
// 그대로 실루엣으로 처리하고, 3) 이름 아래에 PAC/SHO/PAS/DRI/DEF/PHY 6개 세부 능력치 줄을 추가했다
// (그 템플릿 이미지가 보여준 구성 그대로). 실루엣은 평면 단색이라 재색칠 버그가 날 여지 자체가 없다.
const CARD_W = 700;
const CARD_H = 980;

function clampNum(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

// 카드 등급(2026-11-18 사용자 요청 - "카드색깔도 처음에는 갈색, 70넘어가면 주황색, 80넘어가면
// 은색, 90넘어가면 금색, 100넘어가면 무지개색으로"). OVR 상한이 99라 "100 이상"은 실제로 안 나와서
// 98 이상으로 기준을 살짝 낮춰 무지개 등급도 실제로 볼 수 있게 했다.
function cardTier(ovr) {
  if (ovr == null || ovr < 70) return "bronze";
  if (ovr < 80) return "orange";
  if (ovr < 90) return "silver";
  if (ovr < 98) return "gold";
  return "rainbow";
}

const CARD_TIER_THEME = {
  bronze: { from: "#8a5a35", to: "#4a2f1a", border: "#c98a52", ink: "#2a1a0d" },
  orange: { from: "#e08a3c", to: "#a3531a", border: "#ffb366", ink: "#2a1405" },
  silver: { from: "#cfd6da", to: "#8e969c", border: "#f2f6f8", ink: "#1c2024" },
  gold: { from: "#f6d978", to: "#b4811f", border: "#ffeeb0", ink: "#3a2905" },
  rainbow: { from: null, to: null, border: "#ffffff", ink: "#1a1a1a" },
};
const RAINBOW_STOPS = ["#ff4d4d", "#ff9d4d", "#ffe14d", "#4dff88", "#4dc8ff", "#7a4dff", "#ff4dd2"];

function loadExternalImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 카드 전체 테두리 - 레퍼런스처럼 위는 둥근 사각형, 아래는 뾰족하게 모이는 "방패(크레스트)" 모양.
function shieldPath(ctx, x, y, w, h) {
  const topR = w * 0.045;
  const waistY = y + h * 0.88; // 이 아래부터 뾰족하게 좁아짐(여유 있게 낮춰서 안쪽 콘텐츠가 안 잘림)
  ctx.beginPath();
  ctx.moveTo(x + topR, y);
  ctx.lineTo(x + w - topR, y);
  ctx.arcTo(x + w, y, x + w, y + topR, topR);
  ctx.lineTo(x + w, waistY);
  ctx.lineTo(x + w / 2, y + h);
  ctx.lineTo(x, waistY);
  ctx.lineTo(x, y + topR);
  ctx.arcTo(x, y, x + topR, y, topR);
  ctx.closePath();
}

// 국기/구단 배지 - 흰 스티커를 깔고 그 위에 실제 이미지를 올린다. crest가 없으면 스티커만 비워둔다.
async function drawBadge(ctx, src, rect, { square = false } = {}) {
  if (!src) return;
  try {
    const img = await loadExternalImage(src);
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const size = Math.min(rect.w, rect.h) * 0.8;
    ctx.save();
    ctx.fillStyle = "#ffffff";
    if (square) roundRectPath(ctx, cx - size / 2 - 5, cy - size / 2 - 5, size + 10, size + 10, 8);
    else roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 6);
    ctx.fill();
    ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
    ctx.restore();
  } catch {
    // 외부 이미지 로드 실패 시 조용히 스킵
  }
}

function tierBackgroundFill(ctx, tier) {
  const theme = CARD_TIER_THEME[tier];
  if (tier === "rainbow") {
    const grad = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
    RAINBOW_STOPS.forEach((c, i, arr) => grad.addColorStop(i / (arr.length - 1), c));
    return grad;
  }
  const grad = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  grad.addColorStop(0, theme.from);
  grad.addColorStop(1, theme.to);
  return grad;
}

// 레퍼런스(unnamed.jpg)의 배경 다이아몬드 패턴을 흉내 - 인물 실루엣 뒤로 옅은 다이아몬드 몇 개.
function drawDiamondMotif(ctx, cx, cy, color) {
  ctx.save();
  ctx.fillStyle = color;
  const sizes = [160, 115, 75];
  sizes.forEach((s, i) => {
    ctx.save();
    ctx.translate(cx, cy - i * 6);
    ctx.rotate(Math.PI / 4);
    ctx.globalAlpha = 0.16 - i * 0.03;
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.restore();
  });
  ctx.restore();
}

function outlinedText(ctx, text, x, y, font, fillColor, strokeColor = "#ffffff", lineWidth = 5) {
  ctx.font = font;
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = strokeColor;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fillColor;
  ctx.fillText(text, x, y);
}

// 사실적인 얼굴은 계속 "이상하다"는 피드백을 받아서(2026-11-16~18), 공식 카드 플레이스홀더
// 템플릿(unnamed.jpg)이 쓰는 방식 그대로 실루엣 하나로 대신한다 - 평면 단색이라 재색칠/디테일
// 버그가 날 구조 자체가 없다. 포지션에 따라 살짝 다른 자세(골키퍼는 양팔을 살짝 벌림)만 둔다.
function drawSilhouette(ctx, { position, cx, topY, scale }) {
  ctx.save();
  ctx.translate(cx - 70 * scale, topY);
  ctx.scale(scale, scale);
  ctx.fillStyle = "rgba(20, 22, 26, 0.72)";

  ctx.beginPath();
  ctx.arc(70, 40, 26, 0, Math.PI * 2);
  ctx.fill();

  const shoulderSpread = position === "GK" ? 58 : 48;
  ctx.beginPath();
  ctx.moveTo(70 - shoulderSpread, 190);
  ctx.quadraticCurveTo(70 - shoulderSpread - 6, 110, 70 - 22, 66);
  ctx.quadraticCurveTo(70, 50, 70 + 22, 66);
  ctx.quadraticCurveTo(70 + shoulderSpread + 6, 110, 70 + shoulderSpread, 190);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// PAC/SHO/PAS/DRI/DEF/PHY 6개 세부 능력치(레퍼런스 unnamed.jpg 구성 그대로) - 저장 데이터엔 OVR
// 하나뿐이라, 포지션별 전형적인 프로필(공격수는 PAC/SHO 높고 DEF 낮음 등)에 맞춰 OVR에서 가감한
// 뒤 lookSeed로 고정된 약간의 편차를 더해 선수마다 조금씩 다르게 보이게 한다(화면 표시 전용 - 실제
// 골/도움 계산에는 영향 없음).
const STAT_POSITION_GROUP = {
  GK: "GK", CB: "DEF", LB: "DEF", RB: "DEF", CDM: "DEF",
  CM: "MID", CAM: "MID", LM: "MID", RM: "MID",
  LW: "FWD", RW: "FWD", ST: "FWD",
};
const STAT_MODIFIERS = {
  GK: { PAC: -25, SHO: -35, PAS: -12, DRI: -25, DEF: 0, PHY: 10 },
  DEF: { PAC: -2, SHO: -15, PAS: -5, DRI: -8, DEF: 14, PHY: 8 },
  MID: { PAC: 0, SHO: -6, PAS: 10, DRI: 8, DEF: -6, PHY: 0 },
  FWD: { PAC: 9, SHO: 13, PAS: -5, DRI: 6, DEF: -18, PHY: 0 },
};
function deriveSixStats(ovr, position, seed) {
  const base = ovr ?? 50;
  const group = STAT_POSITION_GROUP[position] || "MID";
  const mods = STAT_MODIFIERS[group];
  const keys = ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"];
  const out = {};
  keys.forEach((key) => {
    const jitter = (hashSeed(`${seed}:${key}`) % 9) - 4; // -4~+4
    out[key] = clampNum(Math.round(base + mods[key] + jitter), 1, 99);
  });
  return out;
}

function drawStatRow(ctx, { identity, ovr, cx, y, ink }) {
  const keys = ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"];
  const stats = deriveSixStats(ovr, identity?.position, identity?.lookSeed || 1);
  const colW = 72;
  const startX = cx - (colW * keys.length) / 2;
  ctx.textAlign = "center";
  keys.forEach((key, i) => {
    const x = startX + colW * i + colW / 2;
    ctx.font = "700 15px sans-serif";
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.85;
    ctx.fillText(key, x, y);
    ctx.globalAlpha = 1;
    ctx.font = "800 24px sans-serif";
    ctx.fillStyle = ink;
    ctx.fillText(String(stats[key]), x, y + 30);
  });
  ctx.textAlign = "left";
}

async function drawPlayerCard(canvas, { identity, club, ovr = null }) {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  const tier = cardTier(ovr);
  const theme = CARD_TIER_THEME[tier];

  // 1) 카드 바탕(방패 모양 + 등급 그라디언트 + 테두리)
  shieldPath(ctx, 12, 12, CARD_W - 24, CARD_H - 24);
  ctx.fillStyle = tierBackgroundFill(ctx, tier);
  ctx.fill();
  ctx.save();
  shieldPath(ctx, 12, 12, CARD_W - 24, CARD_H - 24);
  ctx.clip();
  drawDiamondMotif(ctx, CARD_W / 2, CARD_H * 0.42, "#ffffff");
  ctx.restore();
  ctx.lineWidth = 7;
  ctx.strokeStyle = theme.border;
  shieldPath(ctx, 12, 12, CARD_W - 24, CARD_H - 24);
  ctx.stroke();

  ctx.textBaseline = "alphabetic";

  // 2) 좌상단: 레이팅 + 포지션
  outlinedText(ctx, ovr != null ? String(ovr) : "?", 42, 108, "900 72px sans-serif", theme.ink, "#ffffff", 5);
  outlinedText(ctx, identity?.position || "", 44, 148, "800 28px sans-serif", theme.ink, "#ffffff", 4);

  // 3) 인물 실루엣
  drawSilhouette(ctx, { position: identity?.position, cx: CARD_W / 2, topY: 220, scale: 2.9 });

  // 4) 이름
  ctx.textAlign = "center";
  ctx.font = "800 36px sans-serif";
  ctx.fillStyle = theme.ink;
  ctx.fillText(identity?.name || "", CARD_W / 2, 650);
  ctx.textAlign = "left";

  // 5) 6개 세부 능력치
  drawStatRow(ctx, { identity, ovr, cx: CARD_W / 2, y: 706, ink: theme.ink });

  // 6) 국적 + 소속팀 배지(이름/스탯 아래, 레퍼런스처럼 한 줄로)
  await Promise.all([
    drawBadge(ctx, identity?.nationality?.crest, { x: CARD_W / 2 - 92, y: 762, w: 64, h: 44 }),
    drawBadge(ctx, club?.crest, { x: CARD_W / 2 + 28, y: 756, w: 56, h: 56 }, { square: true }),
  ]);
}

// 캔버스는 비동기로(템플릿/배지 이미지 로딩 후) 채워지므로, 먼저 빈 <canvas>를 심어두고 나중에
// drawPlayerCard로 채운다. canvas 엘리먼트를 못 찾으면(그 사이 다른 화면으로 넘어간 경우) 조용히 무시.
function mountPlayerCard(canvasId, ctx) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  drawPlayerCard(canvas, ctx).catch((err) => console.error("선수 카드 렌더 실패:", err));
}

async function loadCareer() {
  if (!el.root) return;
  if (!isLoggedIn()) {
    renderLoginPrompt();
    return;
  }
  el.root.innerHTML = '<div class="loading">불러오는 중...</div>';
  try {
    const data = await authFetch("/career/state");
    render(data.exists ? data.save : null);
  } catch (err) {
    el.root.innerHTML = `<div class="error-state">축구인생을 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

function renderLoginPrompt() {
  el.root.innerHTML = `
    <h2 class="section-title">⚽ 축구인생</h2>
    <div class="empty-state">
      무명 유망주를 직접 키워보세요! 로그인하면 바로 시작할 수 있어요.
      <br /><br />
      <button type="button" class="career-start-btn" id="career-goto-myteam">로그인하러 가기</button>
    </div>
  `;
  document.getElementById("career-goto-myteam")?.addEventListener("click", () => {
    document.querySelector('.nav-btn[data-view="myteam"]')?.click();
  });
}

function render(save) {
  if (!save) return renderCreate();
  if (save.careerStage === "academy_offer") return renderAcademyOffer(save);
  if (save.careerStage === "retired") return renderRetirement(save);
  return renderActive(save);
}

// ---------- 1. 캐릭터 생성 ----------
function updateCreatePreview() {
  const previewEl = document.getElementById("career-preview-card");
  if (!previewEl) return;
  previewEl.innerHTML = '<canvas id="career-preview-canvas" class="career-player-card-canvas"></canvas>';
  mountPlayerCard("career-preview-canvas", {
    identity: {
      name: draft.name || "이름",
      jerseyNumber: draft.jerseyNumber || "-",
      position: draft.position || "",
      nationality: draft.nationality,
      lookSeed: draft.lookSeed,
    },
    club: null,
    ovr: null,
  });
}

async function renderCreate() {
  if (!draft.lookSeed) draft.lookSeed = randomLookSeed();
  const nationalities = await loadNationalities();

  el.root.innerHTML = `
    <h2 class="section-title">⚽ 축구인생</h2>
    <p class="career-intro">무명 유망주로 시작해서, 랜덤한 성장과 선택으로 커리어를 만들어가는 미니게임이에요.</p>

    <div class="career-preview-wrap">
      <div id="career-preview-card" class="career-player-card"></div>
    </div>

    <div class="career-form">
      <div class="career-form-row">
        <label class="career-form-label">이름</label>
        <input type="text" id="career-name" class="career-input" maxlength="20" placeholder="예: 손흥민" value="${escapeHtml(draft.name)}" />
      </div>
      <div class="career-form-row">
        <label class="career-form-label">등번호</label>
        <input type="number" id="career-number" class="career-input" min="1" max="99" placeholder="1~99" value="${escapeHtml(String(draft.jerseyNumber || ""))}" />
      </div>
      <div class="career-form-row">
        <label class="career-form-label">선호발</label>
        <div class="career-foot-toggle">
          <button type="button" class="career-foot-btn ${draft.preferredFoot === "left" ? "active" : ""}" data-foot="left">왼발</button>
          <button type="button" class="career-foot-btn ${draft.preferredFoot === "right" ? "active" : ""}" data-foot="right">오른발</button>
        </div>
      </div>
      <div class="career-form-row">
        <label class="career-form-label">국적</label>
        <input type="text" id="career-nationality-search" class="career-input" placeholder="국가 검색" value="${draft.nationality ? escapeHtml(draft.nationality.name) : ""}" autocomplete="off" />
        <div id="career-nationality-list" class="career-nationality-list"></div>
      </div>
    </div>

    <div class="career-pitch">
      ${POSITION_ROWS.map(
        (row) => `
        <div class="career-pitch-row">
          ${row
            .map((pos) => `<button type="button" class="career-pos-btn ${draft.position === pos ? "active" : ""}" data-pos="${pos}">${pos}</button>`)
            .join("")}
        </div>
      `
      ).join("")}
    </div>

    <div id="career-create-error" class="career-form-error"></div>
    <button type="button" class="career-start-btn" id="career-start-btn">커리어 시작</button>
  `;

  updateCreatePreview();

  const nameInput = document.getElementById("career-name");
  const numberInput = document.getElementById("career-number");
  nameInput.addEventListener("input", () => {
    draft.name = nameInput.value;
    updateCreatePreview();
  });
  numberInput.addEventListener("input", () => {
    draft.jerseyNumber = numberInput.value;
    updateCreatePreview();
  });

  document.querySelectorAll(".career-foot-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      draft.preferredFoot = btn.dataset.foot;
      document.querySelectorAll(".career-foot-btn").forEach((b) => b.classList.toggle("active", b === btn));
    });
  });

  document.querySelectorAll(".career-pos-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      draft.position = btn.dataset.pos;
      document.querySelectorAll(".career-pos-btn").forEach((b) => b.classList.toggle("active", b === btn));
      updateCreatePreview();
    });
  });

  const searchInput = document.getElementById("career-nationality-search");
  const listEl = document.getElementById("career-nationality-list");
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    draft.nationality = null;
    if (!q) {
      listEl.innerHTML = "";
      return;
    }
    const matches = nationalities.filter((n) => n.name.toLowerCase().includes(q)).slice(0, 8);
    listEl.innerHTML = matches
      .map(
        (n) => `
        <div class="career-nationality-item" data-code="${escapeHtml(n.code)}">
          ${n.crest ? `<img src="${n.crest}" alt="" />` : ""}
          <span>${escapeHtml(n.name)}</span>
        </div>
      `
      )
      .join("");
    listEl.querySelectorAll("[data-code]").forEach((item, i) => {
      item.addEventListener("click", () => {
        draft.nationality = matches[i];
        searchInput.value = matches[i].name;
        listEl.innerHTML = "";
        updateCreatePreview();
      });
    });
  });

  document.getElementById("career-start-btn").addEventListener("click", submitCareerStart);
}

async function submitCareerStart() {
  const errorEl = document.getElementById("career-create-error");
  errorEl.textContent = "";

  const jerseyNumber = Number(draft.jerseyNumber);
  if (!draft.name.trim()) return (errorEl.textContent = "이름을 입력해주세요.");
  if (!Number.isInteger(jerseyNumber) || jerseyNumber < 1 || jerseyNumber > 99) return (errorEl.textContent = "등번호는 1~99 사이로 입력해주세요.");
  if (!draft.position) return (errorEl.textContent = "포지션을 선택해주세요.");
  if (!draft.nationality) return (errorEl.textContent = "국적을 검색해서 선택해주세요.");

  const btn = document.getElementById("career-start-btn");
  btn.disabled = true;
  btn.textContent = "시작하는 중...";
  try {
    const data = await authFetch("/career/start", {
      method: "POST",
      body: {
        name: draft.name.trim(),
        jerseyNumber,
        preferredFoot: draft.preferredFoot,
        position: draft.position,
        nationality: draft.nationality,
        lookSeed: draft.lookSeed,
      },
    });
    render(data.save);
  } catch (err) {
    errorEl.textContent = err.message;
    btn.disabled = false;
    btn.textContent = "커리어 시작";
  }
}

// ---------- 2. 유스 아카데미 오퍼 ----------
function clubCardHtml(club) {
  return `
    <div class="career-club-card" data-club-id="${escapeHtml(String(club.id))}">
      ${club.crest ? `<img class="career-club-crest" src="${club.crest}" alt="" />` : '<div class="career-club-crest empty"></div>'}
      <div class="career-club-name">${escapeHtml(club.name)}</div>
    </div>
  `;
}

function renderAcademyOffer(save) {
  el.root.innerHTML = `
    <h2 class="section-title">⚽ 축구인생</h2>
    <p class="career-intro">세 구단이 유스팀 입단을 제안했어요. 어디서 커리어를 시작할까요?</p>
    <div class="career-academy-grid">${save.pendingEvent.candidates.map(clubCardHtml).join("")}</div>
    <p class="career-disclaimer">${escapeHtml(CAREER_CLUB_DISCLAIMER)}</p>
  `;
  el.root.querySelectorAll("[data-club-id]").forEach((card) => {
    card.addEventListener("click", async () => {
      el.root.querySelectorAll("[data-club-id]").forEach((c) => (c.style.pointerEvents = "none"));
      try {
        const data = await authFetch("/career/academy-choice", { method: "POST", body: { clubId: card.dataset.clubId } });
        render(data.save);
      } catch (err) {
        alert(err.message);
        el.root.querySelectorAll("[data-club-id]").forEach((c) => (c.style.pointerEvents = ""));
      }
    });
  });
}

// ---------- 3. 진행중 커리어 ----------
function historyRowHtml(h) {
  return `
    <tr class="${h.onLoan ? "career-loan-row" : ""}">
      <td>${h.age}</td>
      <td>${h.clubCrest ? `<img class="career-history-crest" src="${h.clubCrest}" alt="" />` : ""}${escapeHtml(h.clubName || "-")}${h.onLoan ? " (임대)" : ""}</td>
      <td>${h.ovr}</td>
      <td>${h.apps}</td>
      <td>${h.goals}</td>
      <td>${h.assists}</td>
    </tr>
  `;
}

// 은퇴 요약과 같은 기준(careerEngine.js의 peakOvr)으로 "지금까지 커리어 최고 OVR"을 구한다 - 프론트는
// 서버 코드를 import할 수 없는 별도 정적 자산이라 같은 계산식을 여기서도 한 번 더 둔다.
function peakOvr(save) {
  return save.history.reduce((max, h) => Math.max(max, h.ovr), save.ovr);
}

function renderActive(save) {
  const { identity } = save;
  const latestStory = save.history.length ? save.history[save.history.length - 1].story : null;
  const peak = peakOvr(save);

  el.root.innerHTML = `
    <h2 class="section-title">⚽ 축구인생</h2>
    <div class="career-id-card">
      <div class="career-id-card-body">
        <div class="career-player-card"><canvas id="career-active-canvas" class="career-player-card-canvas"></canvas></div>
        <div class="career-id-info">
          <div class="career-id-top">
            <span class="career-id-name">#${identity.jerseyNumber} ${escapeHtml(identity.name)}</span>
            <span class="career-id-pos">${identity.position}</span>
          </div>
          <div class="career-id-sub">
            ${identity.nationality?.crest ? `<img src="${identity.nationality.crest}" alt="" />` : ""}
            <span>${escapeHtml(identity.nationality?.name || "")}</span>
            <span>· 나이 ${save.age}</span>
            <span>· ${escapeHtml(save.contractStatus)}</span>
          </div>
          <div class="career-id-club">
            ${save.club?.crest ? `<img src="${save.club.crest}" alt="" />` : ""}
            <span>${escapeHtml(save.club?.name || "자유계약")}</span>
            <span class="career-ovr-badge">OVR ${save.ovr}${peak > save.ovr ? ` <small>(최고 ${peak})</small>` : ""}</span>
          </div>
          ${save.maxTransferFee ? `<div class="career-fee-badge">💰 최고 이적료 ${save.maxTransferFee}억원</div>` : ""}
        </div>
      </div>
    </div>

    ${latestStory ? `<div class="career-story-box">📖 ${escapeHtml(latestStory)}</div>` : ""}

    ${
      save.nationalTeam.called
        ? `<div class="career-national-strip">🏳 국가대표 ${save.nationalTeam.caps}캡 · ${save.nationalTeam.goals}골 · ${save.nationalTeam.assists}도움</div>`
        : ""
    }

    <div class="career-history-wrap">
      <table class="career-history-table">
        <thead><tr><th>나이</th><th>소속팀</th><th>OVR</th><th>출전</th><th>골</th><th>도움</th></tr></thead>
        <tbody>${save.history.slice().reverse().map(historyRowHtml).join("") || '<tr><td colspan="6" class="career-history-empty">아직 기록이 없어요</td></tr>'}</tbody>
      </table>
    </div>

    <button type="button" class="career-start-btn" id="career-advance-btn">다음 시즌 ▶</button>
  `;

  mountPlayerCard("career-active-canvas", { identity, club: save.club, ovr: peak });

  document.getElementById("career-advance-btn").addEventListener("click", advanceSeason);

  if (save.pendingEvent?.kind === "decision") renderDecisionModal(save);
}

async function advanceSeason() {
  const btn = document.getElementById("career-advance-btn");
  btn.disabled = true;
  btn.textContent = "진행 중...";
  try {
    const data = await authFetch("/career/advance-season", { method: "POST", body: {} });
    render(data.save);
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
    btn.textContent = "다음 시즌 ▶";
  }
}

// ---------- 4. 결정 모달 ----------
function decisionOptionHtml(option) {
  const icon = decisionIconFor(option.id);
  return `
    <button type="button" class="career-decision-option" data-option-id="${escapeHtml(option.id)}">
      ${option.club?.crest ? `<img class="career-decision-club-crest" src="${option.club.crest}" alt="" />` : `<span class="career-decision-icon">${icon}</span>`}
      <span class="career-decision-option-label">${escapeHtml(option.label)}</span>
      <span class="career-decision-option-desc">${escapeHtml(option.description)}</span>
    </button>
  `;
}

// index.html의 다른 모달(#points-info-modal 등)은 전부 body 바로 아래에 미리 박아두고 show/hide만
// 하는 정적 엘리먼트인데, 이 모달은 el.root(= #view-career 안)에 그때그때 추가한다 - 탭을 벗어나면
// #view-career 전체가 display:none이 되면서 같이 사라지니, body에 직접 붙이는 것과 달리 탭을
// 옮겼을 때 모달만 둥둥 떠서 남는 문제가 없다.
function renderDecisionModal(save) {
  const wrap = document.createElement("div");
  wrap.className = "points-info-modal";
  wrap.innerHTML = `
    <div class="points-info-backdrop"></div>
    <div class="points-info-card career-decision-card">
      <div class="points-info-header"><h3>📋 중요한 결정</h3></div>
      <p class="career-decision-text">${escapeHtml(save.pendingEvent.text)}</p>
      <div class="career-decision-options">${save.pendingEvent.options.map(decisionOptionHtml).join("")}</div>
      ${save.pendingEvent.options.some((o) => o.club) ? `<p class="career-disclaimer">${escapeHtml(CAREER_CLUB_DISCLAIMER)}</p>` : ""}
    </div>
  `;
  el.root.appendChild(wrap);

  wrap.querySelectorAll("[data-option-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      wrap.querySelectorAll("[data-option-id]").forEach((b) => (b.disabled = true));
      try {
        const data = await authFetch("/career/choose-decision", { method: "POST", body: { optionId: btn.dataset.optionId } });
        render(data.save);
      } catch (err) {
        alert(err.message);
        wrap.querySelectorAll("[data-option-id]").forEach((b) => (b.disabled = false));
      }
    });
  });
}

// ---------- 5. 은퇴 요약 ----------
// 트로피 이름이 이제 실제 리그/컵 이름이라(careerEngine.js의 rollTrophies 참고) 아이콘만 나열하지
// 않고 "K리그1 우승 x2"처럼 같은 트로피는 묶어서 보여준다(2026-11-16 사용자 요청 - "트로피랑 리그는
// api 데이터에서 따오면 좋을 것 같아").
function groupTrophies(trophies) {
  const counts = new Map();
  for (const name of trophies) counts.set(name, (counts.get(name) || 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count }));
}

// "커리어 하이라이트" - 20시즌 넘게 쌓인 스토리를 전부 보여주면 지저분하니, 데뷔/수상 시즌/은퇴
// 시즌만 골라 짧게 보여준다(2026-11-16 사용자 요청 - "약간 스토리도 넣어주고").
// 2026-11-18 사용자 요청("커리어 하이라이트도 좀 다양하게 해주고") - 데뷔/트로피/은퇴 시즌만 보여주던
// 걸 커리어 최고 OVR 찍은 시즌, 이적/임대 시즌, 생애 첫 국가대표 발탁 시즌까지 넓혀서 더 다채롭게 보여준다.
function careerHighlights(save) {
  const hist = save.history;
  if (!hist.length) return [];
  const picks = new Map();
  picks.set(hist[0].season, hist[0]); // 데뷔 시즌
  hist
    .filter((h) => h.trophies?.length)
    .slice(-2)
    .forEach((h) => picks.set(h.season, h));
  const peak = hist.reduce((best, h) => (h.ovr > best.ovr ? h : best), hist[0]);
  picks.set(peak.season, peak);
  const firstTransfer = hist.find((h) => h.justTransferred);
  if (firstTransfer) picks.set(firstTransfer.season, firstTransfer);
  const callUpSeason = hist.find((h) => h.firstCallUp);
  if (callUpSeason) picks.set(callUpSeason.season, callUpSeason);
  picks.set(hist[hist.length - 1].season, hist[hist.length - 1]); // 은퇴 시즌
  return [...picks.values()].sort((a, b) => a.season - b.season);
}

function renderRetirement(save) {
  const r = save.retirement;

  el.root.innerHTML = `
    <h2 class="section-title">⚽ 축구인생</h2>
    <div class="career-id-card retired">
      <div class="career-id-card-body">
        <div class="career-player-card"><canvas id="career-retire-canvas" class="career-player-card-canvas"></canvas></div>
        <div class="career-id-info">
          <div class="career-id-top">
            <span class="career-id-name">#${save.identity.jerseyNumber} ${escapeHtml(save.identity.name)}</span>
            <span class="career-id-pos">${save.identity.position}</span>
          </div>
          <div class="career-retire-headline">은퇴 (나이 ${r.finalAge}세) · 커리어 최고 OVR ${r.finalOvr}</div>
          <div class="career-retire-stats">
            <span>통산 출전 ${r.totalApps}</span>
            <span>통산 득점 ${r.totalGoals}</span>
            <span>통산 도움 ${r.totalAssists}</span>
            ${r.maxTransferFee ? `<span>최고 이적료 ${r.maxTransferFee}억</span>` : ""}
          </div>
          ${r.trophies.length ? `<div class="career-retire-trophies">${groupTrophies(r.trophies).map((t) => `<span class="career-trophy-pill">🏆 ${escapeHtml(t.name)}${t.count > 1 ? ` x${t.count}` : ""}</span>`).join("")}</div>` : ""}
          ${
            save.nationalTeam.called
              ? `<div class="career-national-strip">🏳 국가대표 ${save.nationalTeam.caps}캡 · ${save.nationalTeam.goals}골 · ${save.nationalTeam.assists}도움</div>`
              : ""
          }
        </div>
      </div>
    </div>

    <div class="career-highlights">
      <div class="career-highlights-title">📖 커리어 하이라이트</div>
      ${careerHighlights(save)
        .map((h) => `<div class="career-highlight-line"><b>${h.age}세</b> ${escapeHtml(h.story || "")}</div>`)
        .join("")}
    </div>

    <div class="career-history-wrap">
      <table class="career-history-table">
        <thead><tr><th>나이</th><th>소속팀</th><th>OVR</th><th>출전</th><th>골</th><th>도움</th></tr></thead>
        <tbody>${save.history.slice().reverse().map(historyRowHtml).join("")}</tbody>
      </table>
    </div>

    <div class="career-retire-actions">
      <div class="career-share-row">
        <button type="button" class="career-share-btn" id="career-share-btn">📤 공유하기</button>
        <button type="button" class="career-save-btn" id="career-save-btn">💾 저장</button>
        <button type="button" class="career-fb-btn" id="career-fb-btn">📘 페이스북</button>
      </div>
      <p class="career-share-hint">"공유하기"를 누르면 기기에 설치된 카카오톡/인스타그램 등으로 바로 보낼 수 있어요(지원 안 하는 환경에선 자동으로 저장돼요).</p>
      <button type="button" class="career-start-btn" id="career-replay-btn">다시하기</button>
    </div>
  `;

  mountPlayerCard("career-retire-canvas", { identity: save.identity, club: save.club, ovr: r.finalOvr });

  fadeIn(el.root);
  const user = getCurrentUser();
  document.getElementById("career-share-btn").addEventListener("click", (e) => shareCareerCard(user?.username, e.currentTarget));
  document.getElementById("career-save-btn").addEventListener("click", (e) => saveCareerCard(user?.username, e.currentTarget));
  document.getElementById("career-fb-btn").addEventListener("click", () => openFacebookShare(user?.username));
  document.getElementById("career-replay-btn").addEventListener("click", resetCareer);
}

function careerShareImageUrl(username) {
  return `${API}/career/share/${encodeURIComponent(username)}.png`;
}

async function fetchCareerShareBlob(username) {
  const token = getToken();
  const res = await fetch(careerShareImageUrl(username), { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error("아직 공유 이미지를 만들 수 없어요.");
  return res.blob();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// matches.js의 shareMatchCard와 같은 패턴 - 가능하면 OS 공유 시트(navigator.share)로 바로 카카오톡/
// 인스타그램/메시지 등에 보낼 수 있게 하고(안드로이드/iOS는 설치된 앱이 자동으로 뜸 - 별도 SDK나
// 앱별 키 없이도 됨), 지원 안 하는 환경(대부분의 데스크톱 브라우저)에서는 바로 다운로드한다.
async function shareCareerCard(username, btn) {
  if (!username) return;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "불러오는 중...";
  try {
    const blob = await fetchCareerShareBlob(username);
    trackEvent("share_career_card");
    const file = new File([blob], `pitchpro-career-${username}.png`, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "PITCH PRO 축구인생" });
    } else {
      downloadBlob(blob, file.name);
    }
  } catch (err) {
    if (err?.name !== "AbortError") alert(err.message || "공유 이미지를 만들지 못했어요.");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// "공유하기 눌러도 저장하기 버튼이 없다"는 피드백(2026-11-18)으로 공유 시트를 거치지 않는 직접
// 저장 버튼을 따로 둔다.
async function saveCareerCard(username, btn) {
  if (!username) return;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "저장 중...";
  try {
    const blob = await fetchCareerShareBlob(username);
    downloadBlob(blob, `pitchpro-career-${username}.png`);
  } catch (err) {
    alert(err.message || "저장하지 못했어요.");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// 페이스북은 앱 키 없이도 쓸 수 있는 공식 공유 다이얼로그(sharer.php)가 있어 바로 연결한다 - 카카오톡
// 전용 버튼/인스타그램 피드 업로드는 각각 카카오 디벨로퍼스 앱 키, 인스타그램 공식 API(비즈니스 심사)가
// 있어야 해서 이 세션에선 만들 수 없다(둘 다 외부 등록이 필요) - 대신 위 "공유하기"의 OS 공유 시트가
// 설치된 카카오톡/인스타그램 앱으로 바로 보내는 걸 지원한다.
function openFacebookShare(username) {
  if (!username) return;
  const shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(careerShareImageUrl(username))}`;
  window.open(shareUrl, "_blank", "noopener,width=600,height=520");
}

async function resetCareer() {
  const btn = document.getElementById("career-replay-btn");
  btn.disabled = true;
  try {
    await authFetch("/career/reset", { method: "POST", body: {} });
    draft.name = "";
    draft.jerseyNumber = "";
    draft.nationality = null;
    draft.preferredFoot = "right";
    draft.position = null;
    draft.lookSeed = null;
    render(null);
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
  }
}

onTabChange("career", loadCareer);
onAuthChange(() => {
  if (document.getElementById("view-career")?.classList.contains("active")) loadCareer();
});
