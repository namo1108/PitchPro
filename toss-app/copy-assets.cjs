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

// toss-ads.js(TossAds만 import)는 2026-08-27에 단독 테스트에서 먹통 없이 정상 확인됐다 - 계속 로드.
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "src", "toss-ads.js")],
  bundle: true,
  format: "esm",
  target: "es2020",
  outfile: path.join(DEST, "js", "toss-ads.js"),
});

// toss-notifications.js(Notification/User)는 세 번(2026-08-22, 2026-08-25 x2) 로드할 때마다 미니앱
// 전체를 먹통으로 만들었다 - <script async>도 안 통했다. 그런데 그 세 번은 전부 다른 코드(광고 코드나
// 즐겨찾기 연동 등)와 한 파일에 섞여 있었다 - toss-ads.js가 단독으로는 문제없다고 확인된 지금, 이번엔
// Notification/User만 깨끗하게 단독으로 로드해서 정말 이 둘 자체가 원인인지 최종 확인한다
// (2026-08-27, 사용자 요청). 또 먹통이면 이제 "Notification/User가 범인"이라고 확정할 수 있다.
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "src", "toss-notifications.js")],
  bundle: true,
  format: "esm",
  target: "es2020",
  outfile: path.join(DEST, "js", "toss-notifications.js"),
});
indexHtml = indexHtml.replace(
  '<script type="module" src="/js/app.js"></script>',
  '<script type="module" async src="/js/toss-ads.js"></script>\n  <script type="module" async src="/js/toss-notifications.js"></script>\n  <script type="module" src="/js/app.js"></script>'
);

fs.writeFileSync(indexPath, indexHtml);

console.log(`copied ${SRC} -> ${DEST}`);
