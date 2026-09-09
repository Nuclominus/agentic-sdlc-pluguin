---
type: general
slug: moc-screens
tags: [meta/moc, layer/ui]
updated: 2026-01-01
---

# Screens MOC

One note per `@Composable` screen + its `@Serializable` route.

## Index

> Requires the **Dataview** community plugin (see [[README]]). Generated live from each
> screen note's typed frontmatter.

```dataview
TABLE WITHOUT ID
  file.link AS "Screen",
  route AS "Route",
  depends_on AS "Modules",
  updated AS "Updated"
FROM "screens"
WHERE type = "screen"
SORT file.name ASC
```

## See also

- [[navigation/routes]] — full route registry
