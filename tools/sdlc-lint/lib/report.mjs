// Dev/CI re-export shim. The canonical, dependency-free renderer is SHIPPED with
// the sdlc plugin at plugins/sdlc/tools/report/report.mjs (so marketplace
// consumers get it via ${CLAUDE_PLUGIN_ROOT} — see pipeline-orchestrator Step 5b).
// This file keeps the `sdlc-lint report` verb and the report test-suite pointed
// at that single source of truth, so they exercise the exact code that ships.
export { renderReport, renderReportFile } from "../../../plugins/sdlc/tools/report/report.mjs";
