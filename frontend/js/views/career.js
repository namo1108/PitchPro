import { fetchJSON } from "../api.js";
import { onTabChange } from "../router.js";
import { authFetch, isLoggedIn, onAuthChange, getCurrentUser } from "../auth.js";
import { escapeHtml, fadeIn } from "../format.js";

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
// lookSeed는 미리보기 카드(얼굴/유니폼)를 결정하는 값 - 생성 화면에 들어올 때 한 번만 굴려서,
// 입력하는 동안 얼굴이 계속 바뀌어 보이지 않게 한다.
const draft = { name: "", jerseyNumber: "", nationality: null, preferredFoot: "right", position: null, lookSeed: null };

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
const CARD_JERSEY_COLOR = "#3a8a55";

const CARD_REGIONS = {
  rating: { x: 140, y: 150, w: 210, h: 118 },
  position: { x: 155, y: 258, w: 170, h: 75 },
  stars: { x: 138, y: 358, w: 275, h: 58 },
  flagBadge: { x: 672, y: 156, w: 108, h: 86 },
  crestBadge: { x: 676, y: 238, w: 92, h: 106 },
  jerseyNumber: { x: 412, y: 712, w: 180, h: 125 },
  nameRibbon: { x: 182, y: 910, w: 625, h: 115 },
};

function clampNum(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
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
  ctx.textBaseline = "alphabetic";

  const r = CARD_REGIONS.rating;
  ctx.fillStyle = CARD_BG_COLOR;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = "#1c150c";
  ctx.font = "900 92px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(ovr != null ? String(ovr) : "?", r.x, r.y + r.h - 18);

  const p = CARD_REGIONS.position;
  ctx.fillStyle = CARD_BG_COLOR;
  ctx.fillRect(p.x, p.y, p.w, p.h);
  ctx.fillStyle = "#1c150c";
  ctx.font = "800 36px sans-serif";
  ctx.fillText(identity?.position || "", p.x, p.y + p.h - 18);

  const s = CARD_REGIONS.stars;
  ctx.fillStyle = CARD_BG_COLOR;
  ctx.fillRect(s.x, s.y, s.w, s.h);
  if (ovr != null) {
    const count = clampNum(Math.round(ovr / 20), 1, 5);
    ctx.font = "34px sans-serif";
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i < count ? "#d8a33c" : "#b89a79";
      ctx.fillText("★", s.x + i * 42, s.y + s.h - 14);
    }
  }

  const j = CARD_REGIONS.jerseyNumber;
  ctx.fillStyle = CARD_JERSEY_COLOR;
  ctx.fillRect(j.x, j.y, j.w, j.h);
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 96px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(identity?.jerseyNumber != null ? String(identity.jerseyNumber) : "", j.x + j.w / 2, j.y + j.h - 26);

  const n = CARD_REGIONS.nameRibbon;
  ctx.fillStyle = CARD_RIBBON_COLOR;
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
  const icon = DECISION_ICON[option.id] || "⚽";
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
// "커리어 하이라이트" - 20시즌 넘게 쌓인 스토리를 전부 보여주면 지저분하니, 데뷔/수상 시즌/은퇴
// 시즌만 골라 짧게 보여준다(2026-11-16 사용자 요청 - "약간 스토리도 넣어주고").
function careerHighlights(save) {
  const hist = save.history;
  if (!hist.length) return [];
  const picks = new Map();
  picks.set(hist[0].season, hist[0]);
  hist
    .filter((h) => h.trophies?.length)
    .slice(-2)
    .forEach((h) => picks.set(h.season, h));
  picks.set(hist[hist.length - 1].season, hist[hist.length - 1]);
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
          ${r.trophies.length ? `<div class="career-retire-trophies">${r.trophies.map(() => "🏆").join("")}</div>` : ""}
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
      <button type="button" class="career-share-btn" id="career-share-btn">공유하기</button>
      <button type="button" class="career-start-btn" id="career-replay-btn">다시하기</button>
    </div>
  `;

  mountPlayerCard("career-retire-canvas", { identity: save.identity, club: save.club, ovr: r.finalOvr });

  fadeIn(el.root);
  document.getElementById("career-share-btn").addEventListener("click", () => openShareImage());
  document.getElementById("career-replay-btn").addEventListener("click", resetCareer);
}

function openShareImage() {
  const user = getCurrentUser();
  if (!user) return;
  window.open(`https://soccer-live.skagh662.workers.dev/api/career/share/${encodeURIComponent(user.username)}.png`, "_blank");
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
