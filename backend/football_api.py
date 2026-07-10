import time

import httpx
from fastapi import HTTPException

from config import FOOTBALL_API_BASE, FOOTBALL_API_KEY

# football-data.org 무료 티어는 분당 10회 요청 제한 -> 짧은 TTL 캐시로 보호
_CACHE: dict[str, tuple[float, dict]] = {}
CACHE_TTL_SECONDS = 60


def _is_valid_key(key: str) -> bool:
    return bool(key) and key.isascii()


async def _get(path: str, params: dict | None = None) -> dict:
    cache_key = f"{path}?{params}"
    now = time.time()

    cached = _CACHE.get(cache_key)
    if cached and now - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]

    if not _is_valid_key(FOOTBALL_API_KEY):
        raise HTTPException(
            status_code=503,
            detail="FOOTBALL_API_KEY가 설정되지 않았습니다. .env 파일에 football-data.org에서 발급받은 API 키를 입력하세요.",
        )

    headers = {"X-Auth-Token": FOOTBALL_API_KEY}
    url = f"{FOOTBALL_API_BASE}{path}"

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get(url, headers=headers, params=params)
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"football-data.org 연결 실패: {exc}") from exc

    if resp.status_code == 429:
        # 요청 제한에 걸리면 오래된 캐시라도 있으면 그걸 반환
        if cached:
            return cached[1]
        raise HTTPException(status_code=429, detail="football-data.org 요청 제한(분당 10회)을 초과했습니다. 잠시 후 다시 시도하세요.")

    if resp.status_code == 403:
        raise HTTPException(status_code=403, detail="football-data.org API 키가 유효하지 않거나 해당 리소스에 접근 권한이 없습니다.")

    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=f"football-data.org 오류: {resp.text}")

    data = resp.json()
    _CACHE[cache_key] = (now, data)
    return data


async def get_competitions() -> dict:
    return await _get("/competitions")


async def get_matches(date_from: str, date_to: str, competitions: str | None = None, status: str | None = None) -> dict:
    params = {"dateFrom": date_from, "dateTo": date_to}
    if competitions:
        params["competitions"] = competitions
    if status:
        params["status"] = status
    return await _get("/matches", params)


async def get_match(match_id: int) -> dict:
    return await _get(f"/matches/{match_id}")


async def get_standings(competition_code: str) -> dict:
    return await _get(f"/competitions/{competition_code}/standings")
