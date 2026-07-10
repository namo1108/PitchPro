const API = "/api";

export async function fetchJSON(path) {
  const res = await fetch(`${API}${path}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || "요청 실패");
  }
  return data;
}
