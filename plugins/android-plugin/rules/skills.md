---
loaded_by: [ba, developer, reviewer, debugger, tester, qa, docs-writer]
load_when: "BEFORE phase work begins. Single source of truth for Skill invocations per role."
---

# Skills Matrix

Maps each pipeline phase to mandatory and recommended skill invocations.
Bundled with android-plugin (agents read this at phase start). See `workflow.md` for the full DAG.

## Mandatory Skills (invoke BEFORE phase work — no exceptions)

| Agent | Mandatory Skill | When |
|-------|-----------------|------|
| **android-ba** | `superpowers:brainstorming` | Before any requirements formulation or analysis |
| **android-ba** | `superpowers:verification-before-completion` | Before the development→review handoff |
| **android-developer** | `superpowers:test-driven-development` | Before writing any production code |
| **android-developer** | `frontend-design:frontend-design` | Before implementing Compose UI screens |
| **android-developer** | `superpowers:verification-before-completion` | Before the development→review handoff |
| **android-reviewer** | `superpowers:requesting-code-review` | When generating the review report |
| **android-reviewer** | `superpowers:receiving-code-review` | When evaluating developer responses to review comments |
| **android-reviewer** | `superpowers:verification-before-completion` | Before final LGTM signoff |
| **android-debugger** | `superpowers:systematic-debugging` | Before any diagnosis or fix — must follow structured methodology |
| **android-debugger** | `superpowers:verification-before-completion` | Before declaring root cause identified |

## Architecture Detection — android-developer only

Detect the project's existing state-management pattern before any state-management
implementation, then follow it — never impose a pattern the project does not use.

```bash
grep -rhoE "MVVM|MVI|MVP|Redux|Clean|StateFlow|MutableStateFlow|sealed (interface|class) \w+(State|Intent|Action|Event)" \
  $(find . -name "*.kt" -path "*/src/*" 2>/dev/null) 2>/dev/null | sort | uniq -c | sort -rn | head -20
```

| Result | Decision |
|--------|----------|
| Existing pattern found | Identify it (MVVM/MVI/MVP/Redux/Clean) from the code and follow it consistently |
| No clear pattern | Default to the project's idiomatic `ViewModel` + `StateFlow`. Do NOT impose an unused pattern. |

## Recommended Skills (invoke when the task calls for it)

| Agent | Recommended Skill | When |
|-------|-------------------|------|
| **android-aar** | `superpowers:verification-before-completion` | Before returning findings — every claim must cite transcript evidence |
| **android-tester** | `superpowers:test-driven-development` | When writing new tests from scratch |
| **android-qa** | `superpowers:verification-before-completion` | Before final E2E signoff |
| **android-docs** | `claude-mem` | When cross-session vault context is needed |
| **Every agent** | (implicit) `Read` `.obsidian-vault/` notes | BEFORE answering project-specific questions — see `documentation.md` "Single source of knowledge" |
| **All agents** | `context-mode` | When switching between planning / coding / reviewing work contexts |
| **All agents** | `get-shit-done-cc` | When managing tasks at session level |
| **android-ba / android-developer** | `skill-creator` | When creating or editing project-specific Claude skills |

## Parallel Phase Execution

`[security ‖ test]` (Steps 3+4) must be invoked **simultaneously in one message with two Agent calls**:

```
Agent(android-security, ...) + Agent(android-tester, ...)  ← single message, parallel
```

See `workflow.md` for the complete pipeline DAG.
