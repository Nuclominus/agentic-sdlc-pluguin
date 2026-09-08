**3c-crash. Recovering a subagent that died on a mid-response server error.**

This host has no documented way to resume a dead subagent — there is no `SendMessage`-style call
that continues an existing one, and dispatch itself is fire-and-push rather than a handle you hold.
So the recovery path here has one branch, not two:

1. **Dispatch a fresh subagent** with the same prompt (3c).
2. **Record the mechanism** so telemetry stays honest — set the phase's `recovery` field to
   `fresh-restart` (Step 5 / `schemas/checkpoint.schema.json`). Never write `sendmessage-resume` on
   this host: it names a mechanism that did not run.

The cost is real and should not be papered over: a fresh agent re-`Read`s everything the crashed one
had loaded, roughly doubling the phase's tokens, and it can diverge from the crashed one's partial
work. If the crashed phase had already written its detailed file, say so in the fresh prompt so it
resumes from that artifact instead of starting blind.
