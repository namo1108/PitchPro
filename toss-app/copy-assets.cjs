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

// 세 번째로 확인한 문제(2026-08-22, 2026-08-25 x2): toss-notifications.js(@apps-in-toss/web-framework
// 번들, 알림+광고 SDK 공용)를 로드하면 앱인토스 미니앱 전체가 먹통이 된다. 2026-08-26엔 <script
// async>를 붙이면 문서 순서상 app.js를 안 기다리게 되니 괜찮을 거라 생각했는데도 여전히 먹통이었다
// - 즉 원인은 스크립트 "실행 순서"가 아니라, 이 SDK 코드가 실행되는 순간 JS 스레드 자체가(다른
// 스크립트까지 포함해서) 멈춰버리는 것으로 보인다(예: 네이티브 브릿지 동기 호출이 응답을 못 받고
// 계속 대기). async로는 못 피하는 종류의 문제라 이 정도 시도로는 답이 없다 - 원격 디버깅(chrome://
// inspect)으로 실제 정지 지점을 확인하기 전까지는 다시 시도하지 않는다. 번들 자체(esbuild)는 계속
// 만들어두되(다음에 참고용) 로드는 안 한다.
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "src", "toss-notifications.js")],
  bundle: true,
  format: "esm",
  target: "es2020",
  outfile: path.join(DEST, "js", "toss-notifications.js"),
});

fs.writeFileSync(indexPath, indexHtml);

console.log(`copied ${SRC} -> ${DEST}`);
