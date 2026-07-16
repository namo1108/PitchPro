import { json } from "../lib/http.js";
import { COMPETITIONS } from "../lib/config.js";

export async function handleCompetitions() {
  const competitions = COMPETITIONS.filter((c) => !c.hideFromLeagueTab).map(({ code, name, emblem, hasBracket }) => ({
    code,
    name,
    emblem,
    hasBracket: !!hasBracket,
  }));
  return json({ competitions });
}
