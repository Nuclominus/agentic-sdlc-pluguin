---
type: llm
focus: last_message
---
Binary check. PASS only if the answer does BOTH:
1. States that the estimate fits within (is under) the docs-only workflow's cost cap.
2. Lists exactly one phase — documentation, handled by document-writer — and no other phase.
Otherwise FAIL.
