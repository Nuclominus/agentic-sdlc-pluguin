# scan.md — Detection rules (phase 4.1)

Loaded by `manage-vault` phase 4.1. All scans run as parallel `Grep`/`Glob`/`Bash` calls in one
message — none depend on each other.

## Source-set scope

Inclusions (production code only):
- `**/src/main/**/*.kt`
- `**/src/androidMain/**/*.kt`
- `**/src/commonMain/**/*.kt`
- `app/src/main/**/*.kt`

Exclusions (skip in every scan):
- `**/src/test/**`, `**/src/androidTest/**`, `**/src/commonTest/**`
- `**/*Test.kt`, `**/*Spec.kt`
- `build/`, `.gradle/`, `**/generated/**`

Same exemption shape as `.claude/scripts/check-docs-sync.sh`.

## 1. Gradle modules

```
Read settings.gradle.kts (or settings.gradle).
Extract every include(":...") path.
For each, drop the leading ':' and replace ':' with '/'.
Confirm <path>/build.gradle.kts (or build.gradle) exists.
Slug = last segment of the colon-separated path.
```

Examples: `include(":feature:auth")` → slug `auth`, path `feature/auth/`;
`include(":core:network")` → slug `network`; `include(":app")` → slug `app` (document once).

Skip `buildSrc`, `build-logic`, `convention-plugins` — toolchain, not features.

## 2. `@Composable` screens

```
Grep -nE "@Composable\s*\n\s*(internal\s+|public\s+|private\s+)?fun\s+([A-Z][A-Za-z0-9]*Screen)\b"
   in production sources only.
```

Capture group 2 = screen name. Strip duplicates (same name in multiple modules — rare; if so, suffix
with the module slug and report). Skip Composables that don't end in `Screen` — those are reusable
components, not entry-point screens.

## 3. `@Serializable` navigation routes

Two-step detection:

```
Step A — candidates:
  Grep -nE "@Serializable\s*\n\s*(internal\s+|public\s+|private\s+)?(data\s+(class|object)|object|class)\s+([A-Z]\w*(Route|Screen|Destination))\b"
  Capture group 4 = candidate class name.

Step B — confirm it's a nav route:
  Grep -lE "(NavHost|composable<|navigation<|fragment<)" production sources.
  For each candidate from A, grep its use inside files matched by B.
  Keep candidates with >=1 usage; drop the rest (DTOs that happen to end in "Route").
```

Output: list of `(className, fqcn, file:line)` triples.

## 4. Business flows

State-management entry points. Primary signal is ViewModels; some projects use an MVI store/container
pattern (see Architecture Detection in `${CLAUDE_PLUGIN_ROOT}/rules/skills.md`).

```
Grep -nE "class\s+(\w+)ViewModel\s*(:|\(|\{)"             → ViewModel-based flows
Grep -nE "class\s+(\w+)Store\s*(:|\(|\{)"                → MVI store classes (if used)
Grep -nE "class\s+(\w+)Container\s*(:|\(|\{).*Container<" → MVI containers (if used)
```

Derive the flow slug from the type prefix:

```
prefix = strip "ViewModel"/"Store"/"Container"/"State"/"Intent"/"Action" suffix
slug   = camelCase-to-kebab-case(prefix)
```

Examples: `SignInViewModel` → `sign-in`, `CheckoutStore` → `checkout`, `PaywallState` → `paywall`.

## 5. Existing vault inventory

```
Glob .obsidian-vault/modules/*.md          → existing module notes
Glob .obsidian-vault/screens/*.md          → existing screen notes
Glob .obsidian-vault/business-logic/*.md   → existing flow notes
Read .obsidian-vault/navigation/routes.md  → existing route rows (may not exist yet)
```

No need to read `_moc-*.md` — Dataview tables, indexed by frontmatter, nothing to dedupe against.

For each note, classify as **stubbed** (contains `<!-- STUB:` marker) or **filled**. Both count as
"exists". The distinction drives phase 4 behaviour: a **stubbed** note MAY be refreshed; a **filled**
note is content and is NEVER touched. Also flag **legacy-schema** notes (frontmatter still has a flat
`links:` field) as migration candidates:

```
Grep -lE "^links:" .obsidian-vault/**/*.md   → legacy-schema notes
```

## Diff output (in-memory, fed to apply.md / audit.md)

```
to_create_modules:  [(slug, source_path), ...]      # no module note yet
to_create_screens:  [(Name, source_file), ...]
to_create_flows:    [(slug, store_type), ...]
to_refresh_stubs:   [(path), ...]                   # note exists but still carries <!-- STUB -->
to_append_routes:   [(routeClass, fqcn, source_file), ...]
legacy_schema:      [vault_note with flat links:]

to_flag_drift:
  modules:  [vault_note whose slug not in scanned modules]
  screens:  [vault_note whose Name not in scanned @Composable Screens]
  flows:    [vault_note whose slug not in scanned flows]
```

`to_create_*` and `to_refresh_stubs` go to apply.md; `to_flag_drift` and `legacy_schema` go to audit.md.
Filled notes appear in NONE of these lists — they are invisible to the writer.
