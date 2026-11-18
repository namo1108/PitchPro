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

// ---------- 선수 카드(사용자가 준 레퍼런스 이미지를 그대로 사용) ----------
// 처음엔 코드로 그린 도형(SVG)으로 비슷하게 흉내냈는데 "이게 아니야, player card 그대로 가져와"라는
// 피드백을 받았다(2026-11-16) - frontend/img/career-card-template.png(사용자가 올려준 원본을 그대로
// 복사한 파일, 원본은 "player card.png")를 실제 배경으로 쓰고, 그 위에 캔버스로 실제 데이터(OVR/
// 포지션/별점/국적/구단/등번호/이름)를 덮어 그린다. 얼굴 그림과 기본 유니폼 색(초록)은 이 한 장의
// 그림에 고정된 그림이라 선수마다 다르게 바꿀 수는 없다(이미지 생성·편집 도구가 없어 얼굴만 따로
// 다시 그릴 수 없음) - 그 부분만은 모든 선수가 같은 "기본 얼굴"을 공유하는 셈이다.
const CARD_TEMPLATE_SRC = "/img/career-card-template.png";
const CARD_W = 992;
const CARD_H = 1064;

// 템플릿 이미지에서 실측한 배경색(겹쳐 그릴 때 밑에 있던 숫자/별 등을 지우는 용도) - 정확한
// 좌표는 눈대중으로 잡은 값이라 다소 어긋나 보이면 조정 가능.
const CARD_BG_COLOR = "#cca985";
const CARD_RIBBON_COLOR = "#614631";

const CARD_REGIONS = {
  rating: { x: 140, y: 150, w: 210, h: 118 },
  position: { x: 155, y: 258, w: 170, h: 75 },
  stars: { x: 138, y: 358, w: 275, h: 58 },
  flagBadge: { x: 672, y: 156, w: 108, h: 86 },
  crestBadge: { x: 676, y: 238, w: 92, h: 106 },
  jerseyNumber: { x: 412, y: 712, w: 180, h: 125 },
  nameRibbon: { x: 182, y: 910, w: 625, h: 115 },
  // 사진창(얼굴+유니폼) 전체 - 등급 색(아래 CARD_TIER_HUE)을 카드 전체에 입힐 때 이 영역만 구멍처럼
  // 비워서 얼굴/유니폼 색은 그대로 둔다.
  // 실측 결과 머리카락이 둥근 사진창 박스보다 훨씬 위(y≈205)부터 시작해서 카드 배경 쪽까지
  // 삐져나와 있었다 - 구멍(hole)을 사진창 박스 높이에 맞춰 잡았더니 머리카락 윗부분이 등급 틴트에
  // 휩쓸려 회색으로 지워지는 버그가 났다(2026-11-18 사용자 제보 - "이거 완전 아니야"). 머리카락
  // 전체를 넉넉히 덮도록 위쪽으로 크게 넓혔다.
  photoWindow: { x: 195, y: 185, w: 600, h: 720 },
  // 유니폼(셔츠) 부분만 - 소속팀이 바뀌면 이 부분만 색을 덧입힌다(얼굴/목 부분은 건드리지 않음).
  jerseyShirt: { x: 235, y: 598, w: 530, h: 302 },
};

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

// 선수 카드 등급 색(2026-11-18 사용자 요청 - "카드색깔도 처음에는 갈색, 70넘어가면 주황색, 80넘어가면
// 은색, 90넘어가면 금색, 100넘어가면 무지개색으로"). OVR 상한이 99라 "100 이상"은 실제로 안 나와서
// 98 이상으로 기준을 살짝 낮춰 무지개 등급도 실제로 볼 수 있게 했다.
function cardTier(ovr) {
  if (ovr == null || ovr < 70) return null; // 템플릿 원본(갈색) 그대로
  if (ovr < 80) return "orange";
  if (ovr < 90) return "silver";
  if (ovr < 98) return "gold";
  return "rainbow";
}

const CARD_TIER_COLORS = {
  orange: { solid: "#d9772e", rgba: "rgba(217, 119, 46, 0.55)" },
  silver: { solid: "#aab4ba", rgba: "rgba(170, 180, 186, 0.55)" },
  gold: { solid: "#e3b23c", rgba: "rgba(227, 178, 60, 0.55)" },
};

// 카드 배경/유니폼을 재색칠하는 핵심 트릭: 원본 템플릿이 이미 짙은 갈색(배경)·초록(유니폼)으로
// 채색돼 있어서, 그 위에 바로 반투명 색을 올리면(2026-11-18 사용자 제보 - "색깔이 이상하게 나와")
// 원래 색과 섞여 탁해진다(특히 초록 유니폼 위에 보라색을 올리면 탁한 녹갈색이 됨 - 색을 섞는 것과
// 색을 "바꾸는" 건 다른 문제). 그래서 1) 그 부분을 먼저 무채색(흑백)으로 지운 다음 2) 그 위에
// 목표 색을 올린다 - 무채색 바탕에 색을 올리면 질감(명암)은 살아있으면서 색만 깔끔하게 바뀐다.
// 무채색 버전은 템플릿 이미지당 한 번만 만들어서(오프스크린 캔버스) 재사용한다.
let desaturatedTemplatePromise = null;
function loadDesaturatedTemplate() {
  if (!desaturatedTemplatePromise) {
    desaturatedTemplatePromise = loadCardTemplate().then((img) => {
      const off = document.createElement("canvas");
      off.width = CARD_W;
      off.height = CARD_H;
      const octx = off.getContext("2d");
      octx.filter = "grayscale(1) brightness(1.15)";
      octx.drawImage(img, 0, 0, CARD_W, CARD_H);
      return off;
    });
  }
  return desaturatedTemplatePromise;
}

// 사진창을 뺀 카드 전체(배경+테두리+홀로그램 패턴)를 무채색으로 지운 뒤 등급 색을 반투명하게 덧입힌다.
async function applyCardTierTint(ctx, ovr) {
  const tier = cardTier(ovr);
  if (!tier) return;
  const gray = await loadDesaturatedTemplate();
  const pw = CARD_REGIONS.photoWindow;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, CARD_W, CARD_H);
  ctx.rect(pw.x, pw.y, pw.w, pw.h);
  ctx.clip("evenodd");
  ctx.drawImage(gray, 0, 0);
  if (tier === "rainbow") {
    const grad = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
    ["#ff4d4d", "#ff9d4d", "#ffe14d", "#4dff88", "#4dc8ff", "#7a4dff", "#ff4dd2"].forEach((c, i, arr) =>
      grad.addColorStop(i / (arr.length - 1), c)
    );
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = CARD_TIER_COLORS[tier].rgba;
  }
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.restore();
}

// 등급 패치(레이팅/포지션/별점 바탕, 이름 리본)는 반투명이 아니라 불투명 단색으로 칠한다(그 아래
// 텍스트를 새로 쓰기 전에 기존 글자를 완전히 지워야 하므로) - 전체 틴트와 같은 계열 색을 쓴다.
function tierPatchColor(ovr, fallback) {
  const tier = cardTier(ovr);
  if (!tier) return fallback;
  return tier === "rainbow" ? CARD_TIER_COLORS.gold.solid : CARD_TIER_COLORS[tier].solid;
}

// 유니폼 색 - 실제 소속팀 킷 컬러 데이터가 없어서(API-Football이 안 줌) 구단 id를 해시해 그 팀
// 전용 색을 하나 고정 배정한다(2026-11-18 사용자 요청 - "선수도 팀 바뀌면 거기에 맞게 유니폼도
// 바뀌고"). 같은 구단이면 항상 같은 색이 나오고, 이적하면 실제로 유니폼 색이 바뀐 것처럼 보인다.
// 소속팀이 아직 없을 때(자유계약/생성 미리보기)도 기본 초록 톤으로 같은 파이프라인을 태운다 -
// 그래야 템플릿에 박혀있던 등번호("10")가 소속팀 유무와 무관하게 항상 깔끔하게 지워진다.
const DEFAULT_JERSEY_HUE = 140;
function clubJerseyHue(club) {
  if (!club) return DEFAULT_JERSEY_HUE;
  return hashSeed(String(club.id)) % 360;
}

// 유니폼(셔츠) 영역도 카드 배경과 같은 "무채색으로 지운 뒤 색 올리기" 방식을 쓴다 - 원본이 진한
// 초록이라 그냥 반투명을 올리면 탁한 카키색이 돼버린다. 기존에 박혀있던 등번호("10")도 이 과정에서
// 함께 흐려져서, 그 위에 새 번호를 덧쓰면 자연스럽게 가려진다.
async function tintJerseyShirt(ctx, club) {
  const hue = clubJerseyHue(club);
  const gray = await loadDesaturatedTemplate();
  const js = CARD_REGIONS.jerseyShirt;
  ctx.save();
  ctx.beginPath();
  ctx.rect(js.x, js.y, js.w, js.h);
  ctx.clip();
  ctx.drawImage(gray, 0, 0);
  ctx.fillStyle = `hsla(${hue}, 62%, 40%, 0.6)`;
  ctx.fillRect(js.x, js.y, js.w, js.h);
  ctx.restore();
}

let cardTemplateImgPromise = null;
function loadCardTemplate() {
  if (!cardTemplateImgPromise) {
    cardTemplateImgPromise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = CARD_TEMPLATE_SRC;
    });
  }
  return cardTemplateImgPromise;
}

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

// 국기/구단 배지 자리에 흰 스티커를 그리고 그 위에 실제 이미지를 올린다(템플릿엔 샘플 국기/구단이
// 박혀있어 지우고 다시 그려야 함). crest가 없으면 스티커만 비워둔다(없는 이미지로 깨지지 않게).
async function drawBadge(ctx, src, rect, { square = false } = {}) {
  if (!src) return;
  try {
    const img = await loadExternalImage(src);
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const size = Math.min(rect.w, rect.h) * 0.82;
    ctx.save();
    ctx.fillStyle = "#ffffff";
    if (square) roundRectPath(ctx, cx - size / 2 - 5, cy - size / 2 - 5, size + 10, size + 10, 8);
    else roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 6);
    ctx.fill();
    ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
    ctx.restore();
  } catch {
    // 외부 이미지 로드 실패 시 조용히 스킵(빈 스티커도 안 남기면 템플릿 원본 그대로 보임 - 괜찮음)
  }
}

async function drawPlayerCard(canvas, { identity, club, ovr = null }) {
  const template = await loadCardTemplate();
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(template, 0, 0, CARD_W, CARD_H);

  // 카드 전체(사진창 제외) 등급 색 입히기 + 유니폼(소속팀 색) 입히기 - 패치/텍스트를 그리기 전에
  // 먼저 해야 패치 바탕색이 새로 입힌 색과 맞는다.
  await applyCardTierTint(ctx, ovr);
  await tintJerseyShirt(ctx, club);
  ctx.textBaseline = "alphabetic";

  const ratingBg = tierPatchColor(ovr, CARD_BG_COLOR);
  const inkColor = "#1c150c";

  // OVR/포지션 숫자가 잘 안 보인다는 피드백(2026-11-18 - "능력치도 좀 잘보이게 해줘")으로 흰색
  // 외곽선(stroke)을 먼저 깔아서 바탕색이 뭐든 또렷하게 읽히게 한다.
  function outlinedText(text, x, y, font) {
    ctx.font = font;
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#ffffff";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = inkColor;
    ctx.fillText(text, x, y);
  }

  const r = CARD_REGIONS.rating;
  ctx.fillStyle = ratingBg;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.textAlign = "left";
  outlinedText(ovr != null ? String(ovr) : "?", r.x, r.y + r.h - 18, "900 96px sans-serif");

  const p = CARD_REGIONS.position;
  ctx.fillStyle = ratingBg;
  ctx.fillRect(p.x, p.y, p.w, p.h);
  outlinedText(identity?.position || "", p.x, p.y + p.h - 18, "800 38px sans-serif");

  const s = CARD_REGIONS.stars;
  ctx.fillStyle = ratingBg;
  ctx.fillRect(s.x, s.y, s.w, s.h);
  if (ovr != null) {
    const count = clampNum(Math.round(ovr / 20), 1, 5);
    ctx.font = "34px sans-serif";
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i < count ? "#ffd23f" : "rgba(28, 21, 12, 0.35)";
      ctx.fillText("★", s.x + i * 42, s.y + s.h - 14);
    }
  }

  // 등번호는 유니폼을 다시 칠하는 과정(tintJerseyShirt)에서 기존 "10"이 이미 흐려졌으니, 바로 그
  // 위에 새 번호만 쓰면 된다(따로 사각형을 덧칠하지 않음 - 그러면 경계가 스티커처럼 떠 보였다).
  const j = CARD_REGIONS.jerseyNumber;
  const jerseyNumberText = identity?.jerseyNumber != null ? String(identity.jerseyNumber) : "";
  ctx.font = "900 96px sans-serif";
  ctx.textAlign = "center";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
  ctx.strokeText(jerseyNumberText, j.x + j.w / 2, j.y + j.h - 26);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(jerseyNumberText, j.x + j.w / 2, j.y + j.h - 26);

  const n = CARD_REGIONS.nameRibbon;
  ctx.fillStyle = tierPatchColor(ovr, CARD_RIBBON_COLOR);
  ctx.fillRect(n.x, n.y, n.w, n.h);
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 48px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(identity?.name || "", n.x + n.w / 2, n.y + n.h - 34);
  ctx.textAlign = "left";

  await Promise.all([
    drawBadge(ctx, identity?.nationality?.crest, CARD_REGIONS.flagBadge),
    drawBadge(ctx, club?.crest, CARD_REGIONS.crestBadge, { square: true }),
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
