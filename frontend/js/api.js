const API = "/api";
// 앱(TWA) 등 일부 환경에서 요청이 응답도 에러도 없이 그냥 멈춰버리는 경우가 보고돼서(예: 로그인
// 버튼이 계속 "보내는 중" 상태로 멈춤) - 이 시간이 지나도 안 끝나면 강제로 포기하고 에러를 던진다.
const TIMEOUT_MS = 15000;

// opts.token이 있으면 Authorization 헤더를 실어 보낸다(로그인 전용 API용) - auth.js를 여기서 직접
// import하면 순환 참조가 생기니, 토큰은 호출부(auth.js)가 알아서 넣어주는 방식으로 분리한다.
export async function fetchJSON(path, opts = {}) {
  const { method = "GET", body, token } = opts;
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers["authorization"] = `Bearer ${token}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("서버 응답이 없어요. 네트워크 상태를 확인하고 다시 시도해주세요.");
    }
    throw new Error("네트워크 요청에 실패했어요. 인터넷 연결을 확인해주세요.");
  } finally {
    clearTimeout(timeoutId);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || "요청 실패");
  }
  return data;
}
