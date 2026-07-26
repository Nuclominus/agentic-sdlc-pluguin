# bench/report — visual report for the E2 campaign

`e2.html` is a self-contained, bilingual (EN / УКР) visual twin of [`../RESULTS.md`](../RESULTS.md) —
open it directly in any browser. It presents the campaign as what it was: a null result
(−10.65% inside a 55.6–64.2% within-arm spread), the peak-prefix ceiling hypothesis with its
≈21%-by-chance caveat, the noise-floor lessons, and the four defects that were the real yield.

Every statistic on the page is recomputed from `../results-headless/*.json` with the
instrument's own `median` / `spread` / `runMetrics` (imported from `../compare.mjs`) and
assertion-checked against RESULTS.md at build time — the build fails hard if any number
stops matching the record.

Rebuild after data or template changes:

```
node bench/report/build.mjs
```

`template.html` holds all copy (both languages) and the hand-built SVG chart code;
`build.mjs` derives the data and injects it as an inline `const DATA`.
