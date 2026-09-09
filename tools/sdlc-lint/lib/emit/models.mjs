// Tier+effort -> host model id, for Track J's emitters.
//
// The pipeline's model vocabulary is a pair of frontmatter keys: `model:` names a
// TIER (opus|sonnet|haiku|fable — a tag in plugins/sdlc/config/models/claude.yaml, never
// a provider model string) and `effort:` names the reasoning budget. On Claude
// Code the two travel separately: the tier goes to the Agent tool's `model` field
// and hooks/enforce-agent-model.sh enforces it.
//
// Antigravity has no separate effort field per agent — its model ids embed the
// effort (`gemini-3.8-flash-medium`, `gemini-3.1-pro-high`, observed via
// `agy models` on 1.1.27). So the PAIR is the lookup key there, and `effort:`
// is folded into the emitted `model:` rather than dropped. Codex keeps them
// separate again (`model` + `model_reasoning_effort`), which is why this module
// returns both halves and lets the per-host emitter decide how to spell them.
//
// Source-tree only — never runs at pipeline runtime (like lib/plugin-paths.mjs).

/** Tier tags the pipeline actually dispatches. Mirror of models.json `pipeline_tiers`. */
export const TIERS = ["opus", "sonnet", "haiku", "fable"];

/** Reasoning budgets an agent may declare. */
export const EFFORTS = ["high", "medium", "low"];

/**
 * Resolve one agent's tier+effort against a host descriptor's `models.map`.
 *
 * Both halves are required: an agent that declares a tier but no effort has an
 * incomplete key on a host where the pair IS the key, and guessing a default
 * would silently pick a reasoning budget nobody wrote down. Report it instead.
 *
 * @param {string|null} tier    frontmatter `model:` value
 * @param {string|null} effort  frontmatter `effort:` value
 * @param {object} host         parsed hosts/<host>.json
 * @returns {{ ok: boolean, model: string|null, effort: string|null, error: string|null }}
 */
export function resolveModel(tier, effort, host) {
  const map = host?.models?.map;
  if (!map) return { ok: false, model: null, effort: null, error: `host ${host?.host} declares no models.map` };

  if (!tier) return { ok: false, model: null, effort: null, error: "no `model:` tier in frontmatter" };
  if (!TIERS.includes(tier)) {
    return { ok: false, model: null, effort: null, error: `unknown tier \`${tier}\` (expected one of ${TIERS.join("|")})` };
  }

  if (host.models.key === "tier+effort") {
    if (!effort) {
      return {
        ok: false, model: null, effort: null,
        error: `host ${host.host} keys models on tier+effort, but the agent declares no \`effort:\``,
      };
    }
    if (!EFFORTS.includes(effort)) {
      return { ok: false, model: null, effort: null, error: `unknown effort \`${effort}\` (expected one of ${EFFORTS.join("|")})` };
    }
    const id = map[`${tier}/${effort}`];
    if (!id) {
      return { ok: false, model: null, effort: null, error: `host ${host.host} has no model for \`${tier}/${effort}\`` };
    }
    // The effort rode into the id; the emitted file must not also carry an
    // `effort:` key, or the pair has two spellings and they can disagree.
    return { ok: true, model: id, effort: null, error: null };
  }

  // Hosts that keep the two apart (Codex: `model` + `model_reasoning_effort`).
  const id = map[tier];
  if (!id) return { ok: false, model: null, effort: null, error: `host ${host.host} has no model for tier \`${tier}\`` };
  return { ok: true, model: id, effort: effort ?? null, error: null };
}

/**
 * Every tier+effort pair a host maps, as a sorted list — the shape a golden
 * test asserts against so a silent map edit shows up as a diff.
 * @param {object} host
 * @returns {Array<[string, string]>}
 */
export function modelPairs(host) {
  return Object.entries(host?.models?.map ?? {}).sort(([a], [b]) => a.localeCompare(b));
}
