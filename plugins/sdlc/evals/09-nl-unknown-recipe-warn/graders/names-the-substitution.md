---
type: llm
focus: last_message
---
The request named `mobile-release`, which no installed recipe answers to. The command does not halt on a name in prose — it warns and falls through to `default`. The whole point of issue #180 is that the user must not be handed a different pipeline in silence.

PASS only if ALL hold:
1. The answer says that `mobile-release` is not an installed recipe — in the command's words or plainly in its own.
2. The answer says which recipe the preview is actually for: `default`.
3. The answer does NOT claim `mobile-release` was used, does not present its figures as that recipe's, and does not invent phases, a cost or a cap for a recipe that does not exist.
4. The answer does NOT report the run as halted, blocked or failed. A preview is present.

FAIL if the preview is presented without ever mentioning that the named recipe was not the one resolved — that is the silent substitution this case exists to catch, and a correct-looking `default` preview is exactly what it looks like.
