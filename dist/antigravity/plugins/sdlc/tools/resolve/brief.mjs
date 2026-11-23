import { existsSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { parseYaml } from "./yaml.mjs";
import { briefOf, slugify, SLUG_RE } from "./slug.mjs";

const opt = (args, name) => (new RegExp(`${name}=([^\\s]+)`).exec(String(args)) ?? [])[1] ?? null;
const LANGS = ["uk", "en"];

const inside = (root, abs) => abs.startsWith(root + sep);

export function readBrief({ cwd, args }) {
  const given = opt(args, "--brief");
  if (given === null) return { requested: false };
  const fail = (msg) => ({ requested: true, error: `--brief=${given}: ${msg}` });

  const root = realpathSync(cwd);
  const abs = resolve(root, given);
  if (!inside(root, abs)) return fail("path is outside the project");
  if (!existsSync(abs)) return fail(`file not found: ${given}`);
  const real = realpathSync(abs);
  if (!inside(root, real)) return fail("path is outside the project");

  const text = readFileSync(real, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!m) return fail("no frontmatter (expected a leading --- block with title, slug)");
  let fmatter;
  try { fmatter = parseYaml(m[1]); } catch (e) { return fail(`invalid frontmatter: ${e.message}`); }
  if (!fmatter || typeof fmatter !== "object") return fail("no frontmatter (expected a leading --- block with title, slug)");

  const title = typeof fmatter.title === "string" ? fmatter.title.trim() : "";
  if (!title) return fail("frontmatter `title` is required and must be non-empty");
  const slug = fmatter.slug === undefined || fmatter.slug === null ? slugify(title) : String(fmatter.slug);
  if (!slug || slug.length > 40 || !SLUG_RE.test(slug)) return fail("frontmatter `slug` must be lowercase letters, digits and dashes, at most 40 characters");
  const lang = fmatter.narrative_language === undefined || fmatter.narrative_language === null ? "en" : String(fmatter.narrative_language);
  if (!LANGS.includes(lang)) return fail(`frontmatter \`narrative_language\` must be one of ${LANGS.join(", ")}`);

  if (briefOf(args)) return { requested: true, error: "--brief: use either --brief=<path> or a description, not both" };
  if (/(^|\s)--resume(=|\s|$)/.test(String(args))) return { requested: true, error: "--brief cannot be combined with --resume (a resumed run already has its _brief.md)" };

  return { requested: true, path: relative(root, real).split(sep).join("/"), title, slug, narrative_language: lang };
}

export const briefArgs = (args, title) => String(args).replace(/--brief=[^\s]+/, () => JSON.stringify(title));
