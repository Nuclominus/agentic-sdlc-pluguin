// Dev/CI re-export shim. The canonical, dependency-free implementation is SHIPPED
// with the sdlc plugin at plugins/sdlc/tools/run/ (so marketplace consumers get it
// via ${CLAUDE_PLUGIN_ROOT} — see pipeline-orchestrator Step 5b). This file keeps the
// test-suite pointed at that single source of truth, so it exercises the exact code
// that ships.
export { sealRunClock } from "../../../plugins/sdlc/tools/run/clock.mjs";
export { finishRun } from "../../../plugins/sdlc/tools/run/finish.mjs";
