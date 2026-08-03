import satori from "satori";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import RESVG_WASM_MODULE from "@resvg/resvg-wasm/index_bg.wasm";

// 폰트/wasm은 요청마다 새로 안 만들고 격리 인스턴스(isolate) 안에서 한 번만 로드해 재사용한다
// (같은 워커 인스턴스가 여러 요청을 처리하는 동안은 캐시가 유지됨 - 콜드스타트 때만 비용 발생).
let fontsPromise = null;
let wasmReadyPromise = null;

async function ensureWasm() {
  if (!wasmReadyPromise) wasmReadyPromise = initWasm(RESVG_WASM_MODULE);
  return wasmReadyPromise;
}

async function loadFonts(env) {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const [medium, bold] = await Promise.all([
      env.ASSETS.fetch(new Request("http://assets.local/fonts/Pretendard-Medium.otf")).then((r) => r.arrayBuffer()),
      env.ASSETS.fetch(new Request("http://assets.local/fonts/Pretendard-Bold.otf")).then((r) => r.arrayBuffer()),
    ]);
    return [
      { name: "Pretendard", data: medium, weight: 400, style: "normal" },
      { name: "Pretendard", data: bold, weight: 700, style: "normal" },
    ];
  })();
  return fontsPromise;
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// 크레스트가 우리 자체 정적 자산(/img/emblems/...)이면 ASSETS 바인딩으로, 외부 CDN(media.api-sports.io
// 등)이면 그냥 fetch로 가져온다. satori는 img src로 실제 URL을 못 불러오고(자체적으로 이미지를 안
// 페치함) data URI만 받을 수 있어서, 렌더링 전에 미리 통째로 내려받아 base64로 바꿔둬야 한다.
async function toDataUri(env, url) {
  if (!url) return null;
  try {
    const res = url.startsWith("/") ? await env.ASSETS.fetch(new Request(`http://assets.local${url}`)) : await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "image/png";
    return `data:${contentType};base64,${arrayBufferToBase64(buf)}`;
  } catch {
    return null;
  }
}

const CARD_WIDTH = 1000;
const CARD_HEIGHT = 340;
const ACCENT = "#24e583";
const CARD_STYLE_BASE = {
  width: CARD_WIDTH,
  height: CARD_HEIGHT,
  display: "flex",
  padding: "36px 48px",
  background: "linear-gradient(135deg, #0d100e 0%, #0a0a0a 55%, #0d1310 100%)",
  borderRadius: 40,
  fontFamily: "Pretendard",
};

async function renderCard(env, element) {
  await ensureWasm();
  const fonts = await loadFonts(env);
  const svg = await satori(element, { width: CARD_WIDTH, height: CARD_HEIGHT, fonts });
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: CARD_WIDTH } });
  return resvg.render().asPng();
}

function crestNode(crestDataUri, size = 140, imgSize = 96) {
  return {
    type: "div",
    props: {
      style: {
        width: size,
        height: size,
        borderRadius: size / 2,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(circle at 35% 30%, #ffffff 0%, #e4e9e6 70%)",
      },
      children: crestDataUri
        ? { type: "img", props: { src: crestDataUri, width: imgSize, height: imgSize, style: { objectFit: "contain" } } }
        : { type: "div", props: { style: { width: imgSize * 0.6, height: imgSize * 0.6, borderRadius: imgSize * 0.3, background: "#cfd6d2" } } },
    },
  };
}

function teamColumn(crestDataUri, teamName) {
  return {
    type: "div",
    props: {
      style: { flexShrink: 0, width: 200, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18 },
      children: [
        crestNode(crestDataUri),
        {
          type: "div",
          props: {
            style: { fontSize: 28, fontWeight: 700, color: "#ffffff", textTransform: "uppercase", textAlign: "center", lineHeight: 1.15 },
            children: teamName || "",
          },
        },
      ],
    },
  };
}

function pill(text, color) {
  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        fontSize: 32,
        fontWeight: 700,
        color: "#ffffff",
        border: `3px solid ${color}`,
        borderRadius: 999,
        padding: "10px 28px",
        whiteSpace: "nowrap",
      },
      children: text,
    },
  };
}

// 실제 앱의 골 세리모니 팝업(frontend/style.css .goal-popup)과 같은 색·구도(좌: 엠블럼+팀명,
// 우: 배지+시간 pill / 선수명)를 옮긴 단일 팀 카드 - 골/실점/퇴장처럼 "한 팀의 한 선수"가
// 주인공인 이벤트에 재사용한다(badgeText/badgeColor로 GOAL!/RED CARD 등을 구분).
export async function renderGoalNotificationImage(env, { teamName, crestUrl, scorer, minute, badgeText = "GOAL!", badgeColor = ACCENT }) {
  const crestDataUri = await toDataUri(env, crestUrl);

  const element = {
    type: "div",
    props: {
      style: { ...CARD_STYLE_BASE, alignItems: "stretch", gap: 40, border: `6px solid ${badgeColor}` },
      children: [
        teamColumn(crestDataUri, teamName),
        {
          type: "div",
          props: {
            style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 22 },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 },
                  children: [
                    { type: "div", props: { style: { fontSize: 56, fontWeight: 700, color: badgeColor }, children: badgeText } },
                    ...(minute ? [pill(`${minute}'`, badgeColor)] : []),
                  ],
                },
              },
              {
                type: "div",
                props: {
                  style: { display: "flex", fontSize: 60, fontWeight: 700, color: "#ffffff", textTransform: "uppercase" },
                  children: scorer || teamName || "",
                },
              },
            ],
          },
        },
      ],
    },
  };

  return renderCard(env, element);
}

// 킥오프/하프타임/종료/골취소/라인업발표처럼 "두 팀 다" 나와야 하는 이벤트용 - 가운데 배지(예: "KICK
// OFF", "HT", "FT")와 좌우 팀(+선택적으로 스코어)을 보여준다.
export async function renderMatchStatusImage(
  env,
  { homeTeam, homeCrestUrl, awayTeam, awayCrestUrl, homeScore, awayScore, badgeText, badgeColor = ACCENT }
) {
  const [homeCrestDataUri, awayCrestDataUri] = await Promise.all([toDataUri(env, homeCrestUrl), toDataUri(env, awayCrestUrl)]);
  const hasScore = homeScore != null && awayScore != null;

  const element = {
    type: "div",
    props: {
      style: { ...CARD_STYLE_BASE, alignItems: "center", justifyContent: "space-between", border: `6px solid ${badgeColor}` },
      children: [
        teamColumn(homeCrestDataUri, homeTeam),
        {
          type: "div",
          props: {
            style: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    fontSize: 34,
                    fontWeight: 700,
                    color: badgeColor,
                    border: `3px solid ${badgeColor}`,
                    borderRadius: 999,
                    padding: "10px 32px",
                    letterSpacing: 2,
                  },
                  children: badgeText,
                },
              },
              ...(hasScore
                ? [{ type: "div", props: { style: { display: "flex", fontSize: 64, fontWeight: 700, color: "#ffffff" }, children: `${homeScore} - ${awayScore}` } }]
                : [{ type: "div", props: { style: { display: "flex", fontSize: 40, fontWeight: 700, color: "#ffffff" }, children: "VS" } }]),
            ],
          },
        },
        teamColumn(awayCrestDataUri, awayTeam),
      ],
    },
  };

  return renderCard(env, element);
}

// 이적 소식용 - 선수명 + 이전팀 -> 이적팀(화살표) 구도.
export async function renderTransferImage(env, { playerName, fromTeam, fromCrestUrl, toTeam, toCrestUrl }) {
  const [fromCrestDataUri, toCrestDataUri] = await Promise.all([toDataUri(env, fromCrestUrl), toDataUri(env, toCrestUrl)]);

  const element = {
    type: "div",
    props: {
      style: { ...CARD_STYLE_BASE, flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 26, border: `6px solid ${ACCENT}` },
      children: [
        { type: "div", props: { style: { display: "flex", fontSize: 50, fontWeight: 700, color: "#ffffff", textTransform: "uppercase" }, children: playerName || "" } },
        {
          type: "div",
          props: {
            style: { display: "flex", alignItems: "center", gap: 36 },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 12 },
                  children: [crestNode(fromCrestDataUri, 110, 76), { type: "div", props: { style: { fontSize: 24, fontWeight: 400, color: "#c8cfcb" }, children: fromTeam || "" } }],
                },
              },
              { type: "div", props: { style: { display: "flex", fontSize: 48, fontWeight: 700, color: ACCENT }, children: "→" } },
              {
                type: "div",
                props: {
                  style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 12 },
                  children: [crestNode(toCrestDataUri, 110, 76), { type: "div", props: { style: { fontSize: 24, fontWeight: 700, color: "#ffffff" }, children: toTeam || "" } }],
                },
              },
            ],
          },
        },
      ],
    },
  };

  return renderCard(env, element);
}
