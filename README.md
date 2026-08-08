# PITCH PRO ⚽

FotMob 스타일의 축구 라이브 스코어 웹앱. Cloudflare Workers(정적 자산 + API + KV 캐시) 하나로 배포된다.
데이터는 [API-Football](https://www.api-football.com)(해외 12개 대회 + K리그1·2, 라이브 이벤트/스코어러/라인업/스쿼드 전체), [BBC Sport RSS](https://www.bbc.co.uk/sport/football)(뉴스)를 사용한다.

## 구성

```
축구앱/
├── src/
│   ├── index.js              # fetch()/scheduled() 엔트리
│   ├── router.js             # /api/* 라우팅
│   ├── lib/                  # config, KV 헬퍼, push(VAPID), analysis(규칙 기반 분석)
│   ├── sources/               # API-Football / BBC RSS fetch 클라이언트
│   ├── adapters/              # API-Football 응답 -> 공통(canonical) 형태 변환
│   ├── scheduled/             # Cron이 KV를 채우는 작업들(경기/순위/뉴스/골 알림)
│   └── routes/                # /api/* 핸들러
├── frontend/
│   ├── index.html             # 하단 탭 5개(경기/뉴스/리그/AI 분석/나의 팀)
│   ├── style.css
│   ├── favicon.svg
│   ├── manifest.json
│   ├── sw.js                  # 푸시 알림 서비스워커
│   ├── img/stadium.png        # 배경 이미지
│   └── js/                    # ES 모듈(app.js, router.js, favorites.js, watchlist.js, push.js, views/*)
├── backend/                   # (레거시) 기존 FastAPI 버전 — Worker 안정화 후 제거 예정
├── wrangler.jsonc
├── package.json
├── .dev.vars                  # 로컬 시크릿(git 제외) — .dev.vars.example 참고
└── .env                       # 레거시 Python 백엔드용(git 제외)
```

## 기능 / 하단 탭

- **경기**: 날짜별 경기 목록(대회별 그룹핑), 주요 경기 히어로 카드, 라이브 경과 시간, 골 시 인앱 토스트+효과음, 팀 클릭 시 팀 상세로 이동
- **최신뉴스**: BBC Sport 축구 RSS 요약(20분 주기 갱신)
- **리그**: 대회별 순위표
- **AI 분석**: LLM 호출 없이, 캐시된 최근 경기/순위 데이터로 규칙 기반 분석 문장을 생성(무료)
- **나의 팀**: 팀 상세에서 ★로 즐겨찾기(브라우저 `localStorage`), 다음 경기·최근 폼 요약 + 골 발생 시 푸시 알림(팀 단위 또는 경기별 🔔로 개별 지정)
- **팀 상세**: 최근 경기, 경기 일정, 전체 스쿼드, 상대전적(실제 역대 맞대결)
- **선수 상세**: 프로필, 시즌별 스탯(출전/득점/도움), 이적 히스토리
- **경기 상세**: 실시간 경과 분, 득점자·도움 목록(라이브/종료 경기)

## 캐싱 구조

FastAPI 버전의 인메모리 캐시는 Workers의 요청별 격리 환경에 맞지 않아, **Cron Trigger가 5분마다 KV를 채우고 사용자 요청은 KV만 읽는 구조**로 바꿨다. 경기 목록은 매 tick(5분)마다 대회별로 갱신하고, 순위표는 30분 주기, 뉴스는 20분 주기로 내부에서 자체적으로 조절한다. 상세 경기/팀/선수 정보는 목록 응답에 없는 필드(득점자, 스쿼드, 이적 등)가 있어 클릭 시점에 온디맨드로 불러와 캐싱한다. 팀 상세는 업스트림 장애 시 마지막으로 성공한 응답을 대체로 보여준다(`stale: true` 플래그).

## 1. 로컬 개발

```powershell
npm install
copy .dev.vars.example .dev.vars   # 아래 키를 채워 넣기
npm run dev                        # wrangler dev, http://localhost:8787
```

`.dev.vars`:
```
API_FOOTBALL_KEY=api-football.com(api-sports.io)에서 발급받은 키
VAPID_PUBLIC_KEY=                   # 아래 "골 알림 설정" 참고
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com
```

로컬 개발 중에는 Cron이 자동으로 돌지 않으므로, 아래로 수동 트리거해서 KV를 채운다:
```powershell
curl "http://127.0.0.1:8787/cdn-cgi/handler/scheduled"
```

## 2. API-Football 연동

[api-football.com](https://www.api-football.com)(api-sports.io) 유료(Pro) 플랜 키로 해외 12개 대회 + K리그1·2를 한 소스로 통합했다. 무료 플랜은 라인업/이벤트/라인업 등 상세 데이터가 제한적이라, 실시간 경과 시간·득점자·전체 스쿼드·실제 상대전적을 쓰려면 유료 플랜이 필요하다(가입: [api-football.com/pricing](https://www.api-football.com/pricing)).

대회-리그 ID 매핑과 시즌 연도는 `src/lib/config.js`의 `COMPETITIONS`에 있다. 리그마다 시즌 회계연도가 달라(유럽 리그는 8월 시작, K리그/월드컵은 역년) `apiFootballSeason` 값을 시즌이 바뀔 때마다 수동 갱신해야 한다. 분당 요청 한도(Pro 플랜 300회/분)에 순간적으로 걸리는 경우 `src/sources/apiFootball.js`가 짧게 한 번 재시도한다.

## 3. 골 알림(Web Push) 설정

VAPID 키를 한 번 생성해야 한다(무료, 별도 서비스 가입 불필요):

```powershell
node --input-type=module -e "import {generateVapidKeys,serializeVapidKeys} from 'web-push-browser'; console.log(JSON.stringify(await serializeVapidKeys(await generateVapidKeys())))"
```

출력된 `publicKey`/`privateKey`를 `.dev.vars`(로컬)와 아래 시크릿(운영)에 채운다. 사용자가 "나의 팀" 탭에서 골 알림을 켜면 브라우저가 구독 정보를 `/api/push/subscribe`로 보내고, 5분 Cron마다 이전 스코어와 비교해 골이 감지되면 즐겨찾기한 팀(또는 🔔로 개별 지정한 경기)의 구독자에게만 득점자 이름을 포함해 푸시를 보낸다(`src/scheduled/detectGoalsAndNotify.js`). 즐겨찾기를 나중에 추가/삭제해도 이미 구독 중이면 자동으로 서버에 다시 동기화된다.

## 4. Cloudflare 배포

```powershell
npx wrangler login                              # Cloudflare 계정 인증(브라우저)
npx wrangler kv namespace create CACHE          # 출력된 id를 wrangler.jsonc의 kv_namespaces[0].id에 반영
npx wrangler secret put API_FOOTBALL_KEY
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
npx wrangler deploy
```

GitHub에 push한 뒤 Cloudflare 대시보드 **Workers Builds**에서 저장소를 연결하면, 이후 push마다 자동 빌드·배포된다.

## 5. 구글플레이(TWA) 배포

이 PWA를 [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)으로 감싸서 Android 앱(TWA)으로 만든다.

```powershell
npm install -g @bubblewrap/cli
bubblewrap init --manifest="https://<배포된 도메인>/manifest.json"   # 서명 키(keystore) 생성 + SHA-256 지문 출력
bubblewrap build                                                     # .aab 빌드
```

`bubblewrap init`이 출력하는 `sha256_cert_fingerprints` 값과 선택한 패키지명을
`frontend/.well-known/assetlinks.json`의 `REPLACE_WITH_TWA_PACKAGE_NAME` / `REPLACE_WITH_SHA256_CERT_FINGERPRINT`에 반영하고
다시 배포해야 앱이 브라우저 주소창 없는 전체화면(TWA)으로 열린다(Digital Asset Links 검증).
반영 후 `https://<배포된 도메인>/.well-known/assetlinks.json`으로 실제 값이 나오는지 꼭 확인할 것.

## API

| Method | Path                          | 설명                                    |
|--------|-------------------------------|-----------------------------------------|
| GET    | `/api/health`                 | 각 캐시의 마지막 갱신 시각               |
| GET    | `/api/competitions`           | 지원 대회 목록(해외 12개 + K리그1·2)     |
| GET    | `/api/matches?date=YYYY-MM-DD`| 해당 날짜 경기 목록(캐시된 -3~+7일 범위)  |
| GET    | `/api/matches/{id}`           | 경기 상세(경과 시간, 득점자/도움 목록)    |
| GET    | `/api/standings/{code}`       | 대회 순위표 (예: PL, PD, BL1, KL1, KL2)  |
| GET    | `/api/teams/{id}`              | 팀 상세(최근/예정 경기, 전체 스쿼드)     |
| GET    | `/api/players/{id}`            | 선수 상세(프로필, 시즌별 스탯, 이적 히스토리) |
| GET    | `/api/head2head?a=&b=`         | 두 팀 실제 상대전적                      |
| GET    | `/api/news`                     | 최신 뉴스(BBC Sport RSS 요약)            |
| GET    | `/api/analysis`                 | 다가오는 경기 AI 분석 카드               |
| GET    | `/api/push/vapid-public-key`     | 푸시 구독용 공개 키                       |
| POST   | `/api/push/subscribe`            | 푸시 구독 등록(구독 정보 + 관심 팀 id)    |
| POST   | `/api/push/unsubscribe`          | 푸시 구독 해제                           |
| POST   | `/api/push/watch-match`          | 특정 경기 골 알림 개별 on/off            |

## 참고

- API 키가 없거나 잘못된 경우 프론트엔드에 에러 메시지가 표시됩니다.
- `.env`/`.dev.vars`는 git에 커밋되지 않도록 `.gitignore`에 포함되어 있습니다.
- 즐겨찾기/경기별 알림 설정은 브라우저 `localStorage`에만 저장되어 기기 간 동기화되지 않습니다.
