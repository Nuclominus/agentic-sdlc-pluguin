---
type: general
slug: moc-flows
tags: [meta/moc, layer/domain]
updated: 2026-01-01
---

# Business Flows MOC

One note per business flow (sign-in, checkout, paywall, sync, …).

## Index

> Requires the **Dataview** community plugin (see [[README]]). Generated live from each
> flow note's typed frontmatter.

```dataview
TABLE WITHOUT ID
  file.link AS "Flow",
  depends_on AS "Modules",
  screens AS "Screens",
  updated AS "Updated"
FROM "business-logic"
WHERE type = "flow"
SORT file.name ASC
```
