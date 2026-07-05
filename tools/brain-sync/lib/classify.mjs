export const KNOWN_PLUGINS = [
  "sdlc",
  "android-foundation",
  "retrofit-plugin",
  "room-plugin",
  "dagger-plugin",
  "workmanager-plugin",
];

const PREFIX_RE = /^([a-z0-9+-]+)(?:\([^)]*\))?!?:\s*/i;

export function changeType(title) {
  const m = title.match(PREFIX_RE);
  return m ? m[1].toLowerCase() : "other";
}

export function stripPrefix(title) {
  return title.replace(PREFIX_RE, "").trim();
}

export function roadmapTag(title) {
  const m = title.match(/Roadmap\s+([A-Z]\d+)/i);
  return m ? m[1].toUpperCase() : null;
}

export function slug(title) {
  const s = stripPrefix(title)
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return s || "change";
}

export function pluginsTouched(files, known = KNOWN_PLUGINS) {
  const set = new Set();
  for (const f of files) {
    const m = f.match(/^plugins\/([^/]+)\//);
    if (m && known.includes(m[1])) set.add(m[1]);
  }
  return [...set].sort();
}

export function classify(pr) {
  return {
    type: changeType(pr.title),
    plugins: pluginsTouched(pr.files),
    roadmap: roadmapTag(pr.title),
    slug: slug(pr.title),
  };
}
