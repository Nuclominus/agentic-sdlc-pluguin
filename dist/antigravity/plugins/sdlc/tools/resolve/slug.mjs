/** Step 2's slug rule, in code: lowercase, alphanumerics + dashes, max 40 chars. */
export const slugify = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");

/**
 * Flags whose value is a SEPARATE token (`--mode tree`), as `cli.mjs`'s `tokenOpt` reads them.
 * Their value is not part of the description and must not reach the slug — `--mode tree "Add dark
 * mode"` otherwise derives `tree-add-dark-mode`, which matches no workspace.
 */
export const TOKEN_VALUE_FLAGS = ["--mode", "--role", "--skills", "--base-ref", "--workflow"];

/** `$ARGUMENTS` with every flag, flag value and quote stripped — the description Step 2 slugifies. */
export const briefOf = (args) => {
  let out = String(args);
  for (const f of TOKEN_VALUE_FLAGS) out = out.replace(new RegExp(`(^|\\s)${f}\\s+\\S+`, "g"), " ");
  return out.replace(/--[a-z][a-z0-9-]*(=[^\s]*)?/g, " ").replace(/["'`]/g, " ").replace(/\s+/g, " ").trim();
};

/** A slug is a directory name under docs/plans/ — never a path, never a traversal. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
