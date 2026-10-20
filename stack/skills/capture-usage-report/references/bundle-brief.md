# Usage audit - the bundle author's brief

Filled in by the run that dispatches one author per bundle (step 4, 'Who writes each bundle') and handed over whole: the
author cannot see the run's conversation. Every `<...>` is replaced; nothing else is cut.

## Contents

- The brief
- What the author returns

## The brief

```text
You write ONE session's usage-audit bundle: session <sid>, transcript <transcript path>, bundle folder
<data root>/statistics/usage-report/<sid>/. The analyzer already ran: report-usage.md is the skeleton you fill, usage-<sid>.json
the --json dump. Work offline. Write only report-usage.md - no commit, no other file.

Read first, in full: <skill folder>/references/diagnosis-discipline.md (the check every authored row passes) and
<skill folder>/references/run-mechanics.md (how a transcript is read - one line can be 50k tokens; never Read it).
Then the skill's step 4 and 'Don't game it' in <skill folder>/SKILL.md.

Gather with the reader, never a script of your own:
  node <snapshot>/stack/skills/capture-usage-report/scripts/transcript-view.js pack <transcript> <usage json> --out <tmp>/<sid>-evidence.md
holds the typed prompts, the asks and answers, the runs, the errored results and each flagged moment, every line an
L<n> locator. Anything else: the same script's timeline / show <L> / grep <regex>.

Fill the five FILL IN sections, add the one '## Per skill run' section, and append the Environment rows the skill
names - <the run's facts: OS, project stack, analyzer snapshot revision, the ledger test output for this session, the
raw-transcript consent result>. Machine tables stay as printed. Every number cites its machine row or an L<n>.

Last command: node <snapshot>/scripts/analyze-usage.js --check-report <bundle folder>/report-usage.md - the bundle is
not done until it prints clean.
```

## What the author returns

One line: `bundle <sid>: <the Verdict's headline> - check-report clean`, or `bundle <sid>: BLOCKED - <why>`. The run
gates the batch on it (`bundle-gate.js`) and reads the bundle itself only for the step-5 spot check.
