import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import * as apiFootball from "../sources/apiFootball.js";

// 사진은 자주 안 바뀌니 길게 캐시해서(일주일) 같은 선수를 여러 번 요청해도 API 호출이 안 생기게 한다.
const PHOTO_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_IDS = 40;
const CONCURRENCY = 6;

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function getPlayerPhoto(env, id) {
  const cacheKey = `playerphoto:${id}`;
  const cached = await getJSON(env, cacheKey);
  if (cached !== null) return cached.photo;

  try {
    const raw = await apiFootball.getPlayerProfile(env, id);
    const photo = raw.response?.[0]?.player?.photo || null;
    await putJSON(env, cacheKey, { photo }, { expirationTtl: PHOTO_CACHE_TTL_SECONDS });
    return photo;
  } catch {
    return null; // 실패해도 캐시에 남기지 않아서 다음 요청 때 다시 시도해볼 수 있게 둔다.
  }
}

// 이적시장 목록(/transfers)의 API-Football 응답 자체에는 선수 사진이 없어서, 화면에서 실제로
// 펼쳐본 팀의 선수들만 이 엔드포인트로 따로, 필요한 만큼만 조회한다(전체를 한 번에 긁으면 선수 수만큼
// API 호출이 폭증하므로 지연 로딩 + 캐시로 비용을 아낀다).
export async function handlePlayerPhotos(request, env, url) {
  const idsParam = url.searchParams.get("ids") || "";
  const ids = [...new Set(idsParam.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, MAX_IDS);
  if (!ids.length) return json({ photos: {} });

  const photoList = await mapLimit(ids, CONCURRENCY, (id) => getPlayerPhoto(env, id));
  const photos = {};
  ids.forEach((id, i) => {
    photos[id] = photoList[i];
  });

  return json({ photos });
}
