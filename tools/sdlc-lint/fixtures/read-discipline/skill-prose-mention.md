# fixture: prose mentions the delimiter before the template block

The prompt MUST be assembled in this exact order so the stable prefix (everything
down to `=== PER-CALL CONTEXT ===`) is identical across runs.

=== STABLE PREFIX ===

Compact handoff contract: return ONLY a COMPACT summary.

Read discipline: your entire prompt prefix is re-read and billed on every turn.

=== PER-CALL CONTEXT ===

task_slug: {task_slug}
