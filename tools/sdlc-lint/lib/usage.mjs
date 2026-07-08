// Dev/CI re-export shim. The canonical, dependency-free implementation is SHIPPED
// with the sdlc plugin at plugins/sdlc/tools/usage/usage.mjs (so marketplace
// consumers get it via ${CLAUDE_PLUGIN_ROOT} — see pipeline-orchestrator Step 5b).
// This file keeps the usage test-suite pointed at that single source of truth, so
// it exercises the exact code that ships.
export {
  loadRegistry, extractUsage, priceUsage, priceTranscripts,
  findAgentTranscript, sessionSubagentsDir, deriveDispatchMap, enrichTelemetry,
  CACHE_PRESSURE_PEAK_TOKENS,
} from "../../../plugins/sdlc/tools/usage/usage.mjs";
