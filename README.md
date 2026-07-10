# PITCH PRO ⚽

FotMob 스타일의 축구 라이브 스코어 웹앱. Cloudflare Workers(정적 자산 + API + KV 캐시) 하나로 배포된다.
데이터는 [football-data.org](https://www.football-data.org)(해외 12개 대회), [TheSportsDB](https://www.thesportsdb.com)(K리그1·2, 스쿼드), [BBC Sport RSS](https://www.bbc.co.uk/sport/football)(뉴스)를 사용한다.

## 구성

```
축구앱/
├── src/
│   ├── index.js              # fetch()/scheduled() 엔트리
│   ├── router.js             # /api/* 라우팅
│   ├── lib/                  # config, KV 헬퍼, push(VAPID), analysis(규칙 기반 분석)
│   ├── sources/               # football-data.org / TheSportsDB / BBC RSS fetch 클라이언트
│   ├── adapters/              # 각 소스 응답 -> 공통(canonical) 형태 변환
│   ├── scheduled/             # Cron이 KV를 채우는 작업들(경기/순위/뉴스/골 알림)
│   └── routes/                # /api/* 핸들러
├── frontend/
│   ├── index.html             # 하단 탭 5개(경기/뉴스/리그/AI 분석/나의 팀)
│   ├── style.css
│   ├── favicon.svg            # "P" 모노그램
│   ├── manifest.json
│   ├── sw.js                  # 푸시 알림 서비스워커
│   └── js/                    # ES 모듈(app.js, router.js, favorites.js, push.js, views/*)
├── backend/                   # (레거시) 기존 FastAPI 버전 — Worker 안정화 후 제거 예정
├── wrangler.jsonc
├── package.json
├── .dev.vars                  # 로컬 시크릿(git 제외) — .dev.vars.example 참고
└── .env                       # 레거시 Python 백엔드용(git 제외)
```

## 기능 / 하단 탭

- **경기**: 날짜별 경기 목록(대회별 그룹핑), LIVE 표시, 팀 클릭 시 팀 상세로 이동
- **최신뉴스**: BBC Sport 축구 RSS 요약(15~20분 주기 갱신)
- **리그**: 대회별 순위표
- **AI 분석**: LLM 호출 없이, 캐시된 최근 경기/순위 데이터로 규칙 기반 분석 문장을 생성(무료)
- **나의 팀**: 팀 상세에서 ★로 즐겨찾기(브라우저 `localStorage`), 다음 경기·최근 폼 요약 + 골 발생 시 푸시 알림
- **팀 상세**: 최근 경기, 경기 일정, 스쿼드(TheSportsDB), 상대전적(가능한 경우)

두 API의 무료 티어 한계로 라인업·실시간 이벤트·xG 등 FotMob 수준의 상세 통계는 지원하지 않는다.

## 캐싱 구조

FastAPI 버전의 인메모리 캐시는 Workers의 요청별 격리 환경에 맞지 않아, **Cron Trigger가 5분마다 KV를 채우고 사용자 요청은 KV만 읽는 구조**로 바꿨다. football-data.org(10회/분 한도)는 매 tick마다, TheSportsDB(공유 테스트 키 기준 분당 30회 한도)는 15분(경기 목록)·1시간(순위) 주기로, 뉴스는 20분 주기로 내부에서 자체적으로 조절한다. 상세 경기/팀 정보는 목록 응답에 없는 필드가 있어 클릭 시점에 온디맨드로 불러와 5~10분 캐싱한다.

## 1. 로컬 개발

```powershell
npm install
copy .dev.vars.example .dev.vars   # 아래 키를 채워 넣기
npm run dev                        # wrangler dev, http://localhost:8787
```

`.dev.vars`:
```
FOOTBALL_DATA_API_KEY=football-data.org에서 발급받은 키
THESPORTSDB_API_KEY=                # 비워두면 공개 테스트 키("3")를 씀
VAPID_PUBLIC_KEY=                   # 아래 "골 알림 설정" 참고
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com
```

로컬 개발 중에는 Cron이 자동으로 돌지 않으므로, 아래로 수동 트리거해서 KV를 채운다:
```powershell
curl "http://127.0.0.1:8787/cdn-cgi/handler/scheduled"
```

## 2. K리그1·2 연동

[TheSportsDB](https://www.thesportsdb.com) 무료 API로 연동되어 있다. 공개 테스트 키("3")는 **회원가입 없이** 바로 쓸 수 있고(분당 30회, 전 세계가 공유하는 한도), 실제 배포 시에는 [무료 회원가입](https://www.thesportsdb.com/free_sports_api)으로 본인 키를 받아 `THESPORTSDB_API_KEY`에 넣는 걸 권장한다(공유 키 부하를 줄이기 위함 — 비용은 여전히 무료).

리그 ID는 `search_all_leagues.php?c=South Korea`로 확인해 `src/lib/config.js`에 이미 반영되어 있다: K리그1 = `4689`, K리그2 = `4822`. `eventsseason.php`는 공유 키에서 시즌 1라운드만 주는 것으로 확인되어, 대신 `eventsnextleague.php`/`eventspastleague.php`로 현재 라운드를 알아낸 뒤 `eventsround.php`로 그 주변 라운드를 가져온다(`src/scheduled/refreshKLeagueMatches.js`). `K_LEAGUE_SEASON`(config.js)은 시즌이 바뀔 때마다(대략 연 1회) 수동 갱신 필요.

> football-data.org는 K리그를 지원하지 않고, API-Football(api-sports.io)은 무료 플랜이 2022~2024 시즌만 허용해(현재 시즌 접근 불가) 채택하지 않았다.

## 3. 골 알림(Web Push) 설정

VAPID 키를 한 번 생성해야 한다(무료, 별도 서비스 가입 불필요):

```powershell
node --input-type=module -e "import {generateVapidKeys,serializeVapidKeys} from 'web-push-browser'; console.log(JSON.stringify(await serializeVapidKeys(await generateVapidKeys())))"
```

출력된 `publicKey`/`privateKey`를 `.dev.vars`(로컬)와 아래 시크릿(운영)에 채운다. 사용자가 "나의 팀" 탭에서 골 알림을 켜면 브라우저가 구독 정보를 `/api/push/subscribe`로 보내고, 5분 Cron마다 이전 스코어와 비교해 골이 감지되면 즐겨찾기한 팀의 구독자에게만 푸시를 보낸다(`src/scheduled/detectGoalsAndNotify.js`).

## 4. Cloudflare 배포

```powershell
npx wrangler login                              # Cloudflare 계정 인증(브라우저)
npx wrangler kv namespace create CACHE          # 출력된 id를 wrangler.jsonc의 kv_namespaces[0].id에 반영
npx wrangler secret put FOOTBALL_DATA_API_KEY
npx wrangler secret put THESPORTSDB_API_KEY     # 본인 키를 받았다면(선택)
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
npx wrangler deploy
```

GitHub에 push한 뒤 Cloudflare 대시보드 **Workers Builds**에서 저장소를 연결하면, 이후 push마다 자동 빌드·배포된다.

## API

| Method | Path                          | 설명                                    |
|--------|-------------------------------|-----------------------------------------|
| GET    | `/api/health`                 | 각 캐시의 마지막 갱신 시각               |
| GET    | `/api/competitions`           | 지원 대회 목록(해외 12개 + K리그1·2)     |
| GET    | `/api/matches?date=YYYY-MM-DD`| 해당 날짜 경기 목록(캐시된 -3~+7일 범위)  |
| GET    | `/api/matches/{id}`           | 경기 상세(`fd:` 또는 `kl:` 접두사 id)     |
| GET    | `/api/standings/{code}`       | 대회 순위표 (예: PL, PD, BL1, KL1, KL2)  |
| GET    | `/api/teams/{id}`              | 팀 상세(최근/예정 경기, 스쿼드)          |
| GET    | `/api/head2head?a=&b=`         | 두 팀 상대전적(가능한 경우, `limited` 플래그) |
| GET    | `/api/news`                     | 최신 뉴스(BBC Sport RSS 요약)            |
| GET    | `/api/analysis`                 | 다가오는 경기 AI 분석 카드               |
| GET    | `/api/push/vapid-public-key`     | 푸시 구독용 공개 키                       |
| POST   | `/api/push/subscribe`            | 푸시 구독 등록(구독 정보 + 관심 팀 id)    |
| POST   | `/api/push/unsubscribe`          | 푸시 구독 해제                           |

## 참고

- API 키가 없거나 잘못된 경우 프론트엔드에 에러 메시지가 표시됩니다.
- `.env`/`.dev.vars`는 git에 커밋되지 않도록 `.gitignore`에 포함되어 있습니다.
- 즐겨찾기는 브라우저 `localStorage`에만 저장되어 기기 간 동기화되지 않습니다.
