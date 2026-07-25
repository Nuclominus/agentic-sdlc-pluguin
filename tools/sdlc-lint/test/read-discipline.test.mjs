import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { checkAnchor, scanAgentText, PATTERNS, checkReadDiscipline } from "../lib/read-discipline.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "read-discipline");
const fixture = (name) => readFileSync(join(FIX, name), "utf8");

test("anchor inside the stable prefix passes", () => {
  assert.deepEqual(checkAnchor(fixture("skill-ok.md")), { ok: true, errors: [] });
});

test("missing anchor is flagged", () => {
  const { ok, errors } = checkAnchor(fixture("skill-missing.md"));
  assert.equal(ok, false);
  assert.match(errors.join(" "), /missing 'Read discipline:'/);
});

test("anchor in the per-call trailer is flagged as displaced", () => {
  const { ok, errors } = checkAnchor(fixture("skill-displaced.md"));
  assert.equal(ok, false);
  assert.match(errors.join(" "), /must sit between/);
});

test("a file with no stable-prefix delimiters is a structural failure", () => {
  const { ok, errors } = checkAnchor("# nothing here\n");
  assert.equal(ok, false);
  assert.match(errors.join(" "), /delimiter/);
});

test("a prose mention of the delimiter above the template does not confuse the check", () => {
  assert.deepEqual(checkAnchor(fixture("skill-prose-mention.md")), { ok: true, errors: [] });
});

test("clean agent text passes — 'full stack trace' and 'no re-reads' are not violations", () => {
  assert.deepEqual(scanAgentText(fixture("agent-clean.md")), { ok: true, errors: [] });
});

test("each anti-pattern is flagged exactly once", () => {
  const { ok, errors } = scanAgentText(fixture("agent-violations.md"));
  assert.equal(ok, false);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /^line 3:/);
  assert.match(errors[1], /^line 4:/);
  assert.match(errors[2], /^line 5:/);
});

test("marker on the matching line suppresses it", () => {
  assert.equal(scanAgentText(fixture("agent-suppressed-same-line.md")).ok, true);
});

test("marker on the preceding line suppresses it", () => {
  assert.equal(scanAgentText(fixture("agent-suppressed-prev-line.md")).ok, true);
});

test("patterns are narrow: plural 're-reads' does not match", () => {
  assert.equal(PATTERNS.some((p) => p.test("no re-reads of the same file")), false);
});

test("patterns are narrow: 'read the full stack trace' does not match", () => {
  assert.equal(PATTERNS.some((p) => p.test("Read the full stack trace")), false);
});

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("driver returns one result row per agent file plus the skill", () => {
  const rows = checkReadDiscipline(REPO);
  assert.ok(rows.length > 5, `expected the skill + all agent files, got ${rows.length}`);
  assert.ok(rows.some((r) => r.file.endsWith("pipeline-orchestrator/SKILL.md")));
  assert.ok(rows.some((r) => r.file.endsWith("plugins/sdlc/agents/developer.md")));
});

test("a missing skill file is a tool error, not a violation", () => {
  const rows = checkReadDiscipline(resolve(REPO, "tools/sdlc-lint/fixtures"));
  const skill = rows.find((r) => r.file.endsWith("SKILL.md"));
  assert.equal(skill.ok, false);
  assert.equal(skill.tool_error, true);
});
