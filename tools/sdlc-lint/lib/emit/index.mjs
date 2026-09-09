// Track J emitter — renders a host-specific plugin package from the Claude Code
// SSOT under plugins/.
//
// The design premise, and why this file is short: Antigravity accepts the
// authored tree almost unchanged. Observed on agy 1.1.27 against a probe built
// from unmodified plugins/sdlc, `agy plugin validate` reported
// `commands: 11 processed (converted to skills)` and every installed file was
// byte-identical to its source. So the host does the command->skill conversion
// itself, and the emitter is a REPACKAGER: two file moves, one frontmatter
// rewrite, one hook-event filter. Anything the host already does correctly is a
// transform we must not write, because a transform we write is a transform that
// can drift (ADR-0021 §5 — no translation layers).
//
// Emission is pure: it returns a plan (path -> action), it does not touch disk.
// cli.mjs writes it; lib/emit/check.mjs compares it against dist/ without
// writing anything. That split is what lets `emit --check` run in CI while
// `emit` never does.
//
// Source-tree only — never runs at pipeline runtime (like lib/plugin-paths.mjs).

import { readFileSync, existsSync } from "node:fs";
import { join, relative, posix } from "node:path";
import { globSync } from "tinyglobby";
import { frontmatter } from "../agent-tools.mjs";
import { resolveModel } from "./models.mjs";
import { overlaysFor, applyOverlays } from "./overlay.mjs";

/** Where emitted packages land, relative to the repo root. */
export const DIST_ROOT = "dist";

/**
 * Load a host descriptor.
 * @param {string} root  repo root
 * @param {string} name  host id, e.g. "antigravity"
 * @returns {object}
 */
export function loadHost(root, name) {
  const p = join(root, "tools", "sdlc-lint", "hosts", `${name}.json`);
  if (!existsSync(p)) throw new Error(`no host descriptor: tools/sdlc-lint/hosts/${name}.json`);
  return JSON.parse(readFileSync(p, "utf8"));
}

/** Host ids that have a descriptor on disk. */
export function listHosts(root) {
  return globSync("tools/sdlc-lint/hosts/*.json", { cwd: root })
    .map((p) => posix.basename(p, ".json"))
    .sort();
}

/**
 * Rewrite one agent definition's frontmatter for a host.
 *
 * Line-level substitution, deliberately not a YAML round-trip: a description is
 * often a `|` block carrying <example> markup and bilingual trigger lists, and
 * re-serializing it would rewrite bytes nobody asked to change — which would
 * then show up as noise in every `dist/` diff and hide the real ones.
 *
 * @param {string} text  raw agent .md
 * @param {object} host
 * @returns {{ ok: boolean, text: string|null, changes: string[], error: string|null }}
 */
export function rewriteAgent(text, host) {
  const fm = frontmatter(text);
  if (fm === null) return { ok: false, text: null, changes: [], error: "no YAML frontmatter" };

  const tier = fm.match(/^model:\s*(\S+)\s*$/m)?.[1] ?? null;
  const effort = fm.match(/^effort:\s*(\S+)\s*$/m)?.[1] ?? null;
  const r = resolveModel(tier, effort, host);
  if (!r.ok) return { ok: false, text: null, changes: [], error: r.error };

  const changes = [];
  let out = text.replace(/^model:\s*\S+\s*$/m, `model: ${r.model}`);
  changes.push(`model: ${tier} -> ${r.model}`);

  if (r.effort === null && effort !== null) {
    // The effort is inside the model id now. Drop the key rather than leave a
    // second, independently-editable spelling of the same decision.
    out = out.replace(/^effort:\s*\S+\s*\n/m, "");
    changes.push(`effort: ${effort} -> folded into model id`);
  }
  return { ok: true, text: out, changes, error: null };
}

/**
 * Filter a hooks config down to the events a host actually fires.
 *
 * A hook registered on an event the host does not have is not inert-but-harmless:
 * it reads as coverage that does not exist. Dropping it here makes the loss
 * explicit in the emit report, which is what `emit --check`'s declared-drops axis
 * then holds us to.
 *
 * @param {string} text  raw hooks.json
 * @param {object} host
 * @returns {{ ok: boolean, json: object|null, dropped: string[], error: string|null }}
 */
export function rewriteHooks(text, host) {
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { return { ok: false, json: null, dropped: [], error: `unparseable hooks.json: ${e.message}` }; }

  const supported = new Set(host?.hook_events?.supported ?? []);
  const dropScripts = host?.drop_hooks ?? [];
  const events = parsed?.hooks ?? {};
  const kept = {};
  const dropped = [];

  /** The handler scripts a group registers, by basename — what a drop actually costs. */
  const scriptsOf = (groups) => [...new Set((Array.isArray(groups) ? groups : [])
    .flatMap((g) => g.hooks ?? [])
    .map((h) => (String(h.command ?? "").match(/([\w.-]+\.sh)/) ?? [])[1])
    .filter(Boolean))];

  for (const [event, groups] of Object.entries(events)) {
    if (!supported.has(event)) {
      // Name the scripts. "The host does not fire X" tells a reader which event
      // went missing but not which capability did, and the drops table is read
      // by someone deciding whether they can live without it.
      const lost = scriptsOf(groups);
      dropped.push({
        what: event,
        reason: `host ${host.host} does not fire the ${event} hook event`
          + (lost.length ? `, so ${lost.join(", ")} never runs` : ""),
      });
      continue;
    }

    // A matcher group survives only if at least one of its handlers does. An
    // empty group left behind would register the event for nothing, and read as
    // coverage that isn't there.
    const keptGroups = [];
    for (const group of Array.isArray(groups) ? groups : []) {
      const handlers = (group.hooks ?? []).filter((h) => {
        const hit = dropScripts.find((d) => typeof h.command === "string" && h.command.includes(d.script));
        if (hit) dropped.push({ what: `${event}:${hit.script}`, reason: hit.reason });
        return !hit;
      });
      if (handlers.length) keptGroups.push({ ...group, hooks: handlers });
    }
    if (keptGroups.length) kept[event] = keptGroups;
    else dropped.push({ what: `${event} (empty)`, reason: `every handler on ${event} was dropped, so the event registration goes with them` });
  }
  return { ok: true, json: { ...parsed, hooks: kept }, dropped, error: null };
}

/**
 * Build the emission plan for one plugin.
 *
 * @param {string} root        repo root
 * @param {string} pluginName  directory name under plugins/
 * @param {object} host
 * @returns {{ outputs: Map<string, {kind: string, content?: string, from?: string}>, drops: Array<object>, errors: string[] }}
 */
export function emitPlugin(root, pluginName, host) {
  const src = join(root, "plugins", pluginName);
  if (!existsSync(src)) throw new Error(`no such plugin: plugins/${pluginName}`);
  const outDir = posix.join(DIST_ROOT, host.host, "plugins", pluginName);

  const outputs = new Map();
  const drops = [];
  const errors = [];

  const moves = new Map((host.package?.moves ?? []).map((m) => [m.from, m.to]));

  const files = globSync("**/*", { cwd: src, dot: true, onlyFiles: true, ignore: ["**/.DS_Store"] }).sort();

  for (const rel of files) {
    const abs = join(src, rel);

    // Moved files are emitted under their new name, below.
    if (moves.has(rel)) continue;

    // Overlay sources are build INPUTS, not package content — they have already
    // landed, spliced into the skill body above. Not recorded as a drop: the
    // drops list is for things that would otherwise have shipped, and padding it
    // with build inputs trains the reader to skim it.
    if (rel.startsWith("hosts/")) continue;

    // One registry per dispatcher: a package carries its own and no other. Shipping
    // the whole set would put a price list in every package that it can never use,
    // alongside tiers that do not exist at its runtime.
    const registry = rel.match(/^config\/models\/([^/]+)\.yaml$/)?.[1];
    if (registry && registry !== host.host) {
      drops.push({ path: rel, reason: `model registry for host ${registry}; this package is ${host.host}` });
      continue;
    }

    if (rel.startsWith(".claude-plugin/")) {
      drops.push({ path: rel, reason: "Claude-Code-only manifest directory; the manifest is moved to the plugin root" });
      continue;
    }

    const skill = rel.match(/^skills\/([^/]+)\/SKILL\.md$/)?.[1];
    if (skill) {
      const overlays = overlaysFor(root, pluginName, host.host, skill);
      if (overlays.size) {
        const r = applyOverlays(readFileSync(abs, "utf8"), overlays);
        if (!r.ok) { errors.push(...r.errors.map((e) => `${pluginName}/${rel}: ${e}`)); continue; }
        outputs.set(posix.join(outDir, rel), { kind: "rewrite", content: r.text, changes: r.applied.map((a) => `overlay ${a}`) });
        continue;
      }
    }

    if (/^agents\/[^/]+\.md$/.test(rel)) {
      const r = rewriteAgent(readFileSync(abs, "utf8"), host);
      if (!r.ok) { errors.push(`${pluginName}/${rel}: ${r.error}`); continue; }
      outputs.set(posix.join(outDir, rel), { kind: "rewrite", content: r.text, changes: r.changes });
      continue;
    }

    // A command's skill name comes from its FILENAME on hosts that register
    // skills in one global namespace, so the plugin namespace has to live in the
    // name. Body untouched — this is a rename, not a rewrite.
    const command = host.package?.command_prefix && rel.match(/^commands\/([^/]+\.md)$/)?.[1];
    if (command && !command.startsWith(host.package.command_prefix)) {
      outputs.set(posix.join(outDir, "commands", host.package.command_prefix + command),
        { kind: "copy", from: posix.join("plugins", pluginName, rel) });
      continue;
    }

    outputs.set(posix.join(outDir, rel), { kind: "copy", from: posix.join("plugins", pluginName, rel) });
  }

  // Every non-Claude package declares which host it is for. Shipped tools read
  // this instead of probing the environment, because an env guess is wrong in
  // exactly the cases that matter and a wrong answer silently changes how cost is
  // accounted. Absence means Claude Code — the tree authors work in.
  if (pluginName === "sdlc") {
    outputs.set(posix.join(outDir, "config", "host.json"), {
      kind: "rewrite",
      content: JSON.stringify({
        _comment: "Written by `sdlc-lint emit`. Declares which host this package was built for; tools/resolve/host.mjs reads it. Do not hand-edit — regenerate.",
        host: host.host,
        telemetry_mode: host.telemetry?.mode ?? "none",
        // Whether a dispatch can carry a model at all. False means each agent
        // file's model was baked at build time, so a project's tier override has
        // no mechanism to take effect and must be reported inert rather than
        // previewed as active (ADR-0022 §4).
        model_arg: host.dispatch?.model_arg !== false,
        host_cli_version: host.verified_on?.cli_version ?? null,
        config_dir_env: host.discovery?.config_dir_env ?? null,
        config_dir_default: host.discovery?.config_dir_default ?? null,
        workspace_plugin_subdirs: host.discovery?.workspace_plugin_subdirs ?? [],
        plugin_search_subdirs: host.discovery?.plugin_search_subdirs ?? [],
      }, null, 2) + "\n",
    });
  }

  for (const [from, to] of moves) {
    const abs = join(src, from);
    if (!existsSync(abs)) continue;             // not every plugin ships hooks
    if (posix.basename(to) === "hooks.json") {
      const r = rewriteHooks(readFileSync(abs, "utf8"), host);
      if (!r.ok) { errors.push(`${pluginName}/${from}: ${r.error}`); continue; }
      for (const d of r.dropped) drops.push({ path: `${from}#${d.what}`, reason: d.reason });
      outputs.set(posix.join(outDir, to), { kind: "rewrite", content: JSON.stringify(r.json, null, 2) + "\n" });
    } else {
      outputs.set(posix.join(outDir, to), { kind: "copy", from: posix.join("plugins", pluginName, from) });
    }
  }

  return { outputs, drops, errors };
}

/** Every plugin directory under plugins/, sorted. */
export function listPlugins(root) {
  return globSync("plugins/*/manifest.yaml", { cwd: root })
    .map((p) => p.split("/")[1])
    .sort();
}

/**
 * The package's install instructions, rendered from the descriptor.
 *
 * Claude Code has a marketplace manifest that makes a nine-plugin tree
 * installable in one line. Neither other host does, so what replaces it is
 * prose — and prose that ships next to a generated tree has to be generated
 * too, or the first descriptor change makes it quietly wrong. It is written
 * from the same `install` block the descriptor already carries, so `emit
 * --check` covers it on all three axes like every other emitted file.
 *
 * The drops table is the point of the second half. ADR-0022 §4 says a lost
 * capability is stated rather than substituted; a reason recorded only in a
 * build log is not stated to the person who installs the thing.
 */
function renderInstallDoc(host, plugins, drops) {
  const cmd = (host.install?.command ?? ["<install>"]).join(" ");
  const un = cmd.replace(/\binstall\b/, "uninstall");
  const L = [];

  L.push(`# Installing the SDLC Marketplace on ${host.host}`, "");
  L.push("<!-- Generated by `sdlc-lint emit`. Do not hand-edit — regenerate. -->", "");
  L.push(`Built for \`${host.cli}\` ${host.verified_on?.cli_version ?? "(version unrecorded)"}, verified ${host.verified_on?.date ?? "(date unrecorded)"}.`, "");

  L.push("## Install", "");
  L.push("There is no marketplace manifest on this host, so each plugin is installed by path.");
  L.push("Order does not matter; the core carries the pipeline and the rest add stack knowledge.", "");
  L.push("```bash");
  for (const p of plugins) L.push(`${cmd} dist/${host.host}/plugins/${p}`);
  L.push("```", "");

  if (host.install?.merges_not_replaces) {
    L.push("## Reinstalling", "");
    L.push(`\`${cmd}\` **merges** into an existing install of the same name rather than replacing it.`);
    L.push("A file that was renamed or removed upstream therefore survives as an orphan beside its");
    L.push("replacement. Uninstall first whenever file names may have changed:", "");
    L.push("```bash", `${un} <plugin>`, `${cmd} dist/${host.host}/plugins/<plugin>`, "```", "");
  }

  const envName = host.discovery?.config_dir_env;
  if (envName) {
    L.push("## Where it lands", "");
    L.push(`Installs are **global**: measured on ${host.cli} ${host.verified_on?.cli_version}, \`${envName}\``);
    L.push(`is ignored by both install and list, and plugins always land under \`$HOME/${host.discovery?.config_dir_default}\`.`);
    L.push("A throwaway config directory cannot isolate an install on this host.", "");
  }

  L.push("## Verify", "");
  L.push("```bash");
  L.push(`${(host.validate?.command ?? ["<validate>"]).join(" ")} dist/${host.host}/plugins/sdlc`);
  L.push(`${(host.install?.command ?? []).slice(0, -1).join(" ")} list`);
  L.push("```", "");
  L.push("Then run `/sdlc-doctor` in a project to check stack detection and dependencies.", "");

  if (drops.length) {
    L.push("## What this package does not carry", "");
    L.push("Every omission below is deliberate and has a reason. Nothing is silently missing.", "");
    L.push("| Plugin | Dropped | Why |", "| --- | --- | --- |");
    for (const d of drops) {
      const why = String(d.reason).replace(/\s+/g, " ").replace(/\|/g, "\\|");
      L.push(`| ${d.plugin} | \`${d.path}\` | ${why} |`);
    }
    L.push("");
  }
  return L.join("\n");
}

/**
 * Build the emission plan for every plugin a host should carry.
 * @param {string} root
 * @param {object} host
 * @param {{ plugins?: string[] }} [opts]  override the host descriptor's `plugins`
 */
export function emitAll(root, host, opts = {}) {
  const names = opts.plugins ?? host.plugins ?? listPlugins(root);
  const outputs = new Map();
  const drops = [];
  const errors = [];
  for (const name of names) {
    const r = emitPlugin(root, name, host);
    for (const [k, v] of r.outputs) outputs.set(k, v);
    drops.push(...r.drops.map((d) => ({ ...d, plugin: name })));
    errors.push(...r.errors);
  }
  outputs.set(posix.join(DIST_ROOT, host.host, "INSTALL.md"), {
    kind: "rewrite",
    content: renderInstallDoc(host, names, drops),
  });
  return { outputs, drops, errors, plugins: names };
}
