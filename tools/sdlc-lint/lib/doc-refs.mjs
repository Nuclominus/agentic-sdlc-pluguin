// Generalizes the CI's one-off "AAR reference integrity" grep block (ci.yml) into a reusable
// check: a backtick-quoted `<plugin>:<name>` reference in README/CONTRIBUTING/docs must resolve
// to a real agent, skill or command file. ADR-0021's own history is the reason this exists —
// android-workflow:aar → sdlc:aar shipped with a dangling reference the first time, and nothing
// caught it until CI grew a bespoke check for that one string.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "tinyglobby";

const REF_RE = /`([a-z][a-z0-9-]*):([a-z][a-z0-9-]*)`/g;

function pluginNamespaces(repoRoot) {
  const dirs = globSync("plugins/*/", { cwd: repoRoot, onlyDirectories: true });
  return new Set(dirs.map((d) => d.replace(/^plugins\//, "").replace(/\/$/, "")));
}

function refExists(repoRoot, namespace, name) {
  const base = join(repoRoot, "plugins", namespace);
  return (
    existsSync(join(base, "agents", `${name}.md`)) ||
    existsSync(join(base, "skills", name, "SKILL.md")) ||
    existsSync(join(base, "commands", `${name}.md`))
  );
}

export function checkDocRefs({ repoRoot }) {
  const namespaces = pluginNamespaces(repoRoot);
  const docFiles = [
    "README.md",
    "CONTRIBUTING.md",
    ...globSync("docs/**/*.md", { cwd: repoRoot }),
  ].filter((f) => existsSync(join(repoRoot, f)));

  const violations = [];
  for (const file of docFiles) {
    const text = readFileSync(join(repoRoot, file), "utf8");
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      for (const m of line.matchAll(REF_RE)) {
        const [, namespace, name] = m;
        if (!namespaces.has(namespace)) continue; // not every `word:word` is a plugin ref
        if (!refExists(repoRoot, namespace, name)) {
          violations.push({ file, line: i + 1, ref: `${namespace}:${name}` });
        }
      }
    });
  }
  return { ok: violations.length === 0, violations };
}
