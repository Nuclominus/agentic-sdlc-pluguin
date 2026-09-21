// ADR-0026's embedded-frameworks `frameworks[]` row description
// (schemas/manifest.schema.json's `frameworks` property) claims: "`stack` must be unique across
// all rows and must not collide with any foundation's own `stack` id — enforced by
// `tools/sdlc-lint`". JSON Schema cannot express a cross-item / cross-document uniqueness
// constraint like that on its own, which is why this is a structural check, sibling to
// `checkNestedManifest` in this directory, rather than an extension of `schema.mjs`'s AJV pass.
//
// Without this, a second row with `stack: retrofit`, or a row whose `stack` collides with a
// foundation's own `stack` id, passes AJV and `sdlc-lint all` cleanly. At load time
// `manifests.mjs`'s `classify()` de-dups by `stack` and silently drops one side, reporting it as
// `superseded-by-embedded` — a reason that misattributes a genuine collision as the (unrelated,
// legitimate) stale-standalone-copy case. A framework's injections vanish with a misleading
// warning instead of a load-time failure that names the real cause.
//
// Three collision classes, all keyed on the same `stack` string:
//   a. two embedded `frameworks[]` rows sharing a `stack` — within one foundation, or across
//      two different foundations.
//   b. an embedded row whose `stack` collides with any foundation's own `stack` id.
//   c. an embedded row whose `stack` collides with a standalone `kind: framework` manifest's
//      `stack`. No standalone framework manifests exist in-tree today (ADR-0026 folded them all
//      into their foundations), so this class currently never fires — but the rule holds
//      regardless of how many standalone framework plugins exist, so it is checked unconditionally
//      rather than special-cased away.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "tinyglobby";
import YAML from "yaml";

// `file` stays repo-relative (for reporting, matching checkNestedManifest's convention);
// reading needs it resolved against `root` — globSync's `cwd` option does not make the
// returned paths absolute unless `absolute: true` is also passed.
function readManifest(root, file) {
  try {
    return { file, doc: YAML.parse(readFileSync(join(root, file), "utf8")) };
  } catch (e) {
    return { file, error: `read/parse: ${e.message}` };
  }
}

/**
 * @param {string} root repo root
 * @returns {Array<{file: string, ok: boolean, errors: string[]}>} one result per offending
 *   manifest — a manifest that owns or hosts a colliding `stack` id. Manifests with no
 *   collision are not reported at all (mirrors `checkNestedManifest`'s "violations only" shape).
 */
export function checkStackUniqueness(root = process.cwd()) {
  const files = globSync("plugins/*/manifest.yaml", { cwd: root, absolute: false }).sort();
  const records = files.map((f) => readManifest(root, f));

  // One entry per (file, stack) — a foundation's own stack id, each of its embedded rows, and
  // a standalone framework's stack — tagged with what it is, so the message can name the
  // actual collision instead of a bare "duplicate stack".
  const entries = [];
  for (const r of records) {
    if (r.error) continue; // schema.mjs already reports unreadable/unparseable manifests
    const kind = r.doc?.kind;
    if (kind === "foundation") {
      if (r.doc?.stack) entries.push({ file: r.file, stack: r.doc.stack, kind: "foundation" });
      for (const row of r.doc?.frameworks ?? []) {
        if (row?.stack) entries.push({ file: r.file, stack: row.stack, kind: "embedded framework row" });
      }
    } else if (kind === "framework") {
      if (r.doc?.stack) entries.push({ file: r.file, stack: r.doc.stack, kind: "standalone framework" });
    }
  }

  const byStack = new Map();
  for (const e of entries) {
    if (!byStack.has(e.stack)) byStack.set(e.stack, []);
    byStack.get(e.stack).push(e);
  }

  const results = [];
  for (const [stack, group] of byStack) {
    if (group.length < 2) continue;
    for (const e of group) {
      const others = group.filter((o) => o !== e).map((o) => `${o.file} (${o.kind})`).join(", ");
      results.push({
        file: e.file,
        ok: false,
        errors: [
          `stack '${stack}' (${e.kind}) collides with: ${others} — a foundation's own \`stack\` ` +
          `id and every embedded/standalone framework \`stack\` must be unique across the repo ` +
          `(ADR-0026); classify()'s de-dup would otherwise silently drop one side.`,
        ],
      });
    }
  }
  return results.sort((a, b) => a.file.localeCompare(b.file) || a.errors[0].localeCompare(b.errors[0]));
}
