# Plugin evals - `claude plugin eval`

Checked against the Claude Code plugin evals page on 2026-09-12. Requires Claude Code 2.1.269 or
later, and every run is a real model call on the account. Re-verify flags through the documentation server before
a CI change.

Contents: [What a run is](#what-a-run-is) - [Layout](#layout) - [Graders](#graders) -
[Reading the result](#reading-the-result) - [CI](#ci) - [Mocks and fixtures](#mocks-and-fixtures)

## What a run is

Each case is a realistic prompt plus graders. Per run Claude Code starts a fresh, isolated,
non-interactive session with ONLY the plugin under test loaded, in an empty working directory,
sends the prompt and grades what came back. Each case runs three times by default, and again three
times WITHOUT the plugin (the ablation), so one case is six runs. The with / without delta is the
number that says the plugin contributed.

```
claude plugin eval init                 # Claude proposes cases + graders, writes evals/
claude plugin eval init --bare <case>   # a blank case template
claude plugin eval .                    # the whole suite, from the plugin root
claude plugin eval . --case <name> --runs 1 --ablation none    # iterate one case cheaply
```

## Layout

```
evals/
├── <case-name>/
│   ├── prompt.md          # frontmatter: max_turns, allowed_tools; body: the user message
│   ├── case.yaml          # optional: schema_version "1.1", name, runs, model, tags, context
│   └── graders/
│       ├── criteria.md    # type: llm - PASS / FAIL rubric in the body
│       └── skill-fired.md # type: tool_used, tool: Skill, input_match: <skill name>
├── mocks/<server>/<tool>.md
└── results/<timestamp>/{aggregate-result.json,report.html}
```

If `evals/` is taken, set `"experimental": { "evals": "quality/evals" }` in plugin.json or pass
`--eval-dir` (a relative path of plain directory names, no `..`).

## Graders

| type | fields | passes when |
|---|---|---|
| `regex` | `pattern`, `flags`, `match`, `target` | the pattern is found in the target (`match: not_contains`, `count:N`) |
| `tool_used` | `tool`, `input_match`, `min`, `max` | the call count to `tool` (input matching the regex) is within bounds |
| `tool_order` | `before`, `after` | both called and the first `before` precedes the first `after` |
| `file_exists` | `path`, `exists` | a file created during the run matches the glob |
| `llm` | `criteria`, `focus` | a judge votes PASS in at least two of three votes |
| `baseline` | `baseline_file`, `criteria` | a judge finds the run at least as good as a reference transcript |

`target` is an ENUM the case loader validates, not free text - measured on 2.1.269, `last_message`
(the default, and what a failure reports as `pattern not found in last_message`) and `files` load,
while a plausible spelling like `final_message` fails the whole case with
`graders.N.target: Invalid input` before any run. Omit it for the answer text; a wrong value costs
the case, not a grader.

Habits that keep scores stable: one grader on the RESULT (final message or a produced file) plus
one on the ROUTE (`tool_used` / `tool_order`); `regex` over long output, `llm` for short text
only; `--judge-model sonnet` for a nuanced rubric. `tool_used: Skill` graders and any grader
marked `arm: with-only` are not scored in the without-arm; `arm: both` forces it.

## Reading the result

`WITH` is the case's score with the plugin, `W/OUT` without it, `Δ` the difference, `COST` a
list-price estimate. The most common first finding: `Δ` near zero with the `tool_used: Skill`
grader failing - Claude is not choosing the skill on natural phrasing; the fix follows the
description rules in the skills docs. A passing skill grader with a negative `Δ`
points at the judge before the plugin. `--keep-temp` keeps each run's sandbox for inspection.

## CI

```
claude plugin eval . --trust-plugin --json results.json --threshold 0.8 \
  --model claude-sonnet-5 --judge-model claude-haiku-4-5 --max-cost-usd 5
```

Exit 0 when every case scores at or above `--threshold` and every case file loaded; any case
below it exits 1. Pin `--model` so a model rollout is not read as a plugin regression, and put a
cost ceiling on it. `-j <n>` runs up to 8 in parallel against the same rate limit.

## Mocks and fixtures

A run never starts the plugin's real MCP servers unless asked: a Markdown file per tool under
`mocks/<server>/<tool>.md` answers the call (`{{input.<field>}}` templating, an `expect:` block on
the input, `target: mock_calls` to grade the calls). `--allow-real-servers` starts the unmocked
ones; `--mocks off` starts them all. Fixture files or a git history come from a
`context.scaffold_script` in `case.yaml`, run with `--scaffold`. Granting `Bash` in
`allowed_tools` runs every command under the OS sandbox, writes confined to the run's workspace.
