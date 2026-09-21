import { test } from "node:test";
import assert from "node:assert/strict";
import { changeType, roadmapTag, slug, pluginsTouched, classify, stripPrefix } from "../lib/classify.mjs";

test("changeType parses conventional-commit prefixes", () => {
  assert.equal(changeType("feat(sdlc): add x"), "feat");
  assert.equal(changeType("feat(config)!: breaking"), "feat");
  assert.equal(changeType("docs+chore: sync readme"), "docs+chore");
  assert.equal(changeType("no prefix here"), "other");
});

test("roadmapTag extracts the roadmap id", () => {
  assert.equal(roadmapTag("feat(sdlc): rollup (Roadmap B2)"), "B2");
  assert.equal(roadmapTag("feat: nothing tagged"), null);
});

test("slug strips prefix and kebab-cases", () => {
  assert.equal(slug("feat(workmanager): WorkManager framework provider (Roadmap C2)"),
    "workmanager-framework-provider-roadmap-c2");
  assert.equal(stripPrefix("fix(sdlc): pass short tier"), "pass short tier");
});

test("pluginsTouched keeps only known plugins, sorted, deduped", () => {
  const files = [
    "plugins/android-foundation/manifest.yaml",
    "plugins/android-foundation/README.md",
    "plugins/sdlc/skills/x.md",
    // ADR-0026: the additive Android framework plugins were merged into android-foundation
    // and are no longer KNOWN_PLUGINS — a path under one of their old dirs is ignored, same
    // as any other unknown historical dir.
    "plugins/workmanager-plugin/old.md",
    "README.md",
  ];
  assert.deepEqual(pluginsTouched(files), ["android-foundation", "sdlc"]);
});

test("classify aggregates", () => {
  const c = classify({ title: "feat(android-foundation): embed frameworks (Roadmap C3)", files: ["plugins/android-foundation/x.md"] });
  assert.deepEqual(c, { type: "feat", plugins: ["android-foundation"], roadmap: "C3", slug: "embed-frameworks-roadmap-c3" });
});
