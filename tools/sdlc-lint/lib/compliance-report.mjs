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
    seal: sealSplit(audited),
    excluded: results.filter((r) => r.status !== "auditable").map((r) => ({ run: r.run, reason: r.reason })),
  };
}

/**
 * Who sealed each run — H6's net firing, counted beside the rates rather than inside them.
 *
 * This is NOT a contract and deliberately never becomes one. The hook leaves no `tool_use`
 * block, so it is invisible to a transcript auditor; folding it into `5b-finish` would let
 * the net flatter the number that decides H4, when the point is to measure the model.
 *
 * `hook_share` is null rather than 0 when nothing recorded a sealer. A 0% would assert the
 * net never fired; the truth is that nobody was looking.
 */
function sealSplit(audited) {
  let orchestrator = 0, hook = 0, unrecorded = 0;
  for (const r of audited) {
    if (r.sealed_by === "orchestrator") orchestrator += 1;
    else if (r.sealed_by === "stop-hook") hook += 1;
    else unrecorded += 1;
  }
  const denominator = orchestrator + hook;
  return { orchestrator, hook, unrecorded, denominator,
    hook_share: denominator ? hook / denominator : null };
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

  const s = agg.seal;
  out.push("");
  out.push(`  ${pct(s.hook_share)}  ${"seal:stop-hook".padEnd(20)}` +
    ` orchestrator=${s.orchestrator} stop-hook=${s.hook} unrecorded=${s.unrecorded}` +
    "  [not a contract — the hook leaves no transcript trace" +
    (s.unrecorded ? "; unrecorded = predates the marker or never sealed" : "") + "]");

  out.push("");
  out.push("per-run detail (non-pass verdicts only)");
  for (const r of results.filter((x) => x.status === "auditable")) {
    // `na` is not a deviation: the contract did not apply to this run (it predates the
    // step, or the step has since been replaced). Listing it here made runs that did
    // everything asked of them render as ✗.
    const bad = r.verdicts.filter((v) => v.verdict !== "pass" && v.verdict !== "na");
    // Every date now comes from the run's own content (#116). A source other than telemetry's
    // own `started_at` is named rather than tagged "inferred", because which link of the chain
    // answered is the difference between an exact machine anchor and a model-typed checkpoint.
    const from = r.date_source && r.date_source !== "started_at" ? ` (${r.date_source.replace(/_/g, " ")})` : "";
    const date = `${r.date ?? "?"}${from}`;
    if (!bad.length) { out.push(`  ✓ ${r.run}  ${date}`); continue; }
    const detail = bad.map((v) => v.verdict === "partial"
      ? `${v.id}=partial ${v.matched}/${v.expected}`
      : `${v.id}=${v.verdict}${v.reason ? `:${v.reason}` : ""}`).join("  ");
    out.push(`  ✗ ${r.run}  ${date}  ${detail}`);
  }

  const undated = results.filter((x) => x.status === "auditable" && x.date == null);
  if (undated.length) {
    out.push("");
    out.push(`undated — scored against nothing, so absent from every rate above (${undated.length})`);
    for (const u of undated) out.push(`  – ${u.run}  no started_at, no checkpoint anchor, no dated checkpoint, no dated transcript`);
  }

  out.push("");
  out.push(`excluded — unauditable runs (${agg.excluded.length})`);
  for (const e of agg.excluded) out.push(`  – ${e.run}  ${e.reason}`);
  return out.join("\n");
}
