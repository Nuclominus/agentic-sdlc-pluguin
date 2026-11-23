import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { parseYaml } from "./yaml.mjs";
import { briefOf, SLUG_RE } from "./slug.mjs";

const blankQuoted = (text) => text.replace(/"[^"]*"|'[^']*'/g, (q) => " ".repeat(q.length));

function briefToken(args) {
  const text = String(args);
  const m = /(^|\s)--brief(=\S*)?(?=\s|$)/.exec(blankQuoted(text));
  if (!m) return null;
  const start = m.index + m[1].length;
  const end = m.index + m[0].length;
  return { start, end, value: m[2] ? text.slice(start + "--brief=".length, end) : "" };
}

const LANGS = ["uk", "en"];

const inside = (root, abs) => abs === root || abs.startsWith(root + sep);

export function readBrief({ cwd, args }) {
  const token = briefToken(args);
  if (!token) return { requested: false };
  const given = token.value;
  if (!given) return { requested: true, error: "--brief: give the path as --brief=<path>" };
  const fail = (msg) => ({ requested: true, error: `--brief=${given}: ${msg}` });

  const root = realpathSync(cwd);
  const abs = resolve(root, given);
  if (!inside(root, abs)) return fail("path is outside the project");
  if (!existsSync(abs)) return fail(`file not found: ${given}`);
  const real = realpathSync(abs);
  if (!inside(root, real)) return fail("path is outside the project");

  if (!statSync(real).isFile()) return fail(`not a file: ${given}`);

  let raw;
  try { raw = readFileSync(real, "utf8"); } catch (e) { return fail(`cannot read ${given}: ${e.code ?? e.message}`); }
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!m) return fail("no frontmatter (expected a leading --- block with title, slug, narrative_language)");
  let fmatter;
  try { fmatter = parseYaml(m[1]); } catch (e) { return fail(`invalid frontmatter: ${e.message}`); }
  if (!fmatter || typeof fmatter !== "object") return fail("no frontmatter (expected a leading --- block with title, slug, narrative_language)");

  const title = typeof fmatter.title === "string" ? fmatter.title.trim() : "";
  if (!title) return fail("frontmatter `title` is required and must be non-empty");
  if (fmatter.slug === undefined || fmatter.slug === null) return fail("missing slug");
  const slug = String(fmatter.slug);
  if (!slug || slug.length > 40 || !SLUG_RE.test(slug)) return fail("frontmatter `slug` must be lowercase letters, digits and dashes, at most 40 characters");
  if (fmatter.narrative_language === undefined || fmatter.narrative_language === null) return fail("missing narrative_language");
  const lang = String(fmatter.narrative_language);
  if (!LANGS.includes(lang)) return fail(`frontmatter \`narrative_language\` must be one of ${LANGS.join(", ")}`);

  if (briefOf(args)) return { requested: true, error: "--brief: use either --brief=<path> or a description, not both" };
  if (/(^|\s)--resume(=|\s|$)/.test(String(args))) return { requested: true, error: "--brief cannot be combined with --resume (a resumed run already has its _brief.md; use --resume=<slug>)" };

  return { requested: true, path: relative(root, real).split(sep).join("/"), title, slug, narrative_language: lang };
}

export function briefArgs(args, title) {
  const text = String(args);
  const token = briefToken(text);
  if (!token) return text;
  const quoted = JSON.stringify(String(title).replace(/(^|\s)-+/g, "$1").replace(/-{2,}/g, " "));
  return text.slice(0, token.start) + quoted + text.slice(token.end);
}
