# ios-plugin

Native iOS (Swift/SwiftUI) stack provider for the Agentic SDLC marketplace. Registers the `ios` profile (aspect `ios`, priority 300). For the Stack Provider Pattern and shared mechanisms, see the [root README](../../README.md).

---

## Detection

```yaml
detect:
  any:
    - file_glob: "**/*.xcodeproj"     # app-only Xcode projects (variable-named)
    - file_glob: "**/*.xcworkspace"   # workspace-based projects
    - file_exists: Package.swift      # SPM packages
```

App-only, workspace, and SPM layouts auto-detect (the core's `file_glob` handles variable-named Xcode projects and monorepo subtrees) — no `--stack=ios` workaround needed.

---

## Phase mapping

`development` is iOS-specific; aspect-agnostic phases delegate to the core fallback agents (the orchestrator finds them in `sdlc`).

| Phase | Agent | model | effort |
| ----- | ----- | ----- | ------ |
| business_analysis | `business-analyst` (core) | `opus` | `high` |
| development | `ios-architect` | `sonnet` | `medium` |
| qa | `qa-engineer` (core) | `sonnet` | `medium` |
| security | `security-analyst` (core; iOS MASVS/MASTG injected via `stack.md`) | `opus` | `high` |
| documentation | `document-writer` (core) | `haiku` | `low` |

---

## Convention skills (Phase 4 TODOs)

`swiftui-ui`, `ios-architecture`, `ios-data`, `ios-navigation` — currently stubs. Filling them requires pinning the project's `@Observable` vs `ObservableObject` baseline and the `.pbxproj` stance.

---

## Host capability

swiftlint / swiftformat / xcodebuild run only on **macOS**. Off macOS, verification degrades to review-only and real builds are CI-deferred. `/sdlc:doctor` reports host capability up front. Hooks (`format-on-stop`, `guard-paths`) are host-aware.

---

## Status — skeleton

`stack.md`, hooks, and the agent frontmatter are complete. The convention skills and the architect's implementation procedure are the remaining Phase 4 work; unlike Android, iOS is not yet mirrored with a full specialized roster.
