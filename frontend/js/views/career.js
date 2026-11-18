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

// ---------- 선수 카드(전부 코드로 그리는 벡터 카드) ----------
// 네 번 연속으로 사용자가 준 레퍼런스 이미지(player card.png)를 "재색칠"하려다 버그가 났다(숨은
// 흰 배지가 밝게 남음, 머리카락이 사진창 밖으로 삐져나가 회색으로 지워짐, 색이 섞여 탁해짐 등,
// 2026-11-16~18) - 그림 한 장에 이미 칠해진 색을 실시간으로 "다른 색"으로 바꾸는 접근 자체가
// 한계였다. 결국 "그냥 니가 새로 한번 만들어줘 fc온라인 카드 참고해서"라는 요청을 받고(2026-11-18),
// 레퍼런스 이미지의 구도(FC 온라인/FIFA 얼티밋팀과 같은 계열 - 좌상단 레이팅+포지션+별점, 우상단
// 국적+소속팀 배지, 가운데 인물, 하단 이름 리본, 등급별 배경색)는 유지하되 전부 캔버스로 새로
// 그린다. "재색칠"이 아니라 "그릴 때부터 원하는 색으로" 그리므로 색이 섞이거나 숨은 디테일에
// 걸릴 일이 구조적으로 없다.
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

// 유니폼 색 - 실제 소속팀 킷 컬러 데이터가 없어서(API-Football이 안 줌) 구단 id를 해시해 그 팀
// 전용 색을 하나 고정 배정한다(2026-11-18 사용자 요청 - "선수도 팀 바뀌면 거기에 맞게 유니폼도
// 바뀌고"). 같은 구단이면 항상 같은 색이 나오고, 이적하면 실제로 유니폼 색이 바뀐 것처럼 보인다.
const DEFAULT_JERSEY_HUE = 140; // 소속팀 없을 때(자유계약/미리보기) 기본 초록
function clubJerseyHue(club) {
  if (!club) return DEFAULT_JERSEY_HUE;
  return hashSeed(String(club.id)) % 360;
}

const SKIN_TONES = ["#ffdbac", "#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#5a3825"];
const HAIR_COLORS = ["#1b1b1b", "#3b2414", "#6b4423", "#2c2c2c", "#4a3728"];

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

// 국기/구단 배지 - 흰 스티커를 깔고 그 위에 실제 이미지를 올린다. crest가 없으면 스티커만 비워둔다
// (없는 이미지로 깨지지 않게).
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

// 카드 테두리 안쪽에 옅은 대각선 홀로그램 느낌의 결을 몇 줄 그어 FC 온라인/FIFA 카드 특유의
// "반짝이는 재질" 느낌을 낸다 - 과하지 않게 아주 옅게.
function drawHoloSheen(ctx) {
  ctx.save();
  roundRectPath(ctx, 14, 14, CARD_W - 28, CARD_H - 28, 26);
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 10;
  for (let x = -CARD_H; x < CARD_W + CARD_H; x += 38) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + CARD_H, CARD_H);
    ctx.stroke();
  }
  ctx.restore();
}

function starRow(ctx, x, y, ovr) {
  if (ovr == null) return;
  const count = clampNum(Math.round(ovr / 20), 1, 5);
  ctx.font = "22px sans-serif";
  ctx.textAlign = "left";
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < count ? "#ffd23f" : "rgba(255,255,255,0.3)";
    ctx.fillText("★", x + i * 25, y);
  }
}

function outlinedText(ctx, text, x, y, font, fillColor, strokeColor = "#ffffff", lineWidth = 5) {
  ctx.font = font;
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = strokeColor;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fillColor;
  ctx.fillText(text, x, y);
}

// 인물(머리+유니폼) - 사람 전체를 로컬 좌표계(0~140 x, 0~190 y)에 그려두고 카드 중앙에 맞게 확대/
// 이동한다(이전 SVG 버전의 도형을 그대로 재사용 - 모양 자체는 문제된 적 없고 "재색칠"만 문제였다).
function drawFigure(ctx, { identity, club, cx, topY, scale }) {
  const seed = identity?.lookSeed || 1;
  const skin = SKIN_TONES[seed % SKIN_TONES.length];
  const hair = HAIR_COLORS[Math.floor(seed / 7) % HAIR_COLORS.length];
  const hairStyle = Math.floor(seed / 31) % 3;
  const hue = clubJerseyHue(club);
  const jerseyLight = `hsl(${hue}, 60%, 46%)`;
  const jerseyDark = `hsl(${hue}, 60%, 30%)`;
  const sleeveColor = `hsl(${hue}, 55%, 24%)`;

  ctx.save();
  ctx.translate(cx - 70 * scale, topY);
  ctx.scale(scale, scale);

  // 은은한 그림자(스포트라이트 느낌) - 인물 뒤에 한 번만.
  const shadow = ctx.createRadialGradient(70, 150, 10, 70, 150, 90);
  shadow.addColorStop(0, "rgba(0,0,0,0.28)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(70, 150, 85, 55, 0, 0, Math.PI * 2);
  ctx.fill();

  // 유니폼(그라디언트로 입체감)
  const jerseyGrad = ctx.createLinearGradient(20, 82, 120, 190);
  jerseyGrad.addColorStop(0, jerseyLight);
  jerseyGrad.addColorStop(1, jerseyDark);
  ctx.fillStyle = jerseyGrad;
  ctx.beginPath();
  ctx.moveTo(20, 190);
  ctx.lineTo(20, 122);
  ctx.quadraticCurveTo(20, 97, 44, 90);
  ctx.lineTo(58, 82);
  ctx.quadraticCurveTo(70, 94, 82, 82);
  ctx.lineTo(96, 90);
  ctx.quadraticCurveTo(120, 97, 120, 122);
  ctx.lineTo(120, 190);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = sleeveColor;
  ctx.beginPath();
  ctx.moveTo(20, 122);
  ctx.lineTo(7, 137);
  ctx.lineTo(20, 152);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(120, 122);
  ctx.lineTo(133, 137);
  ctx.lineTo(120, 152);
  ctx.closePath();
  ctx.fill();

  // 옷깃 하이라이트
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.moveTo(58, 82);
  ctx.quadraticCurveTo(70, 100, 82, 82);
  ctx.lineTo(78, 88);
  ctx.quadraticCurveTo(70, 96, 62, 88);
  ctx.closePath();
  ctx.fill();

  // 등번호
  const numberText = identity?.jerseyNumber != null ? String(identity.jerseyNumber) : "";
  ctx.textAlign = "center";
  ctx.font = "900 32px sans-serif";
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.strokeText(numberText, 70, 156);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(numberText, 70, 156);

  // 머리(헤어스타일 3종)
  const capHairPath = () => {
    ctx.beginPath();
    if (hairStyle === 0) {
      ctx.moveTo(40, 44);
      ctx.arc(70, 44, 30, Math.PI, 0, false); // 윗머리 반원
      ctx.lineTo(100, 48);
      ctx.arc(70, 48, 30, 0, Math.PI, true);
      ctx.closePath();
    } else {
      ctx.moveTo(38, 42);
      ctx.quadraticCurveTo(70, 8, 102, 42);
      ctx.lineTo(99, 48);
      ctx.quadraticCurveTo(70, 20, 41, 48);
      ctx.closePath();
    }
  };

  if (hairStyle === 2) {
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.arc(70, 42, 34, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(70, 44, 29, 0, Math.PI * 2);
  ctx.fill();
  if (hairStyle !== 2) {
    ctx.fillStyle = hair;
    capHairPath();
    ctx.fill();
  }
  ctx.fillStyle = "#2b2b2b";
  ctx.beginPath();
  ctx.arc(60, 46, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(80, 46, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#8a5a3c";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(61, 58);
  ctx.quadraticCurveTo(70, 63, 79, 58);
  ctx.stroke();

  ctx.restore();
}

async function drawPlayerCard(canvas, { identity, club, ovr = null }) {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  const tier = cardTier(ovr);
  const theme = CARD_TIER_THEME[tier];

  // 1) 카드 바탕(테두리+배경 그라디언트)
  roundRectPath(ctx, 10, 10, CARD_W - 20, CARD_H - 20, 30);
  ctx.fillStyle = tierBackgroundFill(ctx, tier);
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = theme.border;
  ctx.stroke();
  drawHoloSheen(ctx);

  ctx.textBaseline = "alphabetic";

  // 2) 좌상단: 레이팅 + 포지션 + 별점
  outlinedText(ctx, ovr != null ? String(ovr) : "?", 38, 108, "900 72px sans-serif", theme.ink, "#ffffff", 5);
  outlinedText(ctx, identity?.position || "", 38, 148, "800 28px sans-serif", theme.ink, "#ffffff", 4);
  starRow(ctx, 38, 182, ovr);

  // 3) 인물(얼굴+유니폼) - 사진창 테두리 없이 카드 배경 위에 바로 올라간다(레퍼런스처럼 머리가
  // 위쪽 배경과 자연스럽게 이어지는 느낌).
  drawFigure(ctx, { identity, club, cx: CARD_W / 2, topY: 230, scale: 3.1 });

  // 4) 하단 이름 리본
  const ribbonX = 40;
  const ribbonY = CARD_H - 92;
  const ribbonW = CARD_W - 80;
  const ribbonH = 58;
  roundRectPath(ctx, ribbonX, ribbonY, ribbonW, ribbonH, 16);
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = theme.border;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.font = "800 30px sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(identity?.name || "", ribbonX + ribbonW / 2, ribbonY + ribbonH / 2 + 10);
  ctx.textAlign = "left";

  // 5) 우상단: 국적 + 소속팀 배지
  await Promise.all([
    drawBadge(ctx, identity?.nationality?.crest, { x: CARD_W - 110, y: 32, w: 72, h: 50 }),
    drawBadge(ctx, club?.crest, { x: CARD_W - 104, y: 92, w: 60, h: 60 }, { square: true }),
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
