from datetime import date, timedelta
from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

import football_api
from config import FREE_TIER_COMPETITIONS

app = FastAPI(title="Soccer Live API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

ALL_COMPETITION_CODES = ",".join(c["code"] for c in FREE_TIER_COMPETITIONS)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/competitions")
async def competitions():
    return {"competitions": FREE_TIER_COMPETITIONS}


@app.get("/api/matches")
async def matches(
    date_str: str | None = Query(default=None, alias="date"),
    competitions: str | None = Query(default=None),
):
    target_date = date_str or date.today().isoformat()
    codes = competitions or ALL_COMPETITION_CODES
    data = await football_api.get_matches(date_from=target_date, date_to=target_date, competitions=codes)
    return data


@app.get("/api/matches/range")
async def matches_range(days: int = Query(default=3, ge=1, le=7)):
    today = date.today()
    date_from = (today - timedelta(days=1)).isoformat()
    date_to = (today + timedelta(days=days - 1)).isoformat()
    data = await football_api.get_matches(date_from=date_from, date_to=date_to, competitions=ALL_COMPETITION_CODES)
    return data


@app.get("/api/matches/{match_id}")
async def match_detail(match_id: int):
    return await football_api.get_match(match_id)


@app.get("/api/standings/{competition_code}")
async def standings(competition_code: str):
    return await football_api.get_standings(competition_code)


app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/")
async def index():
    return FileResponse(FRONTEND_DIR / "index.html")
