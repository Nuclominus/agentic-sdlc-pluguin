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

import { accessSync, constants, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { readSkillSet, assignedSkills, skillTools } from "./skillsets.mjs";

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
export function enumerateSkills({ configDir, projectRoot, installs = new Map(), enabled = {}, workspaceSkillDirs = null } = {}) {
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

  // Project-local skill directories are the HOST's, declared in roots.mjs. The
  // literal `.claude/skills` is the fallback for a caller with no roots to hand.
  // Antigravity loads them from `<workspace>/.agents/skills`, so scanning
  // `.claude/skills` there counted skills that CLI will never load -- a mandated
  // skill reading as satisfied when it is not -- while missing the ones it does.
  const projectSkillDirs = workspaceSkillDirs
    ?? (projectRoot ? [join(projectRoot, ".claude", "skills")] : []);
  for (const [dir, kind] of [
    [configDir ? join(configDir, "skills") : null, "user"],
    ...projectSkillDirs.map((d) => [d, "project"]),
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
 * Is `name` an executable on PATH? A directory scan, never a spawn — this runs on every plan, and
 * "is the binary there" is the only question the preflight asks (versions are the doctor's job).
 */
export function whichTool(name, env = process.env) {
  const exts = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of String(env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const file = join(dir, name + ext);
      try { accessSync(file, constants.X_OK); return file; } catch { /* keep looking */ }
    }
  }
  return null;
}

/** `$HOME/...` in a declared path, expanded against the given environment. */
export function expandHome(path, env = process.env) {
  if (typeof path !== "string") return null;
  return path.replace(/^\$HOME(?=\/|$)/, env.HOME ?? "").replace(/^~(?=\/|$)/, env.HOME ?? "");
}

/**
 * ADR-0036 — a `kind: skill-catalog` dependency declares no `skills_used` of its own: the list is
 * DERIVED from its skill set (every skill some role receives), and so are the host tools each of
 * those skills needs. One file answers "which role gets it" and "what must be installed", so the
 * two can never disagree.
 */
function expandSkillCatalog(dep, pluginDir) {
  if (dep?.kind !== "skill-catalog" || typeof dep.skill_set !== "string") return dep;
  const doc = readSkillSet(join(pluginDir, dep.skill_set));
  if (!doc) return { ...dep, skills_used: dep.skills_used ?? [] };
  return { ...dep, skills_used: assignedSkills(doc), skill_tools: skillTools(doc) };
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
    for (const raw of doc.dependencies) {
      if (!raw || !raw.name) continue;
      const dep = expandSkillCatalog(raw, info.installPath);
      const prev = merged.get(dep.name);
      if (!prev) { merged.set(dep.name, { ...dep, declared_by: [key] }); continue; }
      prev.declared_by.push(key);
      prev.skills_used = [...new Set([...(prev.skills_used ?? []), ...(dep.skills_used ?? [])])];
      if (dep.skill_tools) prev.skill_tools = { ...(prev.skill_tools ?? {}), ...dep.skill_tools };
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
 *
 * A skill whose declared host tool is not on PATH (`skill_tools`, ADR-0036) is installed but NOT
 * usable: it lands in `unavailable_skills` beside the missing ones, and the tool in
 * `missing_tools`. `unavailable_skills` is what the per-skill downgrade reads.
 */
export function computeDepsStatus(dependencies, available, { which = whichTool } = {}) {
  const status = {};
  const toolCache = new Map();
  const onPath = (t) => {
    if (!toolCache.has(t)) toolCache.set(t, Boolean(which(t)));
    return toolCache.get(t);
  };
  for (const dep of dependencies) {
    const used = dep.skills_used ?? [];
    const missing = used.filter((s) => !available.skills.has(`${dep.name}:${s}`) && !available.skills.has(s));
    const missingTools = new Set();
    const toolBlocked = used.filter((s) => {
      if (missing.includes(s)) return false;
      const gone = (dep.skill_tools?.[s] ?? []).filter((t) => !onPath(t));
      for (const t of gone) missingTools.add(t);
      return gone.length > 0;
    });
    const unavailable = [...missing, ...toolBlocked];
    status[dep.name] = unavailable.length === 0
      ? { status: "available", missing_skills: [] }
      : {
        status: "missing",
        missing_skills: missing,
        ...(dep.skill_tools ? { missing_tools: [...missingTools].sort(), unavailable_skills: unavailable } : {}),
        policy: dep.policy ?? "warn",
        install_command: dep.install_command ?? [],
        fallback_note: dep.fallback_note ?? null,
      };
  }
  return status;
}

/** At most `n` names, then a count — a 25-skill catalog must not turn one WARN into a paragraph. */
const listSome = (names, n = 8) => names.length <= n ? names.join(",") : `${names.slice(0, n).join(",")} (+${names.length - n} more — /sdlc:doctor lists them)`;

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
  const unavailableSkills = {};

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
    unavailableSkills[name] = s.unavailable_skills ?? s.missing_skills;
    if (policy === "warn") {
      if (s.missing_skills.length) stdout.push(`WARN: ${name} missing skills: ${listSome(s.missing_skills)}`);
      if (s.missing_tools?.length) stdout.push(`WARN: ${name} missing tools: ${s.missing_tools.join(",")} — skills needing them are best-effort`);
    }
    // graceful-degrade: flag only, silent by contract.
  }
  return { abort: blocking.length > 0, blocking, stdout, flags, unavailable_skills: unavailableSkills, headless };
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
    lines.push(`     missing: ${s.missing_skills.length ? listSome(s.missing_skills).replaceAll(",", ", ") : "—"}`);
    if (s.missing_tools?.length) lines.push(`     missing tools: ${s.missing_tools.join(", ")}`);
  }
  return lines.join("\n");
}

export function readStamp(configDir) {
  return readJson(join(configDir, STAMP));
}

/**
 * The installed version of each declared dependency — what a stamp must be keyed to.
 *
 * A dependency that is not a plugin (a skill catalog installed by its own CLI) names a
 * `version_file` instead; its contents are the version. Without it, updating the catalog would
 * move nothing the stamp is keyed on — the exact staleness `stampIsFresh` exists to catch.
 */
export function dependencyVersions(dependencies, installs = new Map(), env = process.env) {
  const out = {};
  for (const dep of dependencies) {
    for (const [key, info] of installs) {
      if (pluginNameOf(key) === dep.name) { out[dep.name] = info.version ?? null; break; }
    }
    if (!(dep.name in out) && typeof dep.version_file === "string") {
      try { out[dep.name] = readFileSync(expandHome(dep.version_file, env), "utf8").trim() || null; } catch { /* absent */ }
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
export function preflight({ configDir, projectRoot, installs, enabled, skills = null, headless = false, force = false, workspaceSkillDirs = null, env = process.env, which = (t) => whichTool(t, env), stamp = true } = {}) {
  const available = skills ? skillsFromList(skills) : enumerateSkills({ configDir, projectRoot, installs, enabled, workspaceSkillDirs });
  const { dependencies, sources } = collectDependencies({ installs, enabled });
  // The fast path is reported, never trusted: the full check is cheap in-process (it reads
  // directories, not eleven tool calls), so the stamp buys nothing worth a stale answer.
  const installedVersions = dependencyVersions(dependencies, installs ?? new Map(), env);
  // The declared range when there is one (`>=1.0.0`); otherwise what is installed — a skill catalog
  // declares no range, and "unknown" beside a version file that says 1.0.16406183 is a false blank.
  const versions = Object.fromEntries(dependencies.map((d) => [d.name, d.version ?? installedVersions[d.name] ?? "unknown"]));
  const cached = force ? null : readStamp(configDir);
  const freshness = stampIsFresh(cached, installedVersions);

  const status = computeDepsStatus(dependencies, available, { which });
  const enforcement = enforcePolicies(status, { headless });
  // `stamp: false` is the read-only caller (the doctor): diagnosing must not move the fast path.
  const stampFile = stamp ? writeStamp(configDir, status, { aborted: enforcement.abort, versions: installedVersions }) : null;

  return {
    deps_preflight: status,
    // The enumerated set travels with the result: Step 1b-ext needs it to decide whether an
    // extension skill exists, and recomputing it there would be a second enumeration that
    // could disagree with this one.
    available_skills: available.skills,
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
