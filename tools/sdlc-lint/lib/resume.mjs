// Dev/CI re-export shim. The canonical, dependency-free implementation is SHIPPED
// with the sdlc plugin at plugins/sdlc/tools/run/reentry.mjs (so marketplace consumers
// get it via ${CLAUDE_PLUGIN_ROOT} — the H6 Stop hook evaluates the same completeness
// rule). This file keeps the resume test-suite pointed at that single source of truth,
// so it exercises the exact code that ships.
export { loadCheckpoints, computeReentry, resolveWorkspace }
  from "../../../plugins/sdlc/tools/run/reentry.mjs";
