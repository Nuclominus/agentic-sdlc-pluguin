// Step 0a — external plugin dependency preflight, and the one boundary a subprocess cannot
// cross on its own.
//
// THE BOUNDARY, TAKEN SERIOUSLY.
//
// `mcp__skills__list_skills` reports what the HARNESS has loaded. A node process can only
// see what is on disk. The prose treats the filesystem as a degraded fallback and leaves it
// there. It does not have to be degraded — the gap decomposes into four parts, and three of
// them are readable from disk once enablement is consulted:
//
//   1. Enablement. A disabled plugin's skills sit on disk and are NOT loaded. Readable —
//      `enabledPlugins`, merged across scopes (./manifests.mjs).
//   2. Version. The cache holds every version ever installed; only the installed one loads.
//      Readable — installed_plugins.json carries the exact installPath.
//   3. Non-plugin skill roots. Skills also live in `{CONFIG_DIR}/skills/` and
//      `{PROJECT}/.claude/skills/`. The prose's fallback globs the plugin cache only and is
//      blind to both. Readable — they are directories.
//   4. Harness load failures and per-session toggles. NOT readable, by any means available
//      to a subprocess. This is the irreducible part.
//
// So the enumeration is faithful up to (4), and (4) is reported rather than hidden:
// `skills_source` is `"mcp"` when the orchestrator passed the authoritative list via
// `--skills`, and `"fs"` otherwise, with `fs_blind_to` naming exactly what a filesystem
// answer cannot account for. An honest partial answer beats a confident wrong one.
//
// WHY THIS MATTERS, MEASURED. `runtime-dependencies.json` declares `superpowers` with
// `skills_used: [thinking-deeply, test-driven-development, verification-before-completion]`.
// `thinking-deeply` exists in NEITHER installed version (6.1.1 and 6.2.0 ship fourteen skills
// and that is not one of them). Yet all three most recent runs recorded
// `deps_preflight: {superpowers: {status: "available", missing_skills: []}}`. The per-skill
// check the prose asks for did not happen; the aggregate looked healthy and nobody noticed.
// This module reports it, which is the whole point of moving the step into code.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const POLICY_RANK = { block: 3, warn: 2, "graceful-degrade": 1 };
const STAMP = ".sdlc-deps-preflight.json";

function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}
function skillDirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "SKILL.md")))
      .map((e) => e.name);
  } catch { return []; }
}
const pluginNameOf = (key) => String(key).split("@")[0];

/**
 * Every skill this consumer can actually invoke, as `plugin:skill` plus bare names for the
 * non-plugin roots.
 *
 * `installs` and `enabled` come from ./manifests.mjs, so a disabled plugin contributes
 * nothing and a stale cached version is never consulted.
 */
export function enumerateSkills({ configDir, projectRoot, installs = new Map(), enabled = {} } = {}) {
  const skills = new Set();
  const roots = [];

  for (const [key, info] of installs) {
    if (enabled[key] === false) continue;
    const dir = join(info.installPath, "skills");
    const found = skillDirs(dir);
    if (found.length === 0) continue;
    roots.push({ root: dir, kind: "plugin", key, count: found.length });
    for (const s of found) skills.add(`${pluginNameOf(key)}:${s}`);
  }

  for (const [dir, kind] of [
    [configDir ? join(configDir, "skills") : null, "user"],
    [projectRoot ? join(projectRoot, ".claude", "skills") : null, "project"],
  ]) {
    if (!dir) continue;
    const found = skillDirs(dir);
    if (found.length === 0) continue;
    roots.push({ root: dir, kind, count: found.length });
    for (const s of found) { skills.add(s); skills.add(`${kind}:${s}`); }
  }

  return {
    skills,
    roots,
    source: "fs",
    fs_blind_to: ["harness load failures", "per-session skill toggles"],
  };
}

/** Parse an explicit `--skills` list into the same shape, marked as authoritative. */
export function skillsFromList(csv) {
  const skills = new Set(String(csv).split(",").map((s) => s.trim()).filter(Boolean));
  return { skills, roots: [], source: "mcp", fs_blind_to: [] };
}

/**
 * Merge every installed+enabled plugin's `runtime-dependencies.json`.
 *
 * The strictest policy wins when two plugins declare the same dependency — a `warn` must
 * never be able to soften somebody else's `block`.
 */
export function collectDependencies({ installs = new Map(), enabled = {} } = {}) {
  const merged = new Map();
  const sources = [];
  for (const [key, info] of installs) {
    if (enabled[key] === false) continue;
    const file = join(info.installPath, "runtime-dependencies.json");
    const doc = readJson(file);
    if (!doc || !Array.isArray(doc.dependencies) || doc.dependencies.length === 0) continue;
    sources.push({ key, file, count: doc.dependencies.length });
    for (const dep of doc.dependencies) {
      if (!dep || !dep.name) continue;
      const prev = merged.get(dep.name);
      if (!prev) { merged.set(dep.name, { ...dep, declared_by: [key] }); continue; }
      prev.declared_by.push(key);
      prev.skills_used = [...new Set([...(prev.skills_used ?? []), ...(dep.skills_used ?? [])])];
      if ((POLICY_RANK[dep.policy] ?? 0) > (POLICY_RANK[prev.policy] ?? 0)) prev.policy = dep.policy;
    }
  }
  return { dependencies: [...merged.values()], sources };
}

/**
 * Per-dependency status — the per-SKILL check, which is the part that was not happening.
 *
 * A skill counts as present when it is listed as `plugin:skill`, or bare (a user- or
 * project-level skill of the same name legitimately satisfies the need).
 */
export function computeDepsStatus(dependencies, available) {
  const status = {};
  for (const dep of dependencies) {
    const used = dep.skills_used ?? [];
    const missing = used.filter((s) => !available.skills.has(`${dep.name}:${s}`) && !available.skills.has(s));
    status[dep.name] = missing.length === 0
      ? { status: "available", missing_skills: [] }
      : {
        status: "missing",
        missing_skills: missing,
        policy: dep.policy ?? "warn",
        install_command: dep.install_command ?? [],
        fallback_note: dep.fallback_note ?? null,
      };
  }
  return status;
}

/**
 * Apply each missing dependency's policy.
 *
 * Every machine-readable signal goes to STDOUT and no exit code is promised — Step 0a-1 is
 * binding here, and it is binding because both were verified by execution: a prompt cannot
 * write the host's stderr, and `claude -p` reports success whenever the turn ends normally.
 * A command replacing that prose CAN exit non-zero, and does, but the stdout artifacts stay
 * the contract so a CI gate written against them keeps working either way.
 *
 * All `block` failures aggregate before aborting: single exit, multiple grievances.
 */
export function enforcePolicies(status, { headless = false } = {}) {
  const stdout = [];
  const flags = {};
  const blocking = [];

  for (const [name, s] of Object.entries(status)) {
    if (s.status === "available") continue;
    const policy = s.policy ?? "warn";
    if (policy === "block") {
      blocking.push(name);
      stdout.push(JSON.stringify({
        error: "missing_dependency", plugin: name,
        missing_skills: s.missing_skills, install_command: s.install_command ?? [],
      }));
      continue;
    }
    flags[`${name}_unavailable`] = true;
    if (policy === "warn") stdout.push(`WARN: ${name} missing skills: ${s.missing_skills.join(",")}`);
    // graceful-degrade: flag only, silent by contract.
  }
  return { abort: blocking.length > 0, blocking, stdout, flags, headless };
}

/** The verbatim 0a-5 block. Suppressed in headless mode, where stdout already carried it. */
export function renderPreflightPrint(status, { headless = false, cached = false, versions = {} } = {}) {
  if (headless) return null;
  if (cached) return "🔧 Dependency preflight: cached (all satisfied)";
  const names = Object.keys(status);
  if (names.length === 0) return "🔌 Dependency preflight: no external dependencies declared.";
  const lines = ["🔌 Dependency preflight:"];
  for (const name of names) {
    const s = status[name];
    const policy = s.policy ?? "warn";
    const mark = s.status === "available" ? "✅ available" : policy === "block" ? "❌ missing" : "⚠️ degraded";
    lines.push(`   ${name} (${versions[name] ?? "unknown"}, policy=${policy}): ${mark}`);
    lines.push(`     missing: ${s.missing_skills.length ? s.missing_skills.join(", ") : "—"}`);
  }
  return lines.join("\n");
}

export function readStamp(configDir) {
  return readJson(join(configDir, STAMP));
}

/** The installed version of each declared dependency — what a stamp must be keyed to. */
export function dependencyVersions(dependencies, installs = new Map()) {
  const out = {};
  for (const dep of dependencies) {
    for (const [key, info] of installs) {
      if (pluginNameOf(key) === dep.name) { out[dep.name] = info.version ?? null; break; }
    }
    if (!(dep.name in out)) out[dep.name] = null;
  }
  return out;
}

/**
 * Is a cached stamp still describing reality?
 *
 * THE BUG THIS CLOSES, measured rather than supposed. The documented invalidation triggers
 * are only `/sdlc:doctor`, `--force-preflight`, and a `block` abort. **A dependency changing
 * underneath the stamp is not one of them.** On the machine this was written the stamp reads
 * `checked_at: 2026-06-22, all_satisfied: true`, while superpowers 6.2.0 was installed on
 * 2026-06-25 and last updated 2026-07-24 — and `thinking-deeply`, one of the three skills
 * `runtime-dependencies.json` declares, exists in no installed version. Every run since June
 * has taken the fast path, printed "cached (all satisfied)", and copied `available` into
 * telemetry. Three consecutive runs recorded a green preflight for a dependency that has been
 * partially missing for six weeks.
 *
 * A stamp is therefore keyed to the versions it was computed against, and a version that has
 * moved — or a stamp predating this rule, which carries no versions at all — is a miss.
 */
export function stampIsFresh(stamp, currentVersions) {
  if (!stamp || stamp.all_satisfied !== true) return { fresh: false, reason: "no satisfied stamp" };
  if (!stamp.versions || typeof stamp.versions !== "object") {
    return { fresh: false, reason: "stamp predates version keying" };
  }
  for (const [name, version] of Object.entries(currentVersions)) {
    if (stamp.versions[name] !== version) {
      return { fresh: false, reason: `${name} changed: stamped ${stamp.versions[name] ?? "—"}, installed ${version ?? "—"}` };
    }
  }
  for (const name of Object.keys(stamp.versions)) {
    if (!(name in currentVersions)) return { fresh: false, reason: `${name} is no longer declared` };
  }
  return { fresh: true, reason: null };
}

/**
 * Write the fast-path stamp. Never written when a `block` policy aborted, so the next run
 * always re-scans — the one invalidation rule that must not be forgotten.
 */
export function writeStamp(configDir, status, { aborted = false, now, versions = {} } = {}) {
  if (aborted) return null;
  const results = Object.fromEntries(Object.entries(status).map(([k, v]) => [k, v.status]));
  const stamp = {
    checked_at: now ?? new Date().toISOString(),
    results,
    versions,
    all_satisfied: Object.values(results).every((v) => v === "available"),
  };
  const file = join(configDir, STAMP);
  try { writeFileSync(file, `${JSON.stringify(stamp, null, 2)}\n`); return file; } catch { return null; }
}

/** The whole step. `skills` short-circuits the enumeration with an authoritative list. */
export function preflight({ configDir, projectRoot, installs, enabled, skills = null, headless = false, force = false } = {}) {
  const available = skills ? skillsFromList(skills) : enumerateSkills({ configDir, projectRoot, installs, enabled });
  const { dependencies, sources } = collectDependencies({ installs, enabled });
  const versions = Object.fromEntries(dependencies.map((d) => [d.name, d.version ?? "unknown"]));

  // The fast path is reported, never trusted: the full check is cheap in-process (it reads
  // directories, not eleven tool calls), so the stamp buys nothing worth a stale answer.
  const installedVersions = dependencyVersions(dependencies, installs ?? new Map());
  const cached = force ? null : readStamp(configDir);
  const freshness = stampIsFresh(cached, installedVersions);

  const status = computeDepsStatus(dependencies, available);
  const enforcement = enforcePolicies(status, { headless });
  const stampFile = writeStamp(configDir, status, { aborted: enforcement.abort, versions: installedVersions });

  return {
    deps_preflight: status,
    skills_source: available.source,
    fs_blind_to: available.fs_blind_to,
    skill_roots: available.roots,
    declared_by: sources,
    cache_hit: freshness.fresh,
    cache_stale_reason: freshness.reason,
    installed_versions: installedVersions,
    stamp_written: stampFile,
    prints: [renderPreflightPrint(status, { headless, versions })].filter(Boolean),
    ...enforcement,
  };
}
