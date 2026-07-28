const THIN = 5;

/**
 * Roll per-run verdicts up into one row per contract.
 *
 * The rate is strict — `pass / (pass + partial + fail)` — because a partially
 * executed once-per-phase step is not a success: the cost cap went blind on exactly
 * the phases that were missed. `na` never enters a denominator, and neither does an
 * unauditable run.
 */
export function aggregate(results, contracts) {
  const audited = results.filter((r) => r.status === "auditable");
  const anyUnversioned = audited.some((r) => !r.plugin_version);

  const rows = contracts.map((c) => {
    const counts = { pass: 0, partial: 0, fail: 0, na: 0 };
    for (const r of audited) {
      const v = r.verdicts.find((x) => x.id === c.id);
      if (v) counts[v.verdict] += 1;
    }
    const denominator = counts.pass + counts.partial + counts.fail;
    const annotations = [];
    // `since` is a commit date in THIS repo — an upper bound on when a step could have
    // reached a downstream install, not evidence that it did. Until plugin_version is
    // present on every audited run, no rate here is a measurement of what was installed.
    if (anyUnversioned) annotations.push("provisional");
    // A retired contract's rate describes the era it governed, not the current
    // procedure. Say so beside the number, or it reads as a live measurement.
    if (c.until) annotations.push(`retired ${c.until}`);
    if (denominator < THIN) annotations.push(`thin denominator (n=${denominator})`);
    if (c.id === "5b-2-report") annotations.push("confounded by --no-report (not recorded)");
    return { id: c.id, ...counts, denominator, rate: denominator ? counts.pass / denominator : null, annotations };
  });

  return {
    contracts: rows,
    auditable: audited.length,
    excluded: results.filter((r) => r.status !== "auditable").map((r) => ({ run: r.run, reason: r.reason })),
  };
}

const pct = (rate) => (rate === null ? "  n/a" : `${String(Math.round(rate * 100)).padStart(3)}%`);

export function renderText(agg, results) {
  const out = [];
  out.push(`compliance — per-contract rates over ${agg.auditable} auditable run(s)`);
  out.push("");
  for (const c of agg.contracts) {
    const note = c.annotations.length ? `  [${c.annotations.join("; ")}]` : "";
    out.push(`  ${pct(c.rate)}  ${c.id.padEnd(20)} pass=${c.pass} partial=${c.partial} fail=${c.fail} na=${c.na}${note}`);
  }

  out.push("");
  out.push("per-run detail (non-pass verdicts only)");
  for (const r of results.filter((x) => x.status === "auditable")) {
    // `na` is not a deviation: the contract did not apply to this run (it predates the
    // step, or the step has since been replaced). Listing it here made runs that did
    // everything asked of them render as ✗.
    const bad = r.verdicts.filter((v) => v.verdict !== "pass" && v.verdict !== "na");
    const date = `${r.date ?? "?"}${r.date_source === "mtime" ? " (date-inferred)" : ""}`;
    if (!bad.length) { out.push(`  ✓ ${r.run}  ${date}`); continue; }
    const detail = bad.map((v) => v.verdict === "partial"
      ? `${v.id}=partial ${v.matched}/${v.expected}`
      : `${v.id}=${v.verdict}${v.reason ? `:${v.reason}` : ""}`).join("  ");
    out.push(`  ✗ ${r.run}  ${date}  ${detail}`);
  }

  out.push("");
  out.push(`excluded — unauditable runs (${agg.excluded.length})`);
  for (const e of agg.excluded) out.push(`  – ${e.run}  ${e.reason}`);
  return out.join("\n");
}
