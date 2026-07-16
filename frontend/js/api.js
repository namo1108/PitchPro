const API = "/api";

// opts.token이 있으면 Authorization 헤더를 실어 보낸다(로그인 전용 API용) - auth.js를 여기서 직접
// import하면 순환 참조가 생기니, 토큰은 호출부(auth.js)가 알아서 넣어주는 방식으로 분리한다.
export async function fetchJSON(path, opts = {}) {
  const { method = "GET", body, token } = opts;
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers["authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || "요청 실패");
  }
  return data;
}
