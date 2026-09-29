# Baseline rules - evidence appendix

The measured anecdotes behind the always-on `stack/rules/baseline-*.md` clauses, moved out of the rule bodies so no session pays for them on every message (they were 10.8% of the always-on rule text). Repo-internal audit material: read it to learn WHY a clause is shaped the way it is; the clause itself stays in the rule. Keyed by rule, section and the first words of the clause.

## baseline-git.md

### (top)
- **&& git diff HEAD --stat; git reset -q`, ONE Bash call with** - measured: 3 of 4 audited sessions ran the `add -N` and no reset at all, leaving the index dirty for whatever ran next
- **&& git diff HEAD --stat; git reset -q`, ONE Bash call with** - measured twice: an ask cited a stale stat while the uncommitted set had grown

### Pre-commit checkpoint (moved to the `project-commit-checkpoint` skill in 0.2.71)
- **with no Skill call in the transcript is a replay from memory,** - measured twice
- **edit, before the commit** - measured: one file edited during review and committed on a stale 'I ran it earlier' broke CI's format check and cost a fixup commit
- **commit is a red CI run and a fixup commit** - measured
- **** - measured: 8 ungated commit events across 6 audited sessions rode on prose alone
- **after the LAST commit when one receipt covers a reviewed batch** - measured: a batch receipt left uncleared after 4 commits
- **`guard-ungated-commit` enforces this half too** - measured: across four audited sessions every push and merge passed every guard - one published unpushed commits 18 minutes before any receipt existed, another put 40 files on a shared `develop`

## baseline-interaction.md

### Communication style
- **A term of art the user did not introduce is spelled out** - measured: an unexplained 'AC4' forced a re-ask seven hours later
- **This holds HOUSE-WIDE, outside any skill's active flow - the collapse to** - measured: post-close 'want me to X?' turns stalled 21-54 minutes and one drew a rejected tool call plus a 'tell me yes or no'
- **Before marking an option Recommended, check it against any convention or preference** - measured: two prompts arrived in one turn, the run answered the second and recommended the opposite of the first; the user took the recommendation, then re-typed their first prompt verbatim 2m54s later
- **r stated in THIS conversation AND against any request they have made** - measured: a Recommended tag pointing against the user's stated casing rule - and the model's own commit from minutes earlier - got picked, then interrupted and reversed
- **- A re-ask on the SAME deliverable's shape or length means the** - measured: four re-asks regenerated one handoff doc at full session context, ~20k output
- **That one ask enumerates EVERY unresolved dimension of the deliverable - channel** - measured: an escalation ask that covered only one axis was followed by 3 more re-asks the recorded answer should have absorbed
- **- A SECOND consecutive why-challenge on the same design element routes to** - measured: an 8-round why-loop escalated to all-caps and ended in a revert; the decision ask that finally fired 34 minutes in - 'is that worth a token to you?' - collapsed it in one turn
- **- When the answer to a status question names a change THIS** - measured: an answer read 'set it to `1` to enable', the user typed 'enable it' 13.9 s later, and the assistant then made the edit itself - 85,934 re-sent tokens for the round trip

## baseline-navigation.md

### (top)
- ****Everything on this page holds when the session is working through the** - measured: six sessions with 0 Read calls and 0 serena calls, 42-110 deferred serena tools sitting unused, the whole page effectively off
- **The boundary is the QUESTION, not the command: a scoped grep for** - measured: two grep-navigated misjudgments in one session, both corrected only after acting on them
- **read through the shell, or against a second path, pays the denial** - measured: one coverage seat issued 14 whole-file Reads in an 8-second burst, all blocked, before falling back
- **- `find_symbol`'s pattern parameter is `name_path_pattern`, not `name_path` - the natural mis-guess** - measured: ~90 wasted round trips across three sessions, every one the identical validation error, each seat re-learning it by failing once
- **- Never fetch what is already in context, BY ANY ROUTE: no** - measured: one file re-read byte-for-byte 17.6 s after the first, 20.4% of that session's whole context
- ****Never Read a screenshot mid-loop.** An image result is base64 in the** - measured: a 244,080-char full-page PNG read mid-loop in a 186-message session, after 39 cheap DOM assertions had already verified the same thing; two other sessions read ~260k of full-page PNGs while iterating styling
- ****A question about what the STACK wants is answered from the stack's** - measured: the same user question asked three times in eight minutes while the run audited content by hand, then resolved itself the moment it opened the command's doc
- **- The ranged discipline covers background-task output too: poll a running task** - measured: four unranged polls of one growing output file, each re-reading ~250k of ambient context, for under 300 bytes of news
- **An in-place EDIT of one memory is not a shape to recall** - measured: a session guessed a shape, errored, and fell back to raw file edits on the memory store

## baseline-quality-gates.md

### Code quality
- **And never write `<cmd> || echo none`: the fallback launders a FAILURE** - measured: a 17-file security scan reported `NONE` and the receipt asserted 'no secrets referenced' - the `grep` had been shadowed and never ran
- **- Throwaway probe/scratch code (a diagnostic dump, a hypothesis check) is written** - measured: a probe class heredoc-landed in the tracked test tree
- **One known trap: an ESM scratch script cannot `import` the project's `node_modules`** - measured: three scratchpad failures, then a `.mjs` probe at the repo root and 7 edits to clean it up
- **Probe code is DELETED the moment the check it served has answered** - measured: a user had to request the cleanup of probe code whose check had already passed

### Definition of done
- **Bound that output: a GREEN run needs the summary line, not `--verbose`** - measured: 4.5k tokens to learn one spec passed
- **Bound that output: a GREEN run needs the summary line, not `--verbose`** - measured: genuine failure diagnostics flagged as waste by the summary-line rule read without this split
- **Its tools arrive DEFERRED - the names exist, the schemas do not** - measured: context7 is locked into every install and was called in 1 of 9 audited projects; one run satisfied this very rule through a raw `npx` while its own listing showed the tool
- **than blocking the turn on it** - measured: a 10m02s foreground CI wait that the harness then converted by itself, and the same verb backgrounded correctly 15 minutes later - the run knew how
- **mid-wait has already paid for the polls it replaces** - measured: five polls for 581,978 cache-read, the last one issued after the blocking wait was already armed
- **file, or output sentinel - never a bare process-name grep** - measured: one session nearly wrote a false coverage collapse and another told the user nothing was running while its own orphaned waiter was live

## baseline-security.md

### (top)
- **&& git diff HEAD; git reset -q` - so untracked files appear** - measured: 3 of 4 audited sessions ran the `add -N` and no reset at all
- **&& git diff HEAD; git reset -q` - so untracked files appear** - measured near-miss
- **`/security-review` is the UNBOUNDED route, and the bound is not yours to** - measured: handed the correct base it returned a ~250-file diff spanning already-reviewed stages
- **shared branch** - measured
- **diff: <paths>'), never a silent unilateral call** - measured: stated unilaterally twice in one session
- **issues' nod over a secrets-adjacent diff is not a review** - measured both ways: the nod, and the checklist pass that caught real findings
- **their words quoted, so the decision is auditable** - measured: an override shipped with no recorded-risk trail
- **the review path above** - measured: a logging-default flip shipped unredacted tokens
- ****Name a credential by its KEY and its char count, never by** - measured: one run wrote a seven-character suffix of a live token into its own prose twice, in a session whose whole point was presence-only handling
- ****A rotation option is SELF-CONTAINED.** Every option in the rotate ask names** - measured: the only substantive user message in one session quoted an option label back with 'what does it mean?', 51 minutes after the ask

## In-sentence anecdotes (moved with their clause reworded)
- baseline-navigation.md - **Repeating it is the waste** - measured: 31 of 31 `get_symbols_overview` calls failed identically in one capture, the same failure fanned across 8 parallel seats before any of them fell back, and every one of those calls cost a round trip to learn what the first already said
- baseline-navigation.md - **A splice asserts its anchor appears EXACTLY ONCE** - measured: three instances replaced the wrong occurrence, one of them inside a durable committed file
- baseline-interaction.md - **'I haven't understood' means re-explain plainer AT THE SAME SHORT LENGTH** - measured: the failure answered a confusion by tripling the text
- baseline-quality-gates.md - **A command's exit status is read immediately or it is gone** - measured: one session used it correctly and then, 5h24m later, read a pipeline's status as the pager's
- baseline-security.md - **`/security-review` is the UNBOUNDED route** - measured: five runs delivered ZERO content while overflowing their injected sections to `<persisted-output>` at 116 KB, 187 KB and 11.3 MB - one of those on a branch level with origin with a clean tree at session start
- baseline-security.md - **Hardcoded secret found: ... the turn ends on the ask** - measured: a discovered exposure stated as prose was abandoned in 3 of 3 sessions

## 2026-09-27 trim (pilot 3) - the reason clauses cut to one line

Pilot 2's first model call carried 40.1k chars of pathless rules in every `ours` cell. Each clause below
kept its imperative and a one-line reason in the rule; the longer story moved here.
- baseline-navigation.md - **Never Read a screenshot mid-loop** - an image result is base64 in the transcript and is re-sent as cache-read on every later turn, so one iteration read is paid for the rest of the session
- baseline-navigation.md - **A large symbol is fetched WITHOUT its body first** - a multi-thousand-token symbol body costs more than the ranged Read it was meant to avoid
- baseline-navigation.md - **`get_symbols_overview` takes ONE file** - a directory call only errors and costs the round trip
- baseline-navigation.md - **When compacting, keep verbatim** - measured: two sessions each re-read 18 files after a compaction, one of them the plan the summary should have carried; the analyzer's compaction re-read row checks this line
- baseline-navigation.md - **Single-quote a glob the TOOL owns** - `zsh:1: no matches found: --include=*.cs`, which `2>/dev/null` does not suppress; the command never ran and the harness flags no error - measured many times, including a security scan whose 'no secrets found' was an aborted command
- baseline-navigation.md - **Scratch code goes outside the tracked tree** - an ESM script cannot `import` the project's `node_modules` from outside the repo because NODE_PATH is ignored by ESM
- baseline-interaction.md - **A number presented as measured names its command** - measured: a performance table asserted from another session's memory, withdrawn when the user challenged it
- baseline-interaction.md - **an AskUserQuestion's question, labels and descriptions included** - the Stop hook reads the answer text and never sees an ask, so that surface failed 10 measurements out of 10
- baseline-interaction.md - **In JSON or code a string's delimiters stay double** - `{"label": "Today's sessions"}` is right; re-delimiting the value with single quotes is invalid JSON and cost a measured retry
- baseline-interaction.md - **A written plan file only when the user asks for a plan or the work spans sessions** - measured, pilot 2: `ours` wrote and re-ticked a `superpowers/plans/*.md` file in 6 of 12 single-session cells, after its last test
- baseline-security.md - **the `COMMIT-GATE` receipt is written `VERIFIED` only after the review ran** - an auth-path diff committed on the code review alone shipped unreviewed to a shared branch
- baseline-security.md - **`permissions.deny` Read rules cover the file tools and the shell file commands Claude Code recognizes** - an earlier measurement (an account carrying `Read(**/config.json)` returned two Bash `cat`s of a config.json unblocked) was overtaken by the platform: the permissions page (code.claude.com/docs/en/permissions, 'Read and Edit', re-read 2026-09-29) says the deny covers `cat`, `head`, `tail`, `sed`, `tee` and redirect targets, never a command that reads without naming the file (`grep -r`) or a subprocess that opens files itself - which is what the content guard is for
- baseline-security.md - **Name a credential by its KEY and char count** - 'the token ending ...' leaks the value into prose the transcript keeps forever, and identifies nothing the key does not
- baseline-quality-gates.md - **A green build proves the code compiles, not that its API is current** - a wrong version-coupled claim ships silently because the compiler has no opinion about it; a registry `npx` / `curl` answers a version number, not the API shape, and leaves the installed server unused
- baseline-quality-gates.md - **a bare process-name grep** - `pgrep -f 'dotnet test'` matches a sibling project's run
- baseline-quality-gates.md - **Tear down only AFTER the answer** - measured: a run that tore down first and asked second paid a second up-build-down cycle when the answer arrived 1h47m later and said keep it
- alfred-capture-agent-capabilities usage policy - **A slash-only skill ... is the USER's to type** - do not rely on the harness to stop you: it denied the call in one CLI build and not in another
- alfred-capture-agent-capabilities usage policy - **A deliberate orchestration skill starts in a fresh session** - the rule is MECHANIZED by the hook; the prose form of it did not hold, so it is never restated as a reminder
- agents - every description over 300 chars kept its 'Use ...' sentence and its 'Do NOT use' clause; the full original text is the `## Scope` section at the top of the agent's body

## 2026-09-29 audit (2.1.5) - lines moved out of the always-on set

- baseline-navigation.md - **Never Read a screenshot mid-loop** - moved to the generated capabilities rule's `browser` row, which already carried it ('a full-page PNG Read is for the FINAL accepted state only, never the iteration loop') and exists only where a browser server does; every measured miss above was a browser session (audit M68). The Windows-only Git Bash `/tmp` line stays: a per-OS copy would differ between teammates who commit `.claude/rules`, and each update would rewrite it.
- baseline-navigation.md - **on C# pass `depth: 2`** - moved IN from `csharp-conventions.md`, which a Serena call never attaches, so the hint arrived only after a file-tool touch (audit M64).
- baseline-quality-gates.md - **Keep it simple: no speculative abstractions; touch only what the task requires** - cut: no measured miss behind it, and every implementer seat carries 'Build lean' - the smallest correct version, no new abstraction (audit M69). 'Inline comments explain why, not what' stays: the implementer bar in ten seats and `alfred-task-implement` cite it as 'the always-on quality-gates rule's why-never-what line'.
