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
const draft = { lastName: "", jerseyNumber: "", nationality: null, preferredFoot: "right", position: null };

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
async function renderCreate() {
  const nationalities = await loadNationalities();

  el.root.innerHTML = `
    <h2 class="section-title">⚽ 축구인생</h2>
    <p class="career-intro">무명 유망주로 시작해서, 랜덤한 성장과 선택으로 커리어를 만들어가는 미니게임이에요.</p>

    <div class="career-form">
      <div class="career-form-row">
        <label class="career-form-label">성(姓)</label>
        <input type="text" id="career-lastname" class="career-input" maxlength="20" placeholder="예: 손" value="${escapeHtml(draft.lastName)}" />
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

  const nameInput = document.getElementById("career-lastname");
  const numberInput = document.getElementById("career-number");
  nameInput.addEventListener("input", () => (draft.lastName = nameInput.value));
  numberInput.addEventListener("input", () => (draft.jerseyNumber = numberInput.value));

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
      });
    });
  });

  document.getElementById("career-start-btn").addEventListener("click", submitCareerStart);
}

async function submitCareerStart() {
  const errorEl = document.getElementById("career-create-error");
  errorEl.textContent = "";

  const jerseyNumber = Number(draft.jerseyNumber);
  if (!draft.lastName.trim()) return (errorEl.textContent = "성을 입력해주세요.");
  if (!Number.isInteger(jerseyNumber) || jerseyNumber < 1 || jerseyNumber > 99) return (errorEl.textContent = "등번호는 1~99 사이로 입력해주세요.");
  if (!draft.position) return (errorEl.textContent = "포지션을 선택해주세요.");
  if (!draft.nationality) return (errorEl.textContent = "국적을 검색해서 선택해주세요.");

  const btn = document.getElementById("career-start-btn");
  btn.disabled = true;
  btn.textContent = "시작하는 중...";
  try {
    const data = await authFetch("/career/start", {
      method: "POST",
      body: { lastName: draft.lastName.trim(), jerseyNumber, preferredFoot: draft.preferredFoot, position: draft.position, nationality: draft.nationality },
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

const CAREER_CLUB_DISCLAIMER =
  "이 시뮬레이션에 등장하는 구단명과 엠블럼은 재미를 위한 식별 목적으로만 사용되며, 실제 구단과 제휴·후원·공식적인 관계가 없습니다.";

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

function renderActive(save) {
  const { identity } = save;
  el.root.innerHTML = `
    <h2 class="section-title">⚽ 축구인생</h2>
    <div class="career-id-card">
      <div class="career-id-top">
        <span class="career-id-name">#${identity.jerseyNumber} ${escapeHtml(identity.lastName)}</span>
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
        <span class="career-ovr-badge">OVR ${save.ovr}</span>
      </div>
    </div>

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
function renderRetirement(save) {
  const r = save.retirement;

  el.root.innerHTML = `
    <h2 class="section-title">⚽ 축구인생</h2>
    <div class="career-id-card retired">
      <div class="career-id-top">
        <span class="career-id-name">#${save.identity.jerseyNumber} ${escapeHtml(save.identity.lastName)}</span>
        <span class="career-id-pos">${save.identity.position}</span>
      </div>
      <div class="career-retire-headline">은퇴 (나이 ${r.finalAge}세) · 최종 OVR ${r.finalOvr}</div>
      <div class="career-retire-stats">
        <span>통산 출전 ${r.totalApps}</span>
        <span>통산 득점 ${r.totalGoals}</span>
        <span>통산 도움 ${r.totalAssists}</span>
      </div>
      ${r.trophies.length ? `<div class="career-retire-trophies">${r.trophies.map(() => "🏆").join("")}</div>` : ""}
      ${
        save.nationalTeam.called
          ? `<div class="career-national-strip">🏳 국가대표 ${save.nationalTeam.caps}캡 · ${save.nationalTeam.goals}골 · ${save.nationalTeam.assists}도움</div>`
          : ""
      }
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
    draft.lastName = "";
    draft.jerseyNumber = "";
    draft.nationality = null;
    draft.preferredFoot = "right";
    draft.position = null;
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
