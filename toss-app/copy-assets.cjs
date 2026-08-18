// PITCH PRO는 별도 빌드 과정이 없는 순수 정적 사이트라(Cloudflare Worker가 frontend/ 폴더를 그대로
// 서빙함), 앱인토스가 기대하는 "web.commands.build -> outdir" 구조를 맞추기 위해 그 정적 파일들을
// 그대로 dist/에 복사만 한다.
const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "..", "frontend");
const DEST = path.resolve(__dirname, "dist");

fs.rmSync(DEST, { recursive: true, force: true });
fs.cpSync(SRC, DEST, { recursive: true });

// 토스 미니앱 브랜딩 가이드가 하단 탭바를 "플로팅" 형태로 요구해서(2026-08-18 심사 반려), 이 빌드의
// index.html에만 표시를 심어둔다 - style.css의 html[data-toss-app] 규칙이 이 표시가 있을 때만 켜지므로
// 원본 frontend/(일반 웹/PWA/안드로이드)는 그대로 두고 앱인토스 빌드에만 플로팅 탭바가 적용된다.
const indexPath = path.join(DEST, "index.html");
const indexHtml = fs.readFileSync(indexPath, "utf8");
fs.writeFileSync(indexPath, indexHtml.replace("<html lang=\"ko\">", '<html lang="ko" data-toss-app="1">'));

console.log(`copied ${SRC} -> ${DEST}`);
