// ADR-0036: a skill set is the per-role matrix for an external skill catalog (Google's
// android/skills is the first). `plugins/<p>/skill-sets/<set>.yaml` is the ONE place its
// assignments are authored; everything a human reads — the full matrix table and the per-role
// summary in the plugin README — is rendered from it, and this check fails when either drifts.
//
// The schema (schemas/skill-set.schema.json, via `sdlc-lint schema`) owns shape. This owns the
// invariants a schema cannot express:
//
//   scope     every assigned role is one its category allows — the guard that keeps the
//             security-analyst away from UI skills. A matrix is a statement of responsibility;
//             an out-of-scope row is a review finding the reviewer would otherwise have to spot
//             in a 25-row YAML diff.
//   roster    role names are core roles (read from the core manifest, never duplicated here).
//   triage    `unassigned: "TRIAGE …"` is what the sync writes for a skill nobody reviewed; it
//             must not merge.
//   when      dispatch-scoped, same rule and same regex as `role_expertise` rows (roster.mjs).
//   collision a bare catalog id that equals a skill this marketplace ships would make the bare
//             name ambiguous in every prompt that renders it.
//   render    the generated table and README block are byte-identical to a fresh render.
//
// Source-tree only, like roster.mjs — the runtime reader lives under plugins/sdlc/tools/resolve/.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { globSync } from "tinyglobby";
import YAML from "yaml";
import { CORE_MANIFEST, RUN_SCOPED, boundAgents } from "./roster.mjs";

export const SKILL_SET_GLOB = "plugins/*/skill-sets/*.yaml";
const TRIAGE = /^TRIAGE\b/;

/** Core roles in roster order: phase-bound first (manifest order), then on-demand. */
export function coreRoleOrder(core) {
  const out = [];
  for (const r of [...boundAgents(core?.agents_per_phase), ...(core?.on_demand_agents ?? [])]) {
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

const policyOf = (a) => a?.policy ?? "recommended";

/**
 * @param {object} doc parsed skill set
 * @param {{ coreRoles: string[], shippedSkills?: Set<string> }} ctx
 * @returns {string[]} errors
 */
export function validateSkillSet(doc, { coreRoles, shippedSkills = new Set() }) {
  const errors = [];
  const roles = new Set(coreRoles);
  const categories = doc?.categories ?? {};

  for (const [cid, cat] of Object.entries(categories)) {
    for (const r of cat?.roles ?? []) {
      if (!roles.has(r)) errors.push(`categories.${cid}.roles: '${r}' is not a core role (${coreRoles.join(", ")})`);
    }
  }

  const seen = new Set();
  for (const s of doc?.skills ?? []) {
    const id = s?.id ?? "(unnamed)";
    if (seen.has(id)) errors.push(`skills: '${id}' appears twice — every catalog skill has exactly one row`);
    seen.add(id);

    if (shippedSkills.has(id)) {
      errors.push(`skills: '${id}' collides with a skill this marketplace ships (plugins/*/skills/${id}) — the bare name would be ambiguous in every prompt that renders it`);
    }

    const cat = categories[s?.category];
    if (!cat) { errors.push(`skills.${id}: category '${s?.category}' is not declared under categories`); continue; }

    const top = String(s.upstream_path ?? "").split("/")[0];
    if (!(cat.upstream ?? []).includes(top)) {
      errors.push(`skills.${id}: upstream_path '${s.upstream_path}' lives under '${top}/', which category '${s.category}' does not group (upstream: ${(cat.upstream ?? []).join(", ")})`);
    }

    if (typeof s.unassigned === "string" && TRIAGE.test(s.unassigned)) {
      errors.push(`skills.${id}: still marked "${s.unassigned}" — assign roles or give a real reason before merging`);
    }

    for (const [role, a] of Object.entries(s.roles ?? {})) {
      if (!roles.has(role)) { errors.push(`skills.${id}.roles: '${role}' is not a core role`); continue; }
      if (!(cat.roles ?? []).includes(role)) {
        errors.push(`skills.${id}.roles: '${role}' is out of scope for category '${s.category}' (allowed: ${(cat.roles ?? []).join(", ")}) — widen the category deliberately or move the skill`);
      }
      if (typeof a?.when === "string" && RUN_SCOPED.test(a.when)) {
        errors.push(`skills.${id}.roles.${role}: \`when: "${a.when}"\` is run-scoped ("the first …") — it is pasted per dispatch; scope it to "… in THIS dispatch"`);
      }
    }
  }
  return errors;
}

// ---- rendering -------------------------------------------------------------------------------

const ABBR = {
  "business-analyst": "BA", developer: "DEV", reviewer: "REV", "security-analyst": "SEC",
  tester: "TST", "qa-engineer": "QA", debugger: "DBG", "document-writer": "DOC",
  devops: "OPS", cicd: "CI", "aar-analyst": "AAR",
};
const abbr = (r) => ABBR[r] ?? r;

/** Roles that can receive anything from this set, in roster order. */
function columns(doc, coreRoles) {
  const used = new Set(Object.values(doc.categories ?? {}).flatMap((c) => c.roles ?? []));
  return coreRoles.filter((r) => used.has(r));
}

function ruleText(rule) {
  if (!rule || typeof rule !== "object") return "";
  if ("dependency" in rule) return `\`${rule.dependency}\``;
  if ("file_glob" in rule) return `files \`${rule.file_glob}\``;
  if ("file_exists" in rule) return `file \`${rule.file_exists}\``;
  if ("file_contains" in rule) return `\`${rule.file_contains.path}\` matches`;
  if ("any" in rule) return rule.any.map(ruleText).join(" or ");
  if ("all" in rule) return rule.all.map(ruleText).join(" and ");
  return "";
}

function gateText(skill) {
  const parts = [];
  if (skill.applies_if) parts.push(ruleText(skill.applies_if));
  for (const [role, a] of Object.entries(skill.roles ?? {})) {
    if (a?.applies_if) parts.push(`${abbr(role)}: ${ruleText(a.applies_if)}`);
  }
  if (skill.requires_tools?.length) parts.push(`needs ${skill.requires_tools.map((t) => `\`${t}\``).join(", ")}`);
  return parts.join("; ") || "—";
}

const GENERATED = (src) =>
  `<!-- GENERATED by \`sdlc-lint skill-sets --write\` from ${src} — do not edit by hand. -->`;

/**
 * The full skills × roles matrix — the reviewer's view.
 * @param {object} doc
 * @param {string[]} coreRoles roster order
 * @param {string} src source file name for the banner
 */
export function renderSkillSetTable(doc, coreRoles, src) {
  const cols = columns(doc, coreRoles);
  const catIds = Object.keys(doc.categories);
  const skills = [...doc.skills].sort((a, b) =>
    catIds.indexOf(a.category) - catIds.indexOf(b.category) || a.id.localeCompare(b.id));
  const lines = [
    GENERATED(src),
    "",
    `# Skill set \`${doc.set}\` — per-role matrix`,
    "",
    `Source: ${doc.source.homepage} · catalog \`${doc.source.catalog_version}\` · triaged ${doc.source.synced_at}`,
    "",
    "**M** mandatory · **R** recommended · — not assigned. A role only ever receives skills from the",
    "categories listed for it below; `sdlc-lint skill-sets` rejects anything else. Gated rows are",
    "rendered into a prompt only when the project matches the gate.",
    "",
    `| Skill | Category | ${cols.map(abbr).join(" | ")} | Gate / needs |`,
    `|---|---|${cols.map(() => ":-:").join("|")}|---|`,
  ];
  for (const s of skills) {
    const cells = cols.map((r) => {
      const a = s.roles?.[r];
      if (!a) return "—";
      return policyOf(a) === "mandatory" ? "**M**" : "R";
    });
    lines.push(`| \`${s.id}\` | ${s.category} | ${cells.join(" | ")} | ${s.unassigned ? `unassigned: ${s.unassigned}` : gateText(s)} |`);
  }
  lines.push("", "## Categories (scope guard)", "", "| Category | Upstream | Roles allowed |", "|---|---|---|");
  for (const [cid, c] of Object.entries(doc.categories)) {
    lines.push(`| ${cid} — ${c.label} | ${c.upstream.map((u) => `\`${u}/\``).join(", ")} | ${c.roles.filter((r) => cols.includes(r)).sort((a, b) => cols.indexOf(a) - cols.indexOf(b)).map(abbr).join(", ")} |`);
  }
  lines.push("", "## Legend", "", cols.map((r) => `${abbr(r)} = \`${r}\``).join(" · "), "");
  return lines.join("\n");
}

/** Per-role summary for the plugin README: which catalog skills reach which agent. */
export function renderReadmeBlock(doc, coreRoles, tableLink) {
  const cols = columns(doc, coreRoles);
  const lines = [
    `| Core role | Android CLI skills (${doc.set}) |`,
    "|---|---|",
  ];
  for (const r of cols) {
    const rows = doc.skills
      .filter((s) => s.roles?.[r])
      .sort((a, b) => (policyOf(b.roles[r]) === "mandatory") - (policyOf(a.roles[r]) === "mandatory") || a.id.localeCompare(b.id))
      .map((s) => {
        const gated = s.applies_if || s.roles[r].applies_if ? "*" : "";
        return policyOf(s.roles[r]) === "mandatory" ? `**\`${s.id}\`**${gated}` : `\`${s.id}\`${gated}`;
      });
    lines.push(`| \`${r}\` | ${rows.join(", ") || "—"} |`);
  }
  const unassigned = doc.skills.filter((s) => s.unassigned).map((s) => `\`${s.id}\``);
  lines.push("", `**Bold** = mandatory, \`*\` = gated on the project (e.g. a library dependency).` +
    (unassigned.length ? ` Unassigned: ${unassigned.join(", ")}.` : "") +
    ` Full matrix: [${tableLink}](${tableLink}).`);
  return lines.join("\n");
}

const blockMarkers = (set) => [`<!-- skill-set:${set}:begin -->`, `<!-- skill-set:${set}:end -->`];

/** Replace the marked block in `text`; null when the markers are missing. */
export function spliceBlock(text, set, body) {
  const [b, e] = blockMarkers(set);
  const i = text.indexOf(b);
  const j = text.indexOf(e);
  if (i < 0 || j < i) return null;
  return `${text.slice(0, i + b.length)}\n${GENERATED(`skill-sets/${set}.yaml`)}\n${body}\n${text.slice(j)}`;
}

// ---- the check --------------------------------------------------------------------------------

/**
 * @param {string} root repo root
 * @param {{ write?: boolean }} opts `write` regenerates the table and README block instead of comparing
 * @returns {Array<{file: string, ok: boolean, errors: string[], written?: string[]}>}
 */
export function checkSkillSets(root = process.cwd(), { write = false } = {}) {
  const results = [];
  let core;
  try { core = YAML.parse(readFileSync(join(root, CORE_MANIFEST), "utf8")); }
  catch (e) { return [{ file: CORE_MANIFEST, ok: false, errors: [`unreadable core manifest: ${e.message}`] }]; }
  const coreRoles = coreRoleOrder(core);
  const shippedSkills = new Set(globSync("plugins/*/skills/*/SKILL.md", { cwd: root })
    .map((f) => basename(dirname(f))));

  for (const file of globSync(SKILL_SET_GLOB, { cwd: root, absolute: true }).sort()) {
    const rel = relative(root, file);
    const errors = [];
    const written = [];
    let doc;
    try { doc = YAML.parse(readFileSync(file, "utf8")); }
    catch (e) { results.push({ file: rel, ok: false, errors: [`unreadable: ${e.message}`] }); continue; }
    if (!doc?.set || !Array.isArray(doc.skills) || !doc.categories) {
      results.push({ file: rel, ok: false, errors: ["not a skill set (needs set, categories, skills) — `sdlc-lint schema` has the detail"] });
      continue;
    }
    if (`${doc.set}.yaml` !== basename(file)) errors.push(`set '${doc.set}' must live in ${doc.set}.yaml`);
    errors.push(...validateSkillSet(doc, { coreRoles, shippedSkills }));

    const setDir = dirname(file);
    const pluginDir = dirname(setDir);
    const tableFile = join(setDir, `${doc.set}.md`);
    const table = renderSkillSetTable(doc, coreRoles, basename(file));
    const readmeFile = join(pluginDir, "README.md");
    const tableLink = relative(pluginDir, tableFile);

    if (write) {
      writeFileSync(tableFile, table);
      written.push(relative(root, tableFile));
    } else if (!existsSync(tableFile) || readFileSync(tableFile, "utf8") !== table) {
      errors.push(`${relative(root, tableFile)} is stale or missing — run \`node tools/sdlc-lint/cli.mjs skill-sets --write\``);
    }

    const readme = existsSync(readmeFile) ? readFileSync(readmeFile, "utf8") : null;
    const spliced = readme === null ? null : spliceBlock(readme, doc.set, renderReadmeBlock(doc, coreRoles, tableLink));
    if (spliced === null) {
      const [b, e] = blockMarkers(doc.set);
      errors.push(`${relative(root, readmeFile)} has no ${b} … ${e} block — add the two markers where the per-role summary belongs`);
    } else if (write) {
      if (spliced !== readme) { writeFileSync(readmeFile, spliced); written.push(relative(root, readmeFile)); }
    } else if (spliced !== readme) {
      errors.push(`${relative(root, readmeFile)} skill-set block is stale — run \`node tools/sdlc-lint/cli.mjs skill-sets --write\``);
    }

    results.push({ file: rel, ok: errors.length === 0, errors, written });
  }
  return results;
}
