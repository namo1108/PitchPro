import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

FOOTBALL_API_KEY = os.getenv("FOOTBALL_API_KEY", "")
FOOTBALL_API_BASE = os.getenv("FOOTBALL_API_BASE", "https://api.football-data.org/v4")

if not FOOTBALL_API_KEY:
    print("[WARN] FOOTBALL_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.")

# football-data.org 무료 티어(Tier One)에서 접근 가능한 주요 대회 코드
FREE_TIER_COMPETITIONS = [
    {"code": "PL", "name": "Premier League", "emblem": "🏴󠁧󠁢󠁥󠁮󠁧󠁿"},
    {"code": "PD", "name": "La Liga", "emblem": "🇪🇸"},
    {"code": "BL1", "name": "Bundesliga", "emblem": "🇩🇪"},
    {"code": "SA", "name": "Serie A", "emblem": "🇮🇹"},
    {"code": "FL1", "name": "Ligue 1", "emblem": "🇫🇷"},
    {"code": "DED", "name": "Eredivisie", "emblem": "🇳🇱"},
    {"code": "PPL", "name": "Primeira Liga", "emblem": "🇵🇹"},
    {"code": "ELC", "name": "Championship", "emblem": "🏴󠁧󠁢󠁥󠁮󠁧󠁿"},
    {"code": "BSA", "name": "Brasileirão", "emblem": "🇧🇷"},
    {"code": "CL", "name": "Champions League", "emblem": "⭐"},
    {"code": "WC", "name": "World Cup", "emblem": "🌍"},
    {"code": "EC", "name": "European Championship", "emblem": "🏆"},
]
