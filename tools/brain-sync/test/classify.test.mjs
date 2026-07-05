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
    "plugins/workmanager-plugin/manifest.yaml",
    "plugins/workmanager-plugin/README.md",
    "plugins/sdlc/skills/x.md",
    "plugins/android-plugin/old.md", // unknown historical dir → ignored
    "README.md",
  ];
  assert.deepEqual(pluginsTouched(files), ["sdlc", "workmanager-plugin"]);
});

test("classify aggregates", () => {
  const c = classify({ title: "feat(room): dao (Roadmap C2)", files: ["plugins/room-plugin/x.md"] });
  assert.deepEqual(c, { type: "feat", plugins: ["room-plugin"], roadmap: "C2", slug: "dao-roadmap-c2" });
});
