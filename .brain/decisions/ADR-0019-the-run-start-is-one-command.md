---
adr: 19
status: proposed
date: 2026-08-04
supersedes: null
---

# ADR-0019 — The run start is one command, and resolution is not the model's work

## Context

[[planning/h5-prompt-surface]] measured what the orchestrator's prose actually costs and arrived at a
conclusion the item was not written to reach: **the lever is removing the model's turns, not its
words.** The cost of a token in the stable prefix is `tokens × turns × cached_price`, and collapsing
a procedure into a command reduces *both* factors. Cutting text alone is worth ~3% of a run.

The 2026-08-04 re-measurement priced the other factor properly, per **run** rather than per session,
over 28 runs across two downstream corpora. The window from the `pipeline-orchestrator` `Skill`
invocation to the first `Task` dispatch — Steps 0 → 1d, before any phase work exists:

| | all 28 runs | the 9 runs carrying `plugin_version` |
|---|---|---|
| turns | median **33** (16–48) | median **34** (23–44) |
| tool calls | median **18.5** (8–24) | median **18** (13–24) |
| cache-read billed | median **$1.80** | median **$2.05** |
| share of total run cost | median **14.5%** (3.4–46.1%) | median **17.0%** (12.6–21.6%) |

No run in the newest cohort spends less than 12.6% of its budget before dispatching a single agent.
The tool histogram across the window is `Bash` 296, `Read` 107, `Write` 53, `Skill` 28 — roughly ten
`Bash` and four `Read` calls per run, inspecting manifests and config files.

**That window is not all collapsible, and this ADR is scoped to the part that is.** Splitting the
nine runs at the `.checkpoint/_started_at` write (the `2-4-anchor` contract, i.e. Step 2.4):

| | Steps 0 → 1d (**collapsible**) | Step 2 workspace (**stays**) |
|---|---|---|
| turns | median **24** (16–36) | median 7 |
| tool calls | median **14** (9–20) | median 4 |
| cache-read billed | median **$1.31** | median $0.45 |
| share of total run cost | median **11.8%** (8.5–17.2%) | ~4% |

Workspace creation, the run anchor and `_brief.md` are genuine work with side effects and stay with
the orchestrator. **The honest saving is the 11.8%, not the 17%.**

A second signal falls out of the same split and was not anticipated: the collapsible part costs
**16–36 turns / 9–20 calls** across nine runs of the *same* procedure, several of them on the same
project. A deterministic function of files on disk is being executed with a 2.2× spread in cost.
That is the determinism argument with a number attached, independent of the cost argument.

Three facts make this collapsible rather than merely expensive:

- **Steps 0 → 1d are 926 lines (36.5% of `SKILL.md`) carrying no judgement.** Plugin-root
  resolution, dependency preflight, foundation/framework detection, skip-rule analysis, profile
  merge, `sdlc.local.yaml` and `model.local.json` parsing, workflow resolution, cost-cap resolution,
  dry-run preview. Every one is a deterministic function of files on disk.
- **The logic already exists twice.** `tools/sdlc-lint/lib/detect.mjs` implements detection and
  framework attachment in **62 lines of tested code** against ~340 lines of prose describing the same
  rules for the model to execute. `SKILL.md:234` says so in a comment.
- **The shape that replaces it is the one that never gets skipped.** A single once-per-run `Bash`
  line is the `2-4-anchor` shape, which measures **100% over 28 runs**. The alternative shapes are
  measured too, and worse: a once-per-phase obligation of identical length measures 67%, and the
  multi-step Step 5 clock measured 67% before [[decisions/ADR-0014-the-run-tail-is-one-command]]
  removed it.

This is the same argument as ADR-0014, applied to the other end of the run. The tail became one
command because compliance tracks how many separate things an instruction asks for; the start should
become one command because **cost tracks how many turns the model spends discovering what a program
could have told it in one**.

## Decision

**Ship `plugins/sdlc/tools/resolve/cli.mjs`. One invocation performs the whole of Steps 0 → 1d and
emits a resolved plan as JSON plus the verbatim print blocks the steps owe the user. The
orchestrator invokes it, echoes what it returns, and proceeds to Step 2.**

Four bindings follow from that sentence.

**1. The canonical implementation ships in the plugin; the lint re-exports it.** The module lives
under `${CLAUDE_PLUGIN_ROOT}/tools/resolve/`, never at the repo root, so a marketplace consumer
actually gets it. `tools/sdlc-lint/lib/detect.mjs` becomes a re-export shim, exactly as
`lib/resume.mjs` already re-exports the shipped `plugins/sdlc/tools/run/reentry.mjs`. The double
implementation of detection ends here — the tests keep exercising the code that ships.

**2. The prose is deleted, not relocated.** The 926 lines leave the prefix; they do not become a
just-in-time fragment. A fragment the orchestrator must *read* mid-run is a new step that can be
skipped, and [[planning/h5-prompt-surface]] measured that shape at 40–67%. What replaces the prose is
the command's own output. What survives in `SKILL.md` is the invocation, the echo obligation, and the
handling of the two boundaries below.

**3. Per-dispatch payload stays in the stable prefix — this ADR does not license moving it.** The
196 lines of per-phase base prompts look like the same kind of dead weight and are not: converting
them costs 4.9% of the prefix (~$0.04/run) in exchange for a once-per-phase read, the worst-measured
shape in the corpus. The same protection covers the read contract that
[[decisions/ADR-0008-read-discipline-contract]] pins inside `=== STABLE PREFIX ===`.

**4. Two boundaries the command cannot cross, and how each is handled.** Both are real and neither
costs the median run a turn:

- **`mcp__skills__list_skills`** reports which skills the *harness* has loaded. A node process cannot
  see that; it can only run the documented FS-glob fallback. The command therefore performs the
  fallback and reports `skills_source: "fs-glob"` in its output, and accepts an optional
  `--skills <csv>` when the orchestrator already holds the authoritative list. This is not the model
  transcribing a machine-held value — it is the model passing harness state no machine on disk can
  observe, which is the one direction [[decisions/ADR-0015-the-machine-value-invariant]] permits.
- **`mcp__plugins__suggest_plugin_install`** is a tool call, reachable only by the model. It fires
  only on a `block`-policy abort. The command emits the abort payload (missing plugin, missing
  skills, install command) and the orchestrator makes at most one further call on a path that ends
  the run anyway.

The command is otherwise total: `HALT` conditions (aspect ties, invalid workflow, unparseable
recipe) become non-zero exits with the specified message, `--dry-run` prints the resolved-plan
preview and exits, and every `MUST PRINT VERBATIM` block is returned as a string for the
orchestrator to echo rather than compose.

**5. The manifest root is a parameter, not a constant.** The shipped command must resolve manifests
from `PLUGIN_CACHE_ROOT` — what the consumer actually has installed. The dev/CI shim resolves them
from the marketplace working tree. Verified concretely: `resolveStack()` pointed at the repo tree
attaches `datastore-proto` to `parlor-android`, while every real run of that project resolved
without it, because that plugin exists in the repo and is **not installed** in the cache. The prose
was right and the one-off invocation was wrong. A single hard-coded root would make the shim and the
shipped code disagree on production input while all fixtures pass.

**Expected effect, corrected against the split above and still an estimate:** the collapsible
**24 turns → 2–3** (the command plus the echo), leaving the whole start window at roughly **10 turns
instead of 34** once Step 2's untouched ~7 remain. Worth about **$1.2/run ≈ 11.8% of run cost**,
plus the ~3% byte term as 926 lines leave the prefix — together **~14–15%**.

An earlier draft of this ADR claimed ~17% and "34 turns → 4–6". Both were wrong in the same way:
they priced the whole measured window as if all of it collapsed. The number is recorded here as
corrected rather than quietly replaced, because the DoD is to publish what the collapse actually
buys, not what it was hoped to buy.

## Consequences

**Positive.**

- The largest measured cost item in Track H moves from ~11.8% of a run to a rounding error, by
  arithmetic rather than by an A/B that the 55.6–64.2% noise floor would swallow.
- The 2.2× run-to-run spread on a deterministic procedure collapses to a constant.
- Detection stops being implemented twice, in two languages, with only a comment linking them.
- Resolution becomes testable. Today its correctness is only observable by reading a transcript and
  judging whether the model followed 926 lines of prose; afterwards it is a function with fixtures.
- One new mandated invocation, of the only shape measured at 100%.
- `SKILL.md` drops ~926 lines, which lowers the prefix re-billed on every remaining turn of the run —
  a second-order saving on top of the turn collapse.

**Negative, and accepted.**

- **A new failure surface with no prose fallback.** When 926 lines described the procedure, a broken
  step degraded; when one command owns it, a crash stops the run. The command must exit with an
  actionable message, and `SKILL.md` must document the degraded path in a few lines — not by keeping
  the 926 as a shadow copy, which would forfeit the entire saving.
- **The estimate is an estimate.** 4–6 turns is a projection from the tool histogram, not a
  measurement. It is falsifiable the moment the first run lands, and the honest failure mode is that
  workspace/git setup and user interaction turn out to cost more turns than assumed.
- **Divergence risk moves rather than disappearing.** Prose could drift from `detect.mjs` silently;
  now the shipped module and `SKILL.md`'s description of it can drift instead. The mitigation is that
  `SKILL.md` will describe almost nothing — the smaller the description, the less there is to drift.

**Explicit limits.**

- **This does not close the H4 gate and must not be read as doing so.** H4 is about phase sequencing,
  gates and telemetry assembly being model-owned. Profile resolution is a separate lever and was
  never what that gate waited on. Whether Steps 0 → 1d fall inside H4's scope is a reading to
  confirm, not an assumption — recorded here so that shipping this ADR cannot later be mistaken for
  evidence about H4.
- **It buys no compliance.** Resolution has no contract today and gains none; the rates in
  [[planning/h1-compliance-auditor]] are untouched. The one new invocation is worth adding a contract
  for, but that is a follow-up, not a claim of this decision.
- The interactive `AskUserQuestion` turns in the window are unaffected. A run that asks the user
  questions will still ask them.
- **Step 2 is out of scope.** Its median 7 turns / $0.45 stay exactly as they are; nothing here
  touches workspace creation, the run anchor or `_brief.md`.
- **The enabled-plugins question moves onto the critical path.** Globbing the cache reaches every
  plugin ever installed under that config dir, enabled or not — the open item in
  [[planning/backlog]] (Track H — plugin discovery correctness). Prose has the same defect today, so
  this ADR neither creates nor fixes it, but a command that resolves the cache makes it the obvious
  place to close it.

## Related

- Implemented by: #<pr>
- Implementation spec: [[planning/h5-d2-start-resolution-command]]
- The measurement that sized it: [[planning/h5-prompt-surface]]
- The same argument at the other end of the run: [[decisions/ADR-0014-the-run-tail-is-one-command]]
- What must stay in the prefix: [[decisions/ADR-0008-read-discipline-contract]]
- Which values the model may and may not supply: [[decisions/ADR-0015-the-machine-value-invariant]]
- Why the plugin root and not the repo root: [[decisions/ADR-0009-plugin-root-resolution]]
- Parent track and the H4 gate this does not close: [[planning/h-instruction-fidelity]]
