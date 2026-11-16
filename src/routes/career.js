import { json } from "../lib/http.js";
import { getJSON, putJSON } from "../lib/kv.js";
import { KV_KEYS, CAREER_DECISION_CADENCE_SEASONS, CAREER_LEGENDS_CACHE_TTL_SECONDS, CAREER_LEGENDS_SIZE } from "../lib/config.js";
import { getAuthedUser, userKey } from "../lib/auth.js";
import { koreanizeTeamNameOnly } from "../adapters/apiFootballAdapter.js";
import { renderCareerShareCardImage } from "../lib/goalImage.js";
import {
  POSITIONS,
  startingOvr,
  rollPotential,
  rollRetirementAge,
  advanceOvr,
  statsForSeason,
  rollTrophies,
  rollPersonalAwards,
  rollNationalCallUp,
  shouldRetire,
  buildRetirementSummary,
  buildSeasonStory,
  estimateTransferFee,
  DECISION_TEMPLATES,
  applyDecisionEffect,
} from "../lib/careerEngine.js";
import { pickYouthAcademyOffers, pickTransferCandidates, CAREER_CLUB_DISCLAIMER } from "../lib/careerClubs.js";

function careerKey(username) {
  return `${KV_KEYS.careerPrefix}${username}`;
}

async function loadSave(env, username) {
  return getJSON(env, careerKey(username));
}

// ---------- 선택지(결정) 이벤트 생성 ----------
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function buildDecisionOption(env, save, kind) {
  switch (kind) {
    case "stay_rotation":
      return { id: "stay", label: "주전 경쟁", description: "주전 50% / 로테이션 50%", effect: { type: "stay_rotation" } };
    case "transfer": {
      const [club] = await pickTransferCandidates(env, save, { count: 1 });
      if (!club) return null;
      const fee = estimateTransferFee(save.ovr, save.age, club.competitionCode);
      return { id: "move", label: "이적 제안", description: `${club.name}로 이적 (이적료 ${fee}억원)`, club, effect: { type: "transfer", club, fee } };
    }
    case "extend_contract":
      return { id: "extend", label: "재계약", description: "소속팀 잔류, 계약 연장", effect: { type: "extend_contract" } };
    case "loan": {
      const [club] = await pickTransferCandidates(env, save, { count: 1, preferLowerTier: true });
      if (!club) return null;
      return { id: "loan", label: "임대 이적", description: `${club.name}로 1시즌 임대 (임대료 없음)`, club, effect: { type: "loan", club } };
    }
    case "overseas_transfer": {
      const [club] = await pickTransferCandidates(env, save, { count: 1, preferHigherTier: true, excludeDomestic: true });
      if (!club) return null;
      const fee = estimateTransferFee(save.ovr, save.age, club.competitionCode);
      return { id: "overseas", label: "해외 진출", description: `${club.name}로 이적 (이적료 ${fee}억원)`, club, effect: { type: "overseas_transfer", club, fee } };
    }
    case "stay_domestic":
      return { id: "stay", label: "국내 잔류", description: "안정적인 환경 유지", effect: { type: "stay_domestic" } };
    default:
      return null;
  }
}

async function generateDecisionEvent(env, save) {
  const templates = [...DECISION_TEMPLATES];
  while (templates.length) {
    const idx = randInt(0, templates.length - 1);
    const [template] = templates.splice(idx, 1);
    const options = (await Promise.all(template.optionKinds.map((kind) => buildDecisionOption(env, save, kind)))).filter(Boolean);
    // 후보 구단을 못 찾은 템플릿(캐시가 비었거나 등급 풀이 너무 좁음)은 건너뛰고 다른 템플릿을 시도한다.
    if (options.length === template.optionKinds.length) {
      return { kind: "decision", id: crypto.randomUUID(), templateId: template.id, text: template.text(save), options };
    }
  }
  return null;
}

const PREFERRED_FEET = new Set(["left", "right"]);

export async function handleCareerState(request, env) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);
  const save = await loadSave(env, user.username);
  return json({ exists: !!save, save: save || null });
}

export async function handleCareerNationalities(request, env) {
  const blob = await getJSON(env, KV_KEYS.nationalTeams);
  const teams = (blob?.teams || []).map((t) => ({
    code: t.id,
    name: koreanizeTeamNameOnly(t.name),
    crest: t.crest,
  }));
  return json({ nationalities: teams });
}

export async function handleCareerStart(request, env) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const existing = await loadSave(env, user.username);
  if (existing && existing.careerStage !== "retired") {
    return json({ detail: "이미 진행 중인 커리어가 있습니다." }, 409);
  }

  const body = await request.json().catch(() => null);
  const name = String(body?.name || "").trim().slice(0, 20);
  const jerseyNumber = Number(body?.jerseyNumber);
  const preferredFoot = PREFERRED_FEET.has(body?.preferredFoot) ? body.preferredFoot : "right";
  const position = POSITIONS.includes(body?.position) ? body.position : null;
  const nationality = body?.nationality;
  // lookSeed는 선수 카드(얼굴/유니폼) 생김새를 고정하는 값 - 캐릭터 생성 화면에서 미리보기로 보여준
  // 값을 그대로 보내게 해서, 저장 후에도 "방금 봤던 그 얼굴"이 유지되게 한다. 순전히 꾸밈용이라
  // 클라이언트가 보낸 값을 그대로 신뢰해도 문제없다(숫자가 아니면 서버에서 새로 굴림).
  const lookSeed = Number.isFinite(Number(body?.lookSeed)) ? Math.floor(Number(body.lookSeed)) : Math.floor(Math.random() * 1e9);

  if (!name) return json({ detail: "이름을 입력해주세요." }, 400);
  if (!Number.isInteger(jerseyNumber) || jerseyNumber < 1 || jerseyNumber > 99) {
    return json({ detail: "등번호는 1~99 사이로 입력해주세요." }, 400);
  }
  if (!position) return json({ detail: "포지션을 선택해주세요." }, 400);
  if (!nationality?.name) return json({ detail: "국적을 선택해주세요." }, 400);

  const ovr = startingOvr();
  const candidates = await pickYouthAcademyOffers(env);
  if (!candidates.length) return json({ detail: "유스팀 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요." }, 503);

  const save = {
    version: 1,
    careerStage: "academy_offer",
    identity: {
      name,
      jerseyNumber,
      nationality: { code: nationality.code || null, name: String(nationality.name).slice(0, 40), crest: nationality.crest || null },
      preferredFoot,
      position,
      lookSeed,
    },
    age: 16,
    ovr,
    potential: rollPotential(ovr),
    retirementAge: rollRetirementAge(),
    club: null,
    contractStatus: "자유계약",
    loanParentClubId: null,
    seasonsAtClub: 0,
    maxTransferFee: 0,
    career: { seasonIndex: 0, decisionCadence: CAREER_DECISION_CADENCE_SEASONS },
    nextSeasonModifier: null,
    history: [],
    nationalTeam: { called: false, caps: 0, goals: 0, assists: 0 },
    pendingEvent: { kind: "academy_offer", id: crypto.randomUUID(), candidates },
    retirement: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await putJSON(env, careerKey(user.username), save);
  return json({ save, disclaimer: CAREER_CLUB_DISCLAIMER });
}

export async function handleCareerAcademyChoice(request, env) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const save = await loadSave(env, user.username);
  if (!save || save.careerStage !== "academy_offer" || save.pendingEvent?.kind !== "academy_offer") {
    return json({ detail: "유스팀을 선택할 수 있는 상태가 아닙니다." }, 409);
  }

  const body = await request.json().catch(() => null);
  const clubId = body?.clubId != null ? String(body.clubId) : null;
  const club = save.pendingEvent.candidates.find((c) => String(c.id) === clubId);
  if (!club) return json({ detail: "제시된 유스팀 중에서 선택해주세요." }, 400);

  save.club = club;
  save.contractStatus = "계약중";
  save.careerStage = "active";
  save.pendingEvent = null;
  save.updatedAt = new Date().toISOString();

  await putJSON(env, careerKey(user.username), save);
  return json({ save });
}

export async function handleCareerAdvanceSeason(request, env) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const save = await loadSave(env, user.username);
  if (!save || save.careerStage !== "active") return json({ detail: "진행 중인 커리어가 없습니다." }, 409);
  if (save.pendingEvent) return json({ detail: "먼저 선택지를 해결해야 합니다." }, 409);

  const nextAge = save.age + 1;
  save.ovr = advanceOvr(save, nextAge);
  save.age = nextAge;

  const stats = statsForSeason(save);
  const { apps, goals, assists } = stats;
  const trophies = [...rollTrophies(save.ovr), ...rollPersonalAwards(save, stats)];
  const story = buildSeasonStory(save, stats, trophies);
  save.career.seasonIndex += 1;
  save.seasonsAtClub += 1;
  save.nextSeasonModifier = null;

  save.history.push({
    season: save.career.seasonIndex,
    age: save.age,
    clubId: save.club?.id || null,
    clubName: save.club?.name || null,
    clubCrest: save.club?.crest || null,
    ovr: save.ovr,
    apps,
    goals,
    assists,
    onLoan: save.contractStatus === "임대중",
    trophies,
    story,
  });

  const calledUp = rollNationalCallUp(save);

  let retired = false;
  if (shouldRetire(save)) {
    save.retirement = buildRetirementSummary(save);
    save.careerStage = "retired";
    save.pendingEvent = null;
    retired = true;
  } else if (save.career.seasonIndex % save.career.decisionCadence === 0) {
    save.pendingEvent = await generateDecisionEvent(env, save);
  }

  save.updatedAt = new Date().toISOString();
  await putJSON(env, careerKey(user.username), save);
  return json({ save, events: { trophies, calledUp, retired } });
}

export async function handleCareerChooseDecision(request, env) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const save = await loadSave(env, user.username);
  if (!save || save.pendingEvent?.kind !== "decision") return json({ detail: "선택할 수 있는 결정이 없습니다." }, 409);

  const body = await request.json().catch(() => null);
  const optionId = body?.optionId;
  const option = save.pendingEvent.options.find((o) => o.id === optionId);
  if (!option) return json({ detail: "유효하지 않은 선택지입니다." }, 400);

  applyDecisionEffect(save, option.effect);
  save.pendingEvent = null;
  save.updatedAt = new Date().toISOString();

  await putJSON(env, careerKey(user.username), save);
  return json({ save });
}

export async function handleCareerReset(request, env) {
  const user = await getAuthedUser(request, env);
  if (!user) return json({ detail: "로그인이 필요합니다." }, 401);

  const save = await loadSave(env, user.username);
  if (!save || save.careerStage !== "retired") return json({ detail: "은퇴 후에만 새로 시작할 수 있습니다." }, 409);

  await env.CACHE.delete(careerKey(user.username));
  return json({ ok: true });
}

export async function handleCareerShareImage(request, env, username) {
  try {
    const save = await loadSave(env, username);
    if (!save || save.careerStage !== "retired") return new Response(null, { status: 404 });

    const png = await renderCareerShareCardImage(env, {
      name: save.identity.name,
      jerseyNumber: save.identity.jerseyNumber,
      nationalityFlag: save.identity.nationality?.crest || null,
      position: save.identity.position,
      finalAge: save.retirement.finalAge,
      finalOvr: save.retirement.finalOvr,
      clubHistory: save.history.map((h) => ({ clubName: h.clubName, crestUrl: h.clubCrest })),
      totalApps: save.retirement.totalApps,
      totalGoals: save.retirement.totalGoals,
      totalAssists: save.retirement.totalAssists,
      trophies: save.retirement.trophies,
      nationalCaps: save.nationalTeam,
      maxTransferFee: save.retirement.maxTransferFee,
    });

    return new Response(png, { headers: { "content-type": "image/png", "cache-control": "public, max-age=1800" } });
  } catch (err) {
    console.error("career share image render failed:", err);
    return new Response(null, { status: 500 });
  }
}

// 명예의전당 "커리어 레전드" 탭 - leaderboard.js의 computeLeaderboard와 같은 패턴(전수 스캔 -> 정렬
// -> 짧은 TTL 캐시). career: 접두사로 바로 scan하면 활성/은퇴 세이브가 다 걸리니 retired만 거른다.
async function computeCareerLegends(env) {
  const list = await env.CACHE.list({ prefix: KV_KEYS.careerPrefix });
  const entries = await Promise.all(
    list.keys.map(async (k) => {
      const save = await getJSON(env, k.name);
      if (!save || save.careerStage !== "retired") return null;
      const username = k.name.slice(KV_KEYS.careerPrefix.length);
      const user = await getJSON(env, userKey(username));
      return {
        nickname: user?.nickname || username,
        name: save.identity.name,
        nationality: save.identity.nationality,
        position: save.identity.position,
        finalOvr: save.retirement.finalOvr,
        finalAge: save.retirement.finalAge,
        trophyCount: save.retirement.trophies.length,
      };
    })
  );

  const retired = entries.filter(Boolean);
  retired.sort((a, b) => b.finalOvr - a.finalOvr || b.trophyCount - a.trophyCount);
  return retired.slice(0, CAREER_LEGENDS_SIZE).map((entry, i) => ({ rank: i + 1, ...entry }));
}

export async function handleCareerLegends(request, env) {
  const cached = await getJSON(env, KV_KEYS.careerLegendsCache);
  if (cached) return json({ entries: cached });

  const entries = await computeCareerLegends(env);
  await putJSON(env, KV_KEYS.careerLegendsCache, entries, { expirationTtl: CAREER_LEGENDS_CACHE_TTL_SECONDS });
  return json({ entries });
}
