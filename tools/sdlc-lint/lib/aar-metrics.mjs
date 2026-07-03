// Dev/CI re-export shim. The canonical, dependency-free metrics computer is
// SHIPPED with the sdlc plugin at plugins/sdlc/tools/aar/metrics.mjs (so
// marketplace consumers get it via ${CLAUDE_PLUGIN_ROOT} — see the sdlc:aar
// skill). This file keeps the AAR metrics test-suite pointed at that single
// source of truth, so it exercises the exact code that ships.
export { computeMetrics, computeMetricsFile } from "../../../plugins/sdlc/tools/aar/metrics.mjs";
