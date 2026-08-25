// PITCH PRO는 별도 빌드 과정이 없는 순수 정적 사이트라(Cloudflare Worker가 frontend/ 폴더를 그대로
// 서빙함), 앱인토스가 기대하는 "web.commands.build -> outdir" 구조를 맞추기 위해 그 정적 파일들을
// 그대로 dist/에 복사만 한다.
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild"); // 루트 프로젝트 node_modules에서 resolve됨(wrangler의 전이 의존성)

const SRC = path.resolve(__dirname, "..", "frontend");
const DEST = path.resolve(__dirname, "dist");

fs.rmSync(DEST, { recursive: true, force: true });
fs.cpSync(SRC, DEST, { recursive: true });

// 토스 미니앱 브랜딩 가이드가 하단 탭바를 "플로팅" 형태로 요구해서(2026-08-18 심사 반려), 이 빌드의
// index.html에만 표시를 심어둔다 - style.css의 html[data-toss-app] 규칙이 이 표시가 있을 때만 켜지므로
// 원본 frontend/(일반 웹/PWA/안드로이드)는 그대로 두고 앱인토스 빌드에만 플로팅 탭바가 적용된다.
const indexPath = path.join(DEST, "index.html");
let indexHtml = fs.readFileSync(indexPath, "utf8");
indexHtml = indexHtml.replace("<html lang=\"ko\">", '<html lang="ko" data-toss-app="1">');

// 2026-08-22 07:32(7b0d29b)에 이미 한 번 확인한 문제다: toss-notifications.js를 로드하면 앱인토스
// 미니앱 전체가 먹통이 된다(경기/뉴스 등 전부, 알림만이 아니라). 그때 스크립트 태그 주입을 뺐었는데,
// 6분 뒤(5515914 -> 96baf1e, "경기별 알림 워치" 기능) 다시 들어가면서 버그가 재발했다(2026-08-25
// 재확인 - 8/20 이전 빌드만 정상 작동, 이후 빌드는 전부 로딩 중 멈춤). "테스트 채널이 불안정해서"라는
// 그 사이의 결론은, 이 되돌림 전/후 빌드가 섞여서 테스트되며 생긴 착시였다. 원인(SDK 초기화 코드가
// 페이지 전체를 깨뜨리는 이유) 자체는 아직 못 찾았으니, 번들은 만들어두되(esbuild는 유지, 나중에
// 다시 붙일 때 참고용) 로드는 하지 않는다 - 토스 자체 알림/워치 기능이 빠지는 게, 앱 전체가 먹통인
// 것보다 훨씬 낫다. push.js의 tryTossNotify/tryTossWatchMatch는 window.__pitchProToss* 함수가
// 없으면 안전하게 false를 돌려주도록 이미 만들어져 있어 이 스크립트 없이도 나머지는 정상 동작한다.
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "src", "toss-notifications.js")],
  bundle: true,
  format: "esm",
  target: "es2020",
  outfile: path.join(DEST, "js", "toss-notifications.js"),
});

fs.writeFileSync(indexPath, indexHtml);

console.log(`copied ${SRC} -> ${DEST}`);
