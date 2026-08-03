// 관리자(GOAT 계정, level===99) 전용 페이지 - 알림 테스트/사용 통계/신고 대기함/데이터 백업이
// 예전엔 설정 탭 안에 전부 나열돼 있어서 스크롤이 계속 늘어나고 일반 설정과 섞여 보기 나빴다.
// 그래서 설정 탭에는 진입 버튼 하나만 남기고, 실제 내용은 별도 화면(#view-admin)으로 뺐다.
import { fetchJSON } from "../api.js";
import { pushDetail } from "../router.js";
import { escapeHtml } from "../format.js";
import { getCurrentUser, onAuthChange, getToken } from "../auth.js";

const SAMPLE_TEAM_A = { name: "토트넘", crest: "https://media.api-sports.io/football/teams/47.png" };
const SAMPLE_TEAM_B = { name: "첼시", crest: "https://media.api-sports.io/football/teams/49.png" };

function buildTestPayload(type) {
  const enc = encodeURIComponent;
  switch (type) {
    case "goal":
      return {
        type: "goal",
        title: "⚽ 골! 손흥민",
        body: "토트넘 1 - 0 첼시 · ⌄ 펼쳐서 확인",
        image: `/api/notif-image/goal?team=${enc(SAMPLE_TEAM_A.name)}&crest=${enc(SAMPLE_TEAM_A.crest)}&scorer=${enc("손흥민")}&minute=74`,
      };
    case "redcard":
      return {
        type: "redcard",
        title: "🟥 퇴장! 판데벤",
        body: "첼시 · 63'",
        image: `/api/notif-image/goal?team=${enc(SAMPLE_TEAM_B.name)}&crest=${enc(SAMPLE_TEAM_B.crest)}&scorer=${enc(
          "판데벤"
        )}&minute=63&badge=${enc("RED CARD")}&color=${enc("#ef4444")}`,
      };
    case "kickoff":
      return {
        type: "kickoff",
        title: "⏱ 경기 시작",
        body: "토트넘 vs 첼시 킥오프!",
        image: `/api/notif-image/status?homeTeam=${enc(SAMPLE_TEAM_A.name)}&homeCrest=${enc(SAMPLE_TEAM_A.crest)}&awayTeam=${enc(
          SAMPLE_TEAM_B.name
        )}&awayCrest=${enc(SAMPLE_TEAM_B.crest)}&badge=${enc("KICK OFF")}`,
      };
    case "kickoff_soon":
      return {
        type: "kickoff_soon",
        title: "⏱ 5분 후 킥오프!",
        body: "토트넘 vs 첼시 곧 시작합니다.",
        image: `/api/notif-image/status?homeTeam=${enc(SAMPLE_TEAM_A.name)}&homeCrest=${enc(SAMPLE_TEAM_A.crest)}&awayTeam=${enc(
          SAMPLE_TEAM_B.name
        )}&awayCrest=${enc(SAMPLE_TEAM_B.crest)}&badge=${enc("5 MIN")}`,
      };
    case "fulltime":
      return {
        type: "fulltime",
        title: "🏁 경기 종료",
        body: "토트넘 2 - 1 첼시 · 경기 종료",
        image: `/api/notif-image/status?homeTeam=${enc(SAMPLE_TEAM_A.name)}&homeCrest=${enc(SAMPLE_TEAM_A.crest)}&awayTeam=${enc(
          SAMPLE_TEAM_B.name
        )}&awayCrest=${enc(SAMPLE_TEAM_B.crest)}&homeScore=2&awayScore=1&badge=${enc("FT")}`,
      };
    case "transfer":
      return {
        type: "transfer",
        title: "🔁 이적 소식: 손흥민",
        body: "토트넘 → 첼시",
        image: `/api/notif-image/transfer?player=${enc("손흥민")}&fromTeam=${enc(SAMPLE_TEAM_A.name)}&fromCrest=${enc(
          SAMPLE_TEAM_A.crest
        )}&toTeam=${enc(SAMPLE_TEAM_B.name)}&toCrest=${enc(SAMPLE_TEAM_B.crest)}`,
      };
    default:
      return { type: "goal", title: "🔔 테스트 알림", body: "이미지 없는 텍스트 알림 테스트입니다." };
  }
}

document.getElementById("admin-test-send-btn")?.addEventListener("click", async (e) => {
  const resultBox = document.getElementById("admin-test-result");
  const username = document.getElementById("admin-test-username").value.trim() || getCurrentUser()?.username;
  const type = document.getElementById("admin-test-type").value;
  if (!username) return;
  e.target.disabled = true;
  resultBox.className = "auth-find-result";
  resultBox.textContent = "보내는 중...";
  try {
    await fetchJSON("/admin/test-push", { method: "POST", body: { username, ...buildTestPayload(type) } });
    resultBox.className = "auth-find-result ok";
    resultBox.textContent = `"${username}" 계정으로 보냈어요. 폰에서 확인해보세요.`;
  } catch (err) {
    resultBox.className = "auth-find-result error";
    resultBox.textContent = err.message;
  } finally {
    e.target.disabled = false;
  }
});

// 응답이 JSON을 그대로 반환하되 파일 다운로드용 헤더가 붙어있어(src/routes/backup.js) fetchJSON을
// 못 쓴다(그건 항상 res.json()을 기대함) - 여기선 Blob으로 받아 임시 <a>로 다운로드만 트리거한다.
document.getElementById("admin-backup-btn")?.addEventListener("click", async (e) => {
  const resultBox = document.getElementById("admin-backup-result");
  e.target.disabled = true;
  resultBox.className = "auth-find-result";
  resultBox.textContent = "백업 만드는 중...";
  try {
    const res = await fetch("/api/admin/backup-export", { headers: { authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new Error(`백업 실패 (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pitchpro-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    resultBox.className = "auth-find-result ok";
    resultBox.textContent = "다운로드했어요. 안전한 곳에 보관해두세요.";
  } catch (err) {
    resultBox.className = "auth-find-result error";
    resultBox.textContent = err.message;
  } finally {
    e.target.disabled = false;
  }
});

// 신고된 게시글/댓글 목록 - 신고 시점 스냅샷(제목/본문/작성자)을 그대로 보여주니, 지금 그 글이
// 수정/삭제됐어도 신고 당시 내용을 그대로 확인할 수 있다. "삭제"는 신고 대상 자체를 지우고,
// "무시"는 신고만 닫는다(글은 그대로 둠) - 둘 다 community.js의 handleResolveReport가 처리한다.
async function loadAdminReports() {
  const body = document.getElementById("admin-reports-body");
  if (!body) return;
  body.textContent = "불러오는 중...";
  try {
    const data = await fetchJSON("/admin/reports");
    if (!data.reports?.length) {
      body.textContent = "대기 중인 신고가 없습니다.";
      return;
    }
    body.innerHTML = data.reports
      .map((r) => {
        const snap = r.targetSnapshot || {};
        const target = r.commentId ? `댓글 (원글: ${escapeHtml(snap.postTitle || "-")})` : `게시글 "${escapeHtml(snap.title || "-")}"`;
        return `
          <div class="admin-report-row" data-report-id="${r.id}">
            <div class="admin-report-target">${target}</div>
            <div class="admin-report-body">${escapeHtml(snap.body || "")}</div>
            <div class="admin-report-meta">작성자 ${escapeHtml(snap.authorNickname || snap.authorUsername || "-")} · 신고자 ${escapeHtml(r.reporterUsername)}${r.reason ? ` · 사유: ${escapeHtml(r.reason)}` : ""}</div>
            <div class="admin-report-actions">
              <button class="auth-submit-btn" data-report-action="delete">삭제</button>
              <button class="community-delete-btn" data-report-action="dismiss">무시</button>
            </div>
          </div>
        `;
      })
      .join("");
    body.querySelectorAll("[data-report-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest("[data-report-id]");
        const reportId = row.dataset.reportId;
        const action = btn.dataset.reportAction;
        btn.disabled = true;
        try {
          await fetchJSON(`/admin/reports/${reportId}/resolve`, { method: "POST", body: { action } });
          row.remove();
          if (!document.querySelector("[data-report-id]")) body.textContent = "대기 중인 신고가 없습니다.";
        } catch (err) {
          alert(err.message);
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    body.textContent = `불러오기 실패: ${err.message}`;
  }
}

// GA 등 외부 분석 도구 없이 서버(src/routes/track.js)가 KV에 날짜별로 더해둔 익명 집계를 보여준다.
// 개인 식별 없이 "탭 조회수/가입/로그인/집관인증" 횟수만 있는 요약이라 큰 대시보드가 아니라
// 간단한 표로 끝낸다.
const VIEW_LABELS = {
  matches: "경기",
  news: "뉴스",
  leagues: "리그",
  transfers: "이적",
  ai: "AI분석",
  myteam: "나의팀",
  hof: "명예의전당",
  community: "커뮤니티",
  settings: "설정",
  soccerschool: "축구교실",
};

async function loadAdminAnalytics() {
  const body = document.getElementById("admin-analytics-body");
  if (!body) return;
  body.textContent = "불러오는 중...";
  try {
    const data = await fetchJSON("/admin/analytics?days=7");
    if (!data.days?.length) {
      body.textContent = "데이터가 없습니다.";
      return;
    }
    body.innerHTML = data.days
      .map((d) => {
        const totalViews = Object.values(d.views).reduce((a, b) => a + b, 0);
        const topViews = Object.entries(d.views)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([k, v]) => `${VIEW_LABELS[k] || k} ${v}`)
          .join(" · ");
        const events = ["signup", "login", "checkin"].map((k) => `${k === "signup" ? "가입" : k === "login" ? "로그인" : "집관인증"} ${d.events[k] || 0}`).join(" · ");
        return `
          <div class="admin-analytics-row">
            <div class="admin-analytics-date">${d.date} <span class="admin-analytics-total">조회 ${totalViews}회</span></div>
            <div class="admin-analytics-detail">${topViews || "—"}</div>
            <div class="admin-analytics-detail">${events}</div>
          </div>
        `;
      })
      .join("");
  } catch (err) {
    body.textContent = `불러오기 실패: ${err.message}`;
  }
}

// 설정 탭 진입 버튼 - 관리자가 아니면 아예 안 보인다.
function syncAdminLinkVisibility() {
  const link = document.getElementById("admin-page-link");
  if (!link) return;
  const isAdmin = getCurrentUser()?.progress?.level === 99;
  link.style.display = isAdmin ? "block" : "none";
}

export function openAdminPage() {
  const user = getCurrentUser();
  document.getElementById("admin-test-username").placeholder = `보낼 아이디 (기본: ${user?.username || ""})`;
  pushDetail("admin");
  loadAdminAnalytics();
  loadAdminReports();
}

document.getElementById("admin-page-open-btn")?.addEventListener("click", openAdminPage);

syncAdminLinkVisibility();
onAuthChange(syncAdminLinkVisibility);
