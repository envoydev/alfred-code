# Workspace versioning - the walk text A/B, 2026-11-25

What was tested: the sentence 51fc2cb9 added to `setup-plugin/commands/configure.md` step 8 (and `validate.md`'s env
step) - a key the workspace answers is not MISSING. Spec D10 (workspace versioning) says the MISSING
`ALFRED_CODE_DOCS_VERSIONING` row - the `docs.js status` preview and the `stamp-docs-root.js --seed-versioning` write -
is not shown in a child whose workspace answers the key. A keep-or-change question showing the workspace's value is
allowed: that is configure's typed override.

## Why an A/B and not a core eval case

The core eval suite (`setup-plugin/evals/`) runs with and without the plugin. The without arm cannot run
`/alfred-code:configure` at all, so its delta measures the command's presence, not this sentence. The with arm would
need a whole install scaffolded inside the eval sandbox. The change is one rule, so the arms are the rule's two texts.

## Method

- Fixture: a throwaway workspace `ws` with `ALFRED_CODE_DOCS_VERSIONING=local` in its `.alfred/.variables`, a git
  child `ws/api` joined to it (`scripts/workspace-fixture.js`), and the real
  `node scripts/variables.js show --root ws/api` output: `ALFRED_CODE_DOCS_VERSIONING=local (from ..)`, every other
  key `(default)`.
- Prompt: step 8 of configure verbatim (`## 8. Environment` up to `## 9.`), the real `meta/environment.json`, the
  `show` output, and 'write the message you would show for step 8, stop where the first question would be asked'.
- Run: `claude -p --model sonnet --tools "" --setting-sources "" --strict-mcp-config --no-session-persistence`,
  Claude Code 2.1.331, 3 runs per arm.
- Grade: a line that labels `ALFRED_CODE_DOCS_VERSIONING` MISSING, a `docs.js status` preview offered for it, or a
  `--seed-versioning` write offered for it fails. Each flagged line was read by hand: the word 'missing' inside a
  catalog `what` text, or a line saying the preview 'is not needed', passes.

## Result

| arm | text | pass | cost |
|---|---|---|---|
| A | step 8 before 51fc2cb9 | 3 of 3 | $0.316 |
| B | step 8 at 51fc2cb9 | 3 of 3 | $0.319 |
| B2 | B with the source named as `show` prints it (`from <rel>`) | 3 of 3 | $0.316 |

Total 9 runs, $0.95.

- Not worse, and no delta: arm A already passes, because `show` prints `from ..` rather than `default`, and step 8
  offers only a `default` row as MISSING. The sentence makes the rule explicit; it does not change the outcome here.
- One defect found and fixed: the sentence named the source 'the root', while `show` prints `from <rel>`. B2 names
  it as printed and says 'no MISSING row', so the keep-or-change question stays. One B2 run quotes the rule back
  ('answered by the workspace (`from ..`), so it is not missing. No docs probe or `--seed-versioning` run is needed').
