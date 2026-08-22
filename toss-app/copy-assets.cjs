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

// 2026-08-22: 이 번들을 처음 끼워 넣었을 때 앱인토스 "테스트" 배포에서 경기/뉴스 화면이 전부
// 먹통이 되는 게 여러 번 재현됐는데, push.js/matches.js 쪽 변경을 하나씩/조합별로 매우 여러 번
// 비교 테스트해봐도 특정 조합에서만, 그마저도 동일한 코드에서 결과가 오락가락해서 - "테스트" 배포
// 채널 자체의 신뢰성 문제일 가능성이 높다고 결론 내렸다(정식 "출시" 채널로 최종 검증 필요).
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "src", "toss-notifications.js")],
  bundle: true,
  format: "esm",
  target: "es2020",
  outfile: path.join(DEST, "js", "toss-notifications.js"),
});
indexHtml = indexHtml.replace(
  '<script type="module" src="/js/app.js"></script>',
  '<script type="module" src="/js/toss-notifications.js"></script>\n  <script type="module" src="/js/app.js"></script>'
);

fs.writeFileSync(indexPath, indexHtml);

console.log(`copied ${SRC} -> ${DEST}`);
