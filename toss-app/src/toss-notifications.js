import { Notification, User } from "@apps-in-toss/web-framework";

// 콘솔 스마트 발송(기능성 캠페인)에 등록해둔 발송 코드 - src/lib/tossPush.js의 TOSS_TEMPLATE_CODE와 반드시 같아야 한다.
const TEMPLATE_CODE = "pitchpro-notify";
const API_BASE = "https://soccer-live.skagh662.workers.dev/api";

// frontend/js/favorites.js의 STORAGE_KEY와 반드시 같은 값이어야 한다 - 이 파일은 esbuild로 따로
// 번들링돼서 favorites.js를 직접 import하기 애매하니(순환/중복 번들 방지) 키 이름만 맞춰서 같은
// localStorage 값을 그대로 읽는다.
const FAVORITES_STORAGE_KEY = "pitchpro.favoriteTeams";

function readFavoriteTeamIds() {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    return raw ? JSON.parse(raw).map((t) => t.id) : [];
  } catch {
    return [];
  }
}

async function registerTossSubscription() {
  try {
    const { hash } = await User.getAnonymousKey();
    await fetch(`${API_BASE}/toss/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ anonKey: hash, teamIds: readFavoriteTeamIds() }),
    });
  } catch (err) {
    console.error("토스 알림 구독 등록 실패:", err);
  }
}

// push.js의 tryTossNotify()가 window에서 이 이름을 찾아 호출한다(일반 웹 빌드에는 이 스크립트
// 자체가 없어 함수도 없다 - toss-app/copy-assets.cjs가 앱인토스 빌드에만 이 파일을 esbuild로
// 번들링해서 끼워 넣는다).
window.__pitchProTossNotify = function requestTossNotificationAgreement() {
  if (!Notification.requestAgreement.isSupported()) return false;
  Notification.requestAgreement({
    options: { templateCode: TEMPLATE_CODE },
    onEvent: (result) => {
      // "alreadyAgreed"여도 다시 등록해준다 - anonKey 자체는 안 바뀌지만, 즐겨찾기 팀이 바뀐 뒤
      // 재호출된 경우일 수 있어 서버 teamIds를 다시 맞춰야 한다(favorites.js가 넘겨줄 예정).
      if (result.type === "newAgreement" || result.type === "alreadyAgreed") {
        registerTossSubscription();
      }
    },
    onError: (err) => console.error("토스 알림 동의 요청 실패:", err),
  });
  return true;
};

// 경기 화면의 🔔 벨(matches.js attachWatchBells)이 이 이름을 찾아 호출한다 - 즐겨찾기 팀과
// 무관하게 이 경기 하나만 콕 집어 알림받도록 서버(toss:sub:* 레코드의 matchIds)에 등록한다.
// 동의 화면이 아직 안 떴으면 여기서 같이 띄운다(웹 푸시의 setMatchWatch가 구독이 없으면 자동으로
// 만들어주는 것과 같은 역할) - Promise<boolean>으로 성공 여부를 돌려줘야 벨 UI가 실패 시 되돌릴 수 있다.
window.__pitchProTossWatchMatch = function requestTossWatchMatch(matchId, watch) {
  if (!Notification.requestAgreement.isSupported()) return Promise.resolve(false);
  return new Promise((resolve) => {
    Notification.requestAgreement({
      options: { templateCode: TEMPLATE_CODE },
      onEvent: async (result) => {
        if (result.type !== "newAgreement" && result.type !== "alreadyAgreed") {
          resolve(false);
          return;
        }
        try {
          const { hash } = await User.getAnonymousKey();
          const res = await fetch(`${API_BASE}/toss/watch-match`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ anonKey: hash, matchId, watch }),
          });
          resolve(res.ok);
        } catch (err) {
          console.error("토스 경기별 알림 등록 실패:", err);
          resolve(false);
        }
      },
      onError: (err) => {
        console.error("토스 알림 동의 요청 실패:", err);
        resolve(false);
      },
    });
  });
};
