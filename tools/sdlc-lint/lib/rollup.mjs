// Dev/CI re-export shim. The canonical, dependency-free cross-run rollup is
// SHIPPED with the sdlc plugin at plugins/sdlc/tools/rollup/rollup.mjs (so
// marketplace consumers get it via ${CLAUDE_PLUGIN_ROOT} — see the /sdlc:report
// command). This file keeps the `sdlc-lint rollup` verb and the rollup test-suite
// pointed at that single source of truth, so they exercise the exact code that ships.
export { computeRollup } from "../../../plugins/sdlc/tools/rollup/rollup.mjs";
