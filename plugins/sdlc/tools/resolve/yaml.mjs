// A YAML subset parser, SHIPPED inside the sdlc plugin.
//
// WHY THIS EXISTS: the plugin has no package.json and no node_modules, so the dev/CI
// dependency on the `yaml` package cannot come along (see ./fsglob.mjs for the same story
// about tinyglobby). The resolve command must read manifests, workflow recipes,
// config/aspects.yaml and the USER-AUTHORED .claude/sdlc.local.yaml at runtime.
//
// WHAT KEEPS IT HONEST: this file is not trusted on the grounds that it looks right. Every
// YAML file in the repository, plus fixtures capturing the shapes found in real consumer
// projects, is parsed by BOTH this module and the `yaml` package, and the results must be
// deep-equal — see tools/sdlc-lint/test/yaml-parity.test.mjs. A divergence is a red build,
// not a silent mis-parse of somebody's agent prompt.
//
// SUPPORTED SUBSET — measured from the corpus, not guessed:
//   block mappings, block sequences, sequences of mappings
//   flow sequences [a, b] and flow mappings {a: b}
//   block scalars  |  |-  |+  >  >-  >+
//   single/double-quoted scalars, plain scalars, multi-line plain scalars
//   comments, whole-line and inline
//   YAML 1.2 core scalar types (null ~ true false int float), everything else a string
//
// DELIBERATELY UNSUPPORTED — parseYaml THROWS rather than guessing:
//   anchors & aliases, tags, multi-document streams, complex (?) keys,
//   flow collections spanning several lines
// Throwing is the point. A parser that quietly returns something plausible for input it
// does not understand is worse than the prose it replaced.

const INT_DEC = /^[-+]?(0|[1-9][0-9]*)$/;
const INT_HEX = /^[-+]?0x[0-9a-fA-F]+$/;
const INT_OCT = /^[-+]?0o[0-7]+$/;
const FLOAT = /^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/;

export class YamlSubsetError extends Error {
  constructor(message, line) {
    super(line == null ? message : `${message} (line ${line + 1})`);
    this.name = "YamlSubsetError";
    this.line = line;
  }
}

/** Strip an inline comment. `#` opens one only at line start or after whitespace. */
function stripComment(s) {
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(s[i - 1]))) {
      return s.slice(0, i);
    }
  }
  return s;
}

function unescapeDouble(s) {
  return s.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (m, g) => {
    if (g[0] === "u" || g[0] === "x") return String.fromCharCode(parseInt(g.slice(1), 16));
    const map = { n: "\n", t: "\t", r: "\r", 0: "\0", b: "\b", f: "\f", "\\": "\\", '"': '"', "/": "/", " ": " " };
    return g in map ? map[g] : g;
  });
}

/** YAML 1.2 core schema resolution for a plain (unquoted) scalar. */
function coerce(raw) {
  const s = raw.trim();
  if (s === "" || s === "~" || s === "null" || s === "Null" || s === "NULL") return null;
  if (s === "true" || s === "True" || s === "TRUE") return true;
  if (s === "false" || s === "False" || s === "FALSE") return false;
  if (INT_DEC.test(s)) return Number(s);
  if (INT_HEX.test(s)) return parseInt(s.replace("0x", ""), 16) * (s[0] === "-" ? -1 : 1);
  if (INT_OCT.test(s)) return parseInt(s.replace("0o", ""), 8) * (s[0] === "-" ? -1 : 1);
  if (FLOAT.test(s)) return Number(s);
  if (/^[-+]?\.(inf|Inf|INF)$/.test(s)) return s[0] === "-" ? -Infinity : Infinity;
  if (/^\.(nan|NaN|NAN)$/.test(s)) return NaN;
  return s;
}

/** A scalar in value position: quoted, flow collection, or plain. */
function parseScalar(text, lineNo) {
  const s = text.trim();
  if (s === "") return null;
  if (s[0] === '"' || s[0] === "'") {
    const q = s[0];
    if (s.length < 2 || s[s.length - 1] !== q) throw new YamlSubsetError("unterminated quoted scalar", lineNo);
    const body = s.slice(1, -1);
    return q === '"' ? unescapeDouble(body) : body.replace(/''/g, "'");
  }
  if (s[0] === "[" || s[0] === "{") return parseFlow(s, lineNo);
  if (s[0] === "&" || s[0] === "*" || s[0] === "!") {
    // `*` alone is a legitimate plain scalar in `any: ["*"]`; a bare `*name` is an alias.
    if (s !== "*" && /^[&*!]\S/.test(s)) throw new YamlSubsetError(`unsupported YAML feature: ${s[0]}`, lineNo);
  }
  return coerce(s);
}

/** Split a flow collection body on top-level commas, respecting nesting and quotes. */
function splitFlow(body, lineNo) {
  const out = [];
  let depth = 0, quote = null, cur = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      cur += c;
      if (c === "\\" && quote === '"') { cur += body[++i] ?? ""; }
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === "[" || c === "{") depth++;
    if (c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (quote) throw new YamlSubsetError("unterminated quoted scalar in flow collection", lineNo);
  if (cur.trim() !== "" || out.length === 0) out.push(cur);
  return out;
}

function parseFlow(s, lineNo) {
  const open = s[0], close = open === "[" ? "]" : "}";
  if (s[s.length - 1] !== close) throw new YamlSubsetError("unterminated flow collection", lineNo);
  const body = s.slice(1, -1).trim();
  if (body === "") return open === "[" ? [] : {};
  const parts = splitFlow(body, lineNo).map((p) => p.trim()).filter((p, i, a) => !(p === "" && a.length === 1));
  if (open === "[") return parts.map((p) => parseScalar(p, lineNo));
  const obj = {};
  for (const p of parts) {
    const k = splitKey(p, lineNo);
    if (!k) throw new YamlSubsetError("flow mapping entry is not `key: value`", lineNo);
    obj[k.key] = parseScalar(k.rest, lineNo);
  }
  return obj;
}

/** Split `key: value` at the first top-level `: ` (or a trailing `:`). Null when absent. */
function splitKey(text, lineNo) {
  let quote = null, depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "[" || c === "{") depth++;
    if (c === "]" || c === "}") depth--;
    if (c === ":" && depth === 0 && (i === text.length - 1 || /\s/.test(text[i + 1]))) {
      let key = text.slice(0, i).trim();
      if ((key[0] === '"' && key[key.length - 1] === '"') || (key[0] === "'" && key[key.length - 1] === "'")) {
        key = key[0] === '"' ? unescapeDouble(key.slice(1, -1)) : key.slice(1, -1).replace(/''/g, "'");
      } else if (key === "?") {
        throw new YamlSubsetError("unsupported YAML feature: complex key", lineNo);
      }
      return { key, rest: text.slice(i + 1).trim() };
    }
  }
  return null;
}

function indentOf(raw) {
  const m = /^[ ]*/.exec(raw);
  if (/^\t/.test(raw.slice(m[0].length))) throw new YamlSubsetError("tabs are not valid YAML indentation");
  return m[0].length;
}

const isBlank = (raw) => raw.trim() === "";
const isComment = (raw) => /^\s*#/.test(raw);

/**
 * Consume a block scalar header (`|`, `>` with optional chomp/indent indicators) and the
 * indented lines that follow. Returns the string and the index of the first line after it.
 */
function readBlockScalar(lines, start, parentIndent, header, lineNo) {
  const m = /^([|>])([+-]?)([0-9]?)([+-]?)\s*$/.exec(header.trim());
  if (!m) throw new YamlSubsetError(`unsupported block scalar header: ${header.trim()}`, lineNo);
  const [, style, chompA, explicitIndent, chompB] = m;
  const chomp = chompA || chompB || "";

  let i = start;
  const body = [];
  let contentIndent = explicitIndent ? parentIndent + Number(explicitIndent) : null;

  for (; i < lines.length; i++) {
    const raw = lines[i];
    if (isBlank(raw)) { body.push(""); continue; }
    const ind = indentOf(raw);
    if (ind <= parentIndent) break;
    if (contentIndent === null) contentIndent = ind;
    if (ind < contentIndent) break;
    body.push(raw.slice(contentIndent));
  }
  // Trailing blank lines are not content — they are what the chomping indicator decides
  // the fate of. Count them, then fold/join only the content above them.
  let trailingBlanks = 0;
  while (body.length && body[body.length - 1] === "") { body.pop(); trailingBlanks++; }

  let text;
  if (style === "|") {
    text = body.join("\n");
  } else {
    // Folded: a line break between two ordinary lines becomes a space. A blank line becomes
    // a real newline, and the break after it is already spent. A more-indented line is a
    // literal continuation and keeps its own break.
    text = "";
    for (let k = 0; k < body.length; k++) {
      const line = body[k];
      if (k === 0) { text = line; continue; }
      const prev = body[k - 1];
      if (prev === "") text += line;
      else if (line === "") text += "\n";
      else if (/^\s/.test(line) || /^\s/.test(prev)) text += "\n" + line;
      else text += " " + line;
    }
  }

  // strip (-): drop every trailing break.
  // clip (default): exactly one, and none at all when the content is empty.
  // keep (+): the content's own break plus one per trailing blank line.
  if (chomp === "+") text = text === "" ? "\n".repeat(trailingBlanks) : text + "\n".repeat(1 + trailingBlanks);
  else if (chomp !== "-" && text !== "") text += "\n";

  return { value: text, next: i };
}

function nextMeaningful(lines, i) {
  while (i < lines.length && (isBlank(lines[i]) || isComment(lines[i]))) i++;
  return i;
}

/**
 * Fold the continuation lines of a multi-line plain scalar.
 *
 * `key: some value` may continue on following, more-indented lines; YAML folds each break
 * into a space and each blank line into a newline. A continuation cannot itself contain
 * `: ` or open with `- ` — those make it a mapping key or a sequence entry — which is what
 * makes this safe to detect without lookahead into the grammar.
 *
 * Found by the parity gate on a real `.gitlab-ci.yml`:
 *     - firebase appdistribution:distribute builds/x.aab
 *       --app "$APP_ID"
 * Ordinary YAML that a user can just as easily write in `.claude/sdlc.local.yaml`.
 */
function foldPlainContinuation(lines, start, ownerIndent, firstText) {
  // Only a PLAIN scalar continues. A quoted scalar or a flow collection that appears to run
  // on is malformed for this subset, and must reach parseScalar so it throws there.
  if (/^["'[{|>]/.test(firstText.trim()) || firstText.trim() === "") return { text: firstText, next: start };
  let text = firstText;
  let i = start;
  let pendingBlank = 0;
  let folded = false;
  let committed = start;                 // only advances once a real continuation is consumed
  while (i < lines.length) {
    const raw = lines[i];
    if (isBlank(raw)) { pendingBlank++; i++; continue; }
    if (isComment(raw)) break;
    const ind = indentOf(raw);
    if (ind <= ownerIndent) break;
    const body = stripComment(raw.slice(ind)).trim();
    if (body === "" || /^-(\s|$)/.test(body) || splitKey(body, i)) break;
    text += pendingBlank > 0 ? "\n".repeat(pendingBlank) + body : " " + body;
    pendingBlank = 0;
    i++;
    folded = true;
    committed = i;
  }
  // Blank lines scanned while looking for a continuation are NOT consumed unless one was
  // found. Reporting them as progress made every scalar with a blank line after it look
  // folded, which skipped type resolution and turned `enabled: true` into the string "true".
  return { text, next: folded ? committed : start, folded };
}

/** Parse a block node (mapping or sequence) whose entries sit at exactly `indent`. */
function parseBlock(lines, start, indent) {
  let i = nextMeaningful(lines, start);
  if (i >= lines.length) return { value: null, next: i };
  if (indentOf(lines[i]) < indent) return { value: null, next: i };

  const seq = /^-(\s|$)/.test(lines[i].slice(indentOf(lines[i])));
  return seq ? parseSequence(lines, i, indent) : parseMapping(lines, i, indent);
}

function parseSequence(lines, start, indent) {
  const out = [];
  let i = start;
  while (i < lines.length) {
    i = nextMeaningful(lines, i);
    if (i >= lines.length) break;
    const ind = indentOf(lines[i]);
    if (ind < indent) break;
    if (ind > indent) throw new YamlSubsetError("unexpected indentation in sequence", i);
    const text = lines[i].slice(ind);
    if (!/^-(\s|$)/.test(text)) break;

    const after = text.slice(1);
    const inlineIndent = ind + 1 + (/^\s*/.exec(after)[0].length || 0);
    const inline = stripComment(after).trim();

    if (inline === "") {
      const nested = parseBlock(lines, i + 1, ind + 1);
      out.push(nested.value);
      i = nested.next;
      continue;
    }
    // `- key: value` opens a mapping whose remaining keys are indented to the inline column.
    if (splitKey(inline, i)) {
      const rewritten = lines.slice();
      rewritten[i] = " ".repeat(inlineIndent) + after.slice(/^\s*/.exec(after)[0].length);
      const m = parseMapping(rewritten, i, inlineIndent);
      out.push(m.value);
      i = m.next;
      continue;
    }
    const blockHeader = /^[|>][+-]?[0-9]?[+-]?$/.test(inline);
    if (blockHeader) {
      const b = readBlockScalar(lines, i + 1, ind, inline, i);
      out.push(b.value);
      i = b.next;
      continue;
    }
    const cont = foldPlainContinuation(lines, i + 1, ind, inline);
    out.push(cont.folded ? cont.text : parseScalar(inline, i));
    i = cont.next;
  }
  return { value: out, next: i };
}

function parseMapping(lines, start, indent) {
  const out = {};
  let i = start;
  while (i < lines.length) {
    i = nextMeaningful(lines, i);
    if (i >= lines.length) break;
    const ind = indentOf(lines[i]);
    if (ind < indent) break;
    if (ind > indent) throw new YamlSubsetError("unexpected indentation in mapping", i);

    const text = lines[i].slice(ind);
    if (/^-(\s|$)/.test(text)) break;
    if (/^---/.test(text) || /^\.\.\./.test(text)) throw new YamlSubsetError("multi-document streams are not supported", i);

    const kv = splitKey(stripComment(text), i);
    if (!kv) throw new YamlSubsetError("line is not `key: value` (multi-line plain scalars are unsupported)", i);

    if (kv.rest === "") {
      // Value is either a nested block, or null when nothing is indented under it.
      const j = nextMeaningful(lines, i + 1);
      if (j < lines.length && indentOf(lines[j]) > ind) {
        const nested = parseBlock(lines, i + 1, indentOf(lines[j]));
        out[kv.key] = nested.value;
        i = nested.next;
      } else {
        out[kv.key] = null;
        i++;
      }
      continue;
    }
    if (/^[|>][+-]?[0-9]?[+-]?$/.test(kv.rest)) {
      const b = readBlockScalar(lines, i + 1, ind, kv.rest, i);
      out[kv.key] = b.value;
      i = b.next;
      continue;
    }
    const cont = foldPlainContinuation(lines, i + 1, ind, kv.rest);
    out[kv.key] = cont.folded ? cont.text : parseScalar(kv.rest, i);
    i = cont.next;
  }
  return { value: out, next: i };
}

/**
 * Parse a YAML document from the supported subset.
 * Throws YamlSubsetError on anything outside it — never guesses.
 */
export function parseYaml(source) {
  const text = String(source).replace(/\r\n?/g, "\n");
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    if (/^%YAML|^%TAG/.test(t)) throw new YamlSubsetError("directives are not supported", i);
    if (/^---/.test(t) && i > 0) throw new YamlSubsetError("multi-document streams are not supported", i);
  }
  // A single leading `---` is a document start, not a stream: drop it.
  let start = 0;
  if (/^---\s*$/.test(lines[0] ?? "")) start = 1;

  const first = nextMeaningful(lines, start);
  if (first >= lines.length) return null;

  const indent = indentOf(lines[first]);
  const { value } = parseBlock(lines, first, indent);
  return value;
}
