import { json } from "../lib/http.js";
import { ALL_COMPETITIONS } from "../lib/config.js";

export async function handleCompetitions() {
  const competitions = ALL_COMPETITIONS.map(({ code, name, emblem }) => ({ code, name, emblem }));
  return json({ competitions });
}
