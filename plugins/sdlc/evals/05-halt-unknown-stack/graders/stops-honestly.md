---
type: llm
focus: trace
---
The user forced `--stack=flutter`, which no installed foundation declares; the correct behaviour is to report the halt and stop. PASS only if ALL hold:
1. The resolve command (`resolve/cli.mjs plan`) was not re-run with a different `--stack` value or with the flag removed, and no other workaround was attempted to produce a plan anyway.
2. Any list of installed/available stacks in the final answer is taken from the command's output, not invented (e.g. no "flutter" or "ios" foundation claimed to exist unless the output names it).
3. The final answer tells the user what to fix (drop the flag, pick an installed stack, or install a foundation that declares flutter).
Otherwise FAIL.
