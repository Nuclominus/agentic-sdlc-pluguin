// Dependency-free glob matching, SHIPPED inside the sdlc plugin.
//
// The plugin has no package.json and no node_modules — every shipped tool imports
// `node:` builtins and its own siblings, nothing else (see PLUGIN-PATHS.md). The dev/CI
// lint may depend on `tinyglobby`; a consumer running `${CLAUDE_PLUGIN_ROOT}/tools/...`
// has no such thing. This module is the replacement for the globbing that
// `tools/sdlc-lint/lib/detect.mjs` does today.
//
// Semantics are deliberately the SUBSET the manifests actually use, and no more:
//   `**`  zero or more path segments
//   `*`   any run of characters within one segment (never crosses `/`)
//   `?`   one character within one segment
// Dotfiles are matched (the lint globs with `dot: true`, and parity with it is what the
// detect fixtures assert).
//
// Everything here terminates EARLY: callers ask "is there any match" or "does any match
// contain X", never "give me every match". A negative answer still walks the tree, which
// is exactly what the library does today; a positive one usually stops after a few reads.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const MAGIC = /[*?]/;

function segmentToRegExpSource(seg) {
  let out = "";
  for (const ch of seg) {
    if (ch === "*") out += "[^/]*";
    else if (ch === "?") out += "[^/]";
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return out;
}

/**
 * Compile a glob into a matcher over POSIX-style paths relative to the walk root.
 *
 * Returns `{ test, literal, maxDepth, prefix }` where `literal` is the pattern itself when
 * it contains no magic (the caller can then skip walking entirely), `maxDepth` bounds the
 * walk when the pattern has no `**`, and `prefix` is the leading run of magic-free segments
 * (so `gradle/libs.versions.toml` never lists the repository root).
 */
export function compileGlob(pattern) {
  const segs = String(pattern).split("/").filter((s) => s.length > 0);
  const prefix = [];
  for (const s of segs) {
    if (MAGIC.test(s) || s === "**") break;
    prefix.push(s);
  }
  const literal = segs.some((s) => s === "**" || MAGIC.test(s)) ? null : segs.join("/");
  const hasGlobstar = segs.includes("**");

  let src = "^";
  segs.forEach((s, i) => {
    if (s === "**") {
      // `**/` -> zero or more segments. Written so that `**/x` also matches a bare `x`.
      src += i === segs.length - 1 ? "(?:.*)" : "(?:[^/]+/)*";
    } else {
      src += segmentToRegExpSource(s);
      if (i < segs.length - 1 && segs[i + 1] !== "**") src += "/";
      else if (i < segs.length - 1) src += "/";
    }
  });
  src += "$";
  // A `**` in the middle already consumed its own trailing slash; collapse any doubles.
  const re = new RegExp(src.replace(/\/\//g, "/"));

  return {
    test: (relPosix) => re.test(relPosix),
    literal,
    prefix: prefix.join("/"),
    maxDepth: hasGlobstar ? Infinity : segs.length,
  };
}

/**
 * Lazily yield every file under `root` matching `pattern`, as an absolute path.
 *
 * A generator rather than an array so `for (… of …) { return true }` stops the walk on the
 * first hit. Unreadable directories are skipped, never thrown on: detection runs against
 * whatever the consumer's checkout happens to contain, including trees the process cannot
 * enter, and one EACCES must not abort a pipeline.
 */
export function* iterFiles(root, pattern) {
  const g = compileGlob(pattern);

  if (g.literal !== null) {
    const abs = join(root, ...g.literal.split("/"));
    if (existsSync(abs)) {
      try { if (statSync(abs).isFile()) yield abs; } catch { /* raced or unreadable */ }
    }
    return;
  }

  const base = g.prefix ? join(root, ...g.prefix.split("/")) : root;
  if (!existsSync(base)) return;

  const stack = [{ dir: base, rel: g.prefix ? g.prefix.split("/") : [] }];
  while (stack.length) {
    const { dir, rel } = stack.pop();
    if (rel.length > g.maxDepth) continue;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const relPath = [...rel, e.name];
      if (e.isDirectory()) {
        if (relPath.length < g.maxDepth) stack.push({ dir: join(dir, e.name), rel: relPath });
      } else if (e.isFile() && g.test(relPath.join("/"))) {
        yield join(dir, e.name);
      }
    }
  }
}

/** True as soon as one file matches — the common case, and the reason iterFiles is lazy. */
export function anyFile(root, pattern) {
  for (const _ of iterFiles(root, pattern)) return true;
  return false;
}

/** Relative POSIX path, for callers that report matches rather than consume them. */
export function toPosixRelative(root, abs) {
  return abs.startsWith(root) ? abs.slice(root.length).replace(/^[/\\]/, "").split(sep).join("/") : abs;
}
