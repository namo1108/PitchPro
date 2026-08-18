import { defineConfig } from "@apps-in-toss/web-framework/config";

// appName은 콘솔에서 실제로 등록한 "appName"(수정 불가 고유 ID)과 반드시 똑같아야 한다 -
// 다르면 배포 단계에서 거부된다. "pitchpro"가 이미 사용 중이라 다른 값으로 등록했다면 여기도 맞춰야 함.
// 별도 번들러가 없는 정적 사이트라(Cloudflare Worker가 frontend/를 그대로 서빙), `npm run build`
// (copy-assets.cjs)로 frontend/ 내용을 미리 dist/에 복사해두고 webBundleDir로 그 경로만 알려준다.
export default defineConfig({
  appName: "pitchpro",
  brand: {
    primaryColor: "#24e583", // frontend/style.css의 --accent와 동일
  },
  permissions: [],
  webBundleDir: "dist",
});
