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

// 2026-08-22(7b0d29b)/2026-08-25 두 번이나 겪은 문제: toss-notifications.js(@apps-in-toss/web-framework
// 번들)를 로드하면 앱인토스 미니앱 전체가 먹통이 된다(경기/뉴스 등 전부, 알림만이 아니라) - 8/20
// 이전 빌드(이 태그가 없던 시점)만 정상 작동했고, 이후 빌드는 전부 로딩 중 멈췄다. 코드를 다시 보니
// window.__pitchProToss* 함수 정의 말고는 이 스크립트 자체는 즉시 실행되는 코드가 없다 - 그런데도
// 멈춘다는 건, import한 SDK 내부 어딘가(네이티브 브릿지 초기화 등)가 응답을 못 받고 계속 기다리는
// 상태에 빠진다는 뜻으로 보인다. 문제는 <script type="module">이 async 없이는 문서 순서대로
// 실행되도록 스펙에 정해져 있어서, 이 스크립트가 안 끝나면 뒤에 오는 app.js조차 실행을 못 하고
// 기다리게 된다 - 그래서 매번 "경기 화면도 안 뜬다"처럼 앱 전체가 죽는 것처럼 보였던 것.
// async를 붙이면 이 스크립트는 독립적으로 로드/실행되고, app.js는 기다리지 않고 바로 실행된다 -
// SDK가 여전히 멈추더라도 토스 알림 기능만 조용히 안 되고 나머지 앱은 정상 동작해야 한다(2026-08-26
// 재도입, "나의 팀" 자동 알림 + 광고 SDK가 같은 패키지를 필요로 해서 다시 붙임).
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "src", "toss-notifications.js")],
  bundle: true,
  format: "esm",
  target: "es2020",
  outfile: path.join(DEST, "js", "toss-notifications.js"),
});
indexHtml = indexHtml.replace(
  '<script type="module" src="/js/app.js"></script>',
  '<script type="module" async src="/js/toss-notifications.js"></script>\n  <script type="module" src="/js/app.js"></script>'
);

fs.writeFileSync(indexPath, indexHtml);

console.log(`copied ${SRC} -> ${DEST}`);
