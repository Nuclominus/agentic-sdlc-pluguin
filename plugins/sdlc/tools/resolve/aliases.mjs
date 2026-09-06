// ADR-0021 — agents live in the core; foundations carry expertise.
//
// The android-foundation roster (android-ba, android-developer, …) was deleted when its eleven
// roles moved into plugins/sdlc/agents/. Consumers wrote those names into two project files —
// `.claude/sdlc.local.yaml` (`extensions.skills[].agents`) and `.claude/model.local.json`
// (`agents{}`) — and into their own dispatch habits. A rename that silently dropped those rows
// would be a regression nobody could see, so the legacy names survive as aliases: mapped, and
// warned about at the site where they were found.
//
// MIRRORED in plugins/sdlc/hooks/enforce-agent-model.sh (a PreToolUse hook must fail-open fast
// and cannot import this module) — keep the two lists in sync.

export const LEGACY_AGENT_ALIASES = Object.freeze({
  "android-ba": "business-analyst",
  "android-developer": "developer",
  "android-reviewer": "reviewer",
  "android-security": "security-analyst",
  "android-tester": "tester",
  "android-qa": "qa-engineer",
  "android-docs": "document-writer",
  "android-debugger": "debugger",
  "android-devops": "devops",
  "android-cicd": "cicd",
  "android-aar": "aar-analyst",
});

/** `plugin:agent` → `agent`. Dispatch names carry the prefix; frontmatter files do not. */
export function bareAgentName(name) {
  const s = String(name ?? "");
  return s.includes(":") ? s.split(":").pop() : s;
}

/**
 * The canonical (core) name for an agent reference found in project configuration.
 *
 * Unknown names pass through untouched — validating them is the caller's job, and a project-local
 * agent under `.claude/agents/` is a legitimate name this module cannot know about.
 */
export function canonicalAgentName(name, warnings = [], where = "config") {
  const bare = bareAgentName(name);
  const canon = LEGACY_AGENT_ALIASES[bare];
  if (!canon) return bare;
  warnings.push(`WARN: ${where} names legacy agent '${bare}' → '${canon}' (deprecated alias, ADR-0021; update the file — aliases are removed two releases after android-foundation 2.0.0)`);
  return canon;
}

/** Reverse lookup — every legacy name that now resolves to `canonical`. */
export function legacyNamesFor(canonical) {
  return Object.entries(LEGACY_AGENT_ALIASES).filter(([, c]) => c === canonical).map(([legacy]) => legacy);
}
