import { execFileSync } from "node:child_process";

const PR_FIELDS = "number,title,body,author,mergedAt,labels,files";

export function ghExec(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

export function normalizePr(raw) {
  return {
    number: raw.number,
    title: raw.title ?? "",
    body: raw.body ?? "",
    author: raw.author?.login ?? "unknown",
    mergedAt: raw.mergedAt ?? null,
    labels: (raw.labels ?? []).map((l) => l.name),
    files: (raw.files ?? []).map((f) => f.path),
  };
}

export function readPr(number, exec = ghExec) {
  return normalizePr(JSON.parse(exec(["pr", "view", String(number), "--json", PR_FIELDS])));
}

export function listMergedPrNumbers(base = "develop", exec = ghExec) {
  const rows = JSON.parse(
    exec(["pr", "list", "--state", "merged", "--base", base, "--limit", "500", "--json", "number,mergedAt"]),
  );
  return rows
    .filter((r) => r.mergedAt)
    .sort((a, b) => a.mergedAt.localeCompare(b.mergedAt))
    .map((r) => r.number);
}
