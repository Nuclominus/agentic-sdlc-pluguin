// Dev/CI drift guard for ADR-0018 — an agent's `tools:` frontmatter key is an
// ALLOWLIST, and omitting it does not mean "the defaults": it grants the FULL
// toolset. That is how ten of eleven android-foundation agents ended up holding
// every tool, including a reviewer documented as "READ-ONLY … does NOT write
// code" that could Edit any file in the repo.
//
// Three invariants, each of which regresses silently without a check:
//   1. Every shipped agent declares a non-empty `tools:` (the root-cause bug).
//   2. No agent may dispatch other agents — only the orchestrator, which runs
//      in the main loop as a skill, holds that right.
//   3. Reviewing agents carry no Edit (ADR-0018): a reviewer that repairs what
//      it reviews leaves no independent verifier, and its edits land outside
//      the review loop that guards every other change in the run.
//
// Source-tree only — it never runs at pipeline runtime, so (like
// lib/plugin-paths.mjs, unlike lib/usage.mjs) it has no mirrored copy under
// plugins/sdlc/tools/.

import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { globSync } from "tinyglobby";

/**
 * Tools that dispatch, resume, or fan out to other agents. A subagent holding
 * any of these can spawn work outside the orchestrator's phase accounting:
 * its children never reach `_telemetry.json`, never hit a checkpoint, and never
 * count against the recipe's cost cap — the run's measured cost silently stops
 * being the run's real cost.
 */
export const DISPATCH_TOOLS = ["Agent", "Task", "SendMessage", "Workflow"];

/**
 * Agents whose whole value is being an independent reader. They may hold Write
 * (for their own report under docs/plans/{task_slug}/) but never Edit.
 * Keyed by the agent's `name:`, not its filename.
 */
export const READ_ONLY_AGENTS = [
  "aar-analyst",
  "debugger",
  "reviewer",
  "security-analyst",
];

/** Parse `---`-delimited frontmatter. Returns null when the file has none. */
export function frontmatter(text) {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 3);
  return end === -1 ? null : text.slice(4, end);
}

/** Read a flow-sequence `tools: [A, B]` line. Returns null when the key is absent. */
export function parseTools(fm) {
  const m = fm.match(/^tools:\s*\[([^\]]*)\]\s*$/m);
  if (!m) return /^tools:/m.test(fm) ? [] : null;
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Scan one agent definition.
 * @param {string} text  raw file contents
 * @returns {{ ok: boolean, errors: string[], name: string|null, tools: string[]|null }}
 */
export function scanAgent(text) {
  const errors = [];
  const fm = frontmatter(text);
  if (fm === null) {
    return { ok: false, errors: ["no YAML frontmatter — cannot determine tools"], name: null, tools: null };
  }
  const name = (fm.match(/^name:\s*(\S+)\s*$/m) || [])[1] ?? null;
  if (!name) errors.push("frontmatter has no `name:`");
  if (!/^description:/m.test(fm)) {
    errors.push(
      "frontmatter has no `description:` — the agent renders as \"Agent from <plugin>\" " +
      "and can never be selected by trigger words, only by exact name",
    );
  }

  const tools = parseTools(fm);
  if (tools === null) {
    errors.push(
      "no `tools:` key — this does NOT mean \"the defaults\", it grants the FULL toolset. " +
      "Declare an explicit allowlist (see ADR-0018)",
    );
    return { ok: false, errors, name, tools };
  }
  if (tools.length === 0) errors.push("`tools:` is empty — an agent with no tools cannot act");

  for (const t of tools) {
    if (DISPATCH_TOOLS.includes(t)) {
      errors.push(
        `declares \`${t}\` — only the orchestrator may dispatch agents. A subagent that spawns ` +
        `its own children puts them outside phase accounting: no checkpoint, no telemetry, ` +
        `no cost-cap contribution`,
      );
    }
  }

  if (name && READ_ONLY_AGENTS.includes(name) && tools.includes("Edit")) {
    errors.push(
      "is a reviewing agent and declares `Edit` — reviewers report, the development agent " +
      "applies (ADR-0018). Write is allowed for its own report only",
    );
  }

  return { ok: errors.length === 0, errors, name, tools };
}

/**
 * Scan every shipped agent in the repo.
 * @param {string} root repo root
 * @returns {Array<{file: string, ok: boolean, errors: string[]}>}
 */
export function checkAgentTools(root) {
  const files = globSync("plugins/*/agents/*.md", { cwd: root, absolute: true }).sort();
  return files.map((abs) => {
    const rel = relative(root, abs);
    try {
      const { ok, errors } = scanAgent(readFileSync(abs, "utf8"));
      return { file: rel, ok, errors };
    } catch (e) {
      return { file: rel, ok: false, errors: [`unreadable: ${e.message}`], tool_error: true };
    }
  });
}

export const __testing = { resolve };
