import "./router.js";
import { loadMatches } from "./views/matches.js";
import "./views/leagues.js";
import "./views/news.js";
import "./views/aiAnalysis.js";
import "./views/myTeam.js";
import "./views/teamDetail.js";
import { initPushButton } from "./push.js";

loadMatches();
initPushButton();
