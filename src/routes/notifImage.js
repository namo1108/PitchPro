import { renderGoalNotificationImage, renderMatchStatusImage, renderTransferImage } from "../lib/goalImage.js";

const PNG_HEADERS = {
  "content-type": "image/png",
  // 같은 이벤트를 여러 구독자에게 보낼 때 매번 다시 그리지 않도록 짧게 캐싱한다(쿼리스트링 자체가
  // 캐시 키라 서로 다른 이벤트끼리 섞이지 않음).
  "cache-control": "public, max-age=3600",
};

// OS 알림의 image 필드가 실제로 이 URL을 직접 fetch해서 표시하므로(우리가 직접 안 부름), 그때그때
// 필요한 정보를 전부 쿼리스트링에 실어 보낸다 - 서버에 저장해두는 상태가 전혀 없는 순수 렌더링 엔드포인트.
export async function handleGoalNotificationImage(request, env, url) {
  try {
    const png = await renderGoalNotificationImage(env, {
      teamName: url.searchParams.get("team") || "",
      crestUrl: url.searchParams.get("crest") || "",
      scorer: url.searchParams.get("scorer") || "",
      minute: url.searchParams.get("minute") || "",
      badgeText: url.searchParams.get("badge") || undefined,
      badgeColor: url.searchParams.get("color") || undefined,
    });
    return new Response(png, { headers: PNG_HEADERS });
  } catch (err) {
    console.error("goal notification image render failed:", err);
    return new Response(null, { status: 500 });
  }
}

// 킥오프/하프타임/종료/골취소/라인업발표처럼 두 팀 다 보여줘야 하는 이벤트용.
export async function handleMatchStatusNotificationImage(request, env, url) {
  try {
    const homeScoreRaw = url.searchParams.get("homeScore");
    const awayScoreRaw = url.searchParams.get("awayScore");
    const png = await renderMatchStatusImage(env, {
      homeTeam: url.searchParams.get("homeTeam") || "",
      homeCrestUrl: url.searchParams.get("homeCrest") || "",
      awayTeam: url.searchParams.get("awayTeam") || "",
      awayCrestUrl: url.searchParams.get("awayCrest") || "",
      homeScore: homeScoreRaw !== null && homeScoreRaw !== "" ? Number(homeScoreRaw) : null,
      awayScore: awayScoreRaw !== null && awayScoreRaw !== "" ? Number(awayScoreRaw) : null,
      badgeText: url.searchParams.get("badge") || "",
      badgeColor: url.searchParams.get("color") || undefined,
    });
    return new Response(png, { headers: PNG_HEADERS });
  } catch (err) {
    console.error("match status notification image render failed:", err);
    return new Response(null, { status: 500 });
  }
}

export async function handleTransferNotificationImage(request, env, url) {
  try {
    const png = await renderTransferImage(env, {
      playerName: url.searchParams.get("player") || "",
      fromTeam: url.searchParams.get("fromTeam") || "",
      fromCrestUrl: url.searchParams.get("fromCrest") || "",
      toTeam: url.searchParams.get("toTeam") || "",
      toCrestUrl: url.searchParams.get("toCrest") || "",
    });
    return new Response(png, { headers: PNG_HEADERS });
  } catch (err) {
    console.error("transfer notification image render failed:", err);
    return new Response(null, { status: 500 });
  }
}
