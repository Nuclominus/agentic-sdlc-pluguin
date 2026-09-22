---
type: llm
focus: trace
weight: 1
---
Grade whether the final answer presents a dry-run preview whose values come from the tool, not from the model.

Step 1 — gate. The final answer must present a dry-run preview: a numbered phase list with an agent per phase, an estimated cost in dollars, and a cap verdict (WITHIN / EXCEEDS). If it does not — it halts, declines, asks a question, or describes phases without costs — FAIL immediately. An answer with no numbers is NOT vacuously faithful.

Step 2 — provenance. The trace must contain a tool result from running `resolve/cli.mjs plan` (a Bash call to `node …/tools/resolve/cli.mjs plan …`) whose output includes `🔎 DRY RUN`, `Phases (N):`, `Estimated cost:` and `Cap:`. If not, FAIL: a preview composed without running the command is invented, however plausible it looks.

Step 3 — fidelity. Every phase, agent name, model tier, dollar figure and cap verdict in the final answer appears in that tool result with the same value, and the answer adds none that the tool result lacks. Reformatting (dropping `~`, a table instead of a list) is fine; a changed or added value is FAIL.

PASS only if all three steps pass.
