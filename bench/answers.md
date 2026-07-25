# Scripted responses

Answer approval gates and clarifying questions with these verbatim. Anything not covered here:
answer with the single word `proceed`, and note the deviation in the run's report.

- Approval to proceed after any phase: `proceed`
- "Should validation happen in the use case or the model?": `In the use case. The models stay dumb data holders.`
- "Should an empty line list be rejected?": `Yes, treat an empty line list as a validation failure.`
- "Which error type should carry the field name?": `ValidationError, with the offending field name.`
- "Should I add integration tests?": `Unit tests only, following the existing conventions.`
- "Should I update the README?": `No. Code and tests only.`
