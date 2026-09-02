import { escapeHtml } from "./format.js";
import { authFetch } from "./auth.js";

// 글/댓글 textarea에 "@닉네임" 자동완성을 붙인다(인스타그램 스타일) - 커서 바로 앞이 "@뭔가"
// 패턴이면 그 "뭔가"로 실제 가입된 닉네임을 검색해서 드롭다운으로 보여주고, 고르면 "@닉네임 "으로
// 커서 위치에 그대로 끼워넣는다. textarea/results 엘리먼트만 있으면 어디서든(글쓰기 본문, 댓글
// 입력창) 재사용할 수 있게 분리했다.
export function setupMentionAutocomplete(textareaEl, resultsEl) {
  if (!textareaEl || !resultsEl) return;

  let timer = null;
  let requestId = 0;

  function currentQuery() {
    const cursor = textareaEl.selectionStart;
    const before = textareaEl.value.slice(0, cursor);
    const m = before.match(/(?:^|\s)@([^\s@]*)$/);
    return m ? m[1] : null;
  }

  function close() {
    resultsEl.innerHTML = "";
  }

  function pick(nickname) {
    const cursor = textareaEl.selectionStart;
    const before = textareaEl.value.slice(0, cursor);
    const after = textareaEl.value.slice(cursor);
    const replaced = before.replace(/@([^\s@]*)$/, `@${nickname} `);
    textareaEl.value = replaced + after;
    const newCursor = replaced.length;
    close();
    textareaEl.focus();
    textareaEl.setSelectionRange(newCursor, newCursor);
  }

  function render(users) {
    if (!users.length) {
      resultsEl.innerHTML = '<div class="team-search-empty">일치하는 닉네임이 없습니다.</div>';
      return;
    }
    resultsEl.innerHTML = users
      .map(
        (u) => `
      <div class="team-search-row" data-nickname="${escapeHtml(u.nickname)}">
        <span class="team-search-name">${escapeHtml(u.nickname)}</span>
        <span class="team-search-comp">Lv.${u.level}</span>
      </div>
    `
      )
      .join("");
    // click이 아니라 mousedown에서 고르고 preventDefault로 막는다 - click까지 기다리면 그 전에
    // textarea가 먼저 blur돼서 드롭다운이 닫혀버린 뒤라 클릭이 씹힌다.
    resultsEl.querySelectorAll("[data-nickname]").forEach((row) => {
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pick(row.dataset.nickname);
      });
    });
  }

  textareaEl.addEventListener("input", () => {
    const query = currentQuery();
    clearTimeout(timer);
    if (query === null || query.length < 1) {
      requestId++;
      close();
      return;
    }
    const myRequestId = ++requestId;
    timer = setTimeout(async () => {
      try {
        const data = await authFetch(`/users/search?q=${encodeURIComponent(query)}`);
        if (myRequestId !== requestId) return;
        render(data.users || []);
      } catch {
        if (myRequestId === requestId) close();
      }
    }, 250);
  });

  // 드롭다운 바깥을 클릭/포커스아웃하면 닫는다 - mousedown+preventDefault로 이미 처리되는 선택
  // 클릭 케이스와 안 겹치게 살짝 지연을 둔다.
  textareaEl.addEventListener("blur", () => setTimeout(close, 150));
}
