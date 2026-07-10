# Soccer Live ⚽

FotMob 스타일의 축구 라이브 스코어 웹앱. FastAPI 백엔드 + 순수 HTML/CSS/JS 프론트엔드.
데이터는 [football-data.org](https://www.football-data.org) 무료 API를 사용합니다.

## 구성

```
축구앱/
├── backend/
│   ├── main.py           # FastAPI 앱 (API + 프론트 정적 서빙)
│   ├── config.py         # .env 설정 로더, 무료 티어 대회 목록
│   ├── football_api.py   # football-data.org 클라이언트 (+60초 캐시)
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── style.css         # 축구장(그린/다크) 테마
│   └── app.js            # 화면 전환 + API 연동
├── .env                  # API 키 (git 제외)
└── .env.example
```

## 1. API 키 발급

1. https://www.football-data.org/client/register 에서 무료 가입
2. 발급받은 키를 `.env` 파일의 `FOOTBALL_API_KEY` 값에 붙여넣기

```
FOOTBALL_API_KEY=발급받은_키
```

무료 티어는 **분당 10회** 요청 제한이 있어 백엔드에서 응답을 60초간 캐시합니다.
지원 대회: 프리미어리그, 라리가, 분데스리가, 세리에A, 리그1, 챔피언스리그, 월드컵 등 12개 대회.

## 2. 실행 방법 (Windows PowerShell)

```powershell
cd C:\Users\EST\Desktop\축구앱\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

브라우저에서 **http://localhost:8000** 접속.

## 기능

- **라이브 스코어**: 날짜별 경기 목록, 대회별 그룹핑, LIVE 상태 실시간 표시(새로고침 시)
- **순위**: 대회 선택 후 리그 순위표 (챔스 진출권/강등권 색상 표시)
- **경기 상세**: 경기 클릭 시 스코어보드, 경기장, 심판, 전반전 스코어 표시

## API

| Method | Path                          | 설명                          |
|--------|-------------------------------|-------------------------------|
| GET    | `/api/competitions`           | 지원 대회 목록                |
| GET    | `/api/matches?date=YYYY-MM-DD`| 해당 날짜 경기 목록           |
| GET    | `/api/matches/{id}`           | 경기 상세                     |
| GET    | `/api/standings/{code}`       | 대회 순위표 (예: PL, PD, BL1) |

## 참고

- API 키가 없거나 잘못된 경우 프론트엔드에 에러 메시지가 표시됩니다.
- `.env`는 git에 커밋되지 않도록 `.gitignore`에 포함되어 있습니다.
