# Session-model A/B - Sonnet at xhigh vs Opus at high (2026-10-09)

Why the judging captures, their loops and the version-upgrade and greenfield flows ask for no switch to Opus.
Each skill told the user to put the session on Opus before its judgment; the repo's yardstick is that Sonnet
through this stack does at least as well. These runs measured it.

## Method

- Claude Code 2.1.294, headless (`claude -p`) under a throwaway config dir, one run per model per task, the
  same prompt and the same stack install (develop b006c7b9 for the first eShopOnWeb capture, b2247343 after).
- Sonnet 5.5 at `--effort xhigh` vs Opus 5.5 at `--effort high`. Dispatched seats run at their own pins in both
  arms, so the difference is the main session's model.
- Permission checks on, with a scoped `--allowedTools` list (Skill, Agent, read tools, Write/Edit under the
  project, the three locked servers, Bash limited to git / node / ls / cat, plus dotnet for the upgrade). The
  same chained-shell denials hit both arms.
- Each checklist was written from the code BEFORE either output was read. The upgrade checklist comes from
  doing the upgrade by hand first (build, 74 tests, EF pending-model check), not from recall.
- Public projects only: eShopOnWeb @4da8212 (.NET 8, 254 C# files), angular-realworld-example-app @dd99ed2
  (Angular 21, 42 TS files; its own CLAUDE.md removed in both arms so the capture had to read the code).

## Results

| Task | Sonnet xhigh | Opus high |
|---|---|---|
| Architecture capture, eShopOnWeb (15-item checklist) | 15/15, 0 wrong - $2.96, 7.4 min | 15/15, 0.5 wrong - $3.01, 4.8 min |
| Architecture capture, Angular RealWorld (15) | 15/15, 0 wrong - $1.82, 4.7 min (1) | 14/15, 0 wrong - $2.11, 3.9 min |
| Code-quality capture, eShopOnWeb (8 recall items + precision) | 4.5/8, 9/9 sampled findings true - $6.73, 19.5 min | 4/8, 12/12 sampled true - $4.24, 8.5 min |
| Version-upgrade plan, eShopOnWeb .NET 8 -> 10 (12) | 9/12, 1 mislocated impact - $2.08, 7.0 min | 9/12, 0 wrong - $2.18, 5.7 min |
| Greenfield design, planted-constraint spec (10) | 10/10 - $0.54, 2.2 min | 10/10 - $0.72, 1.9 min |
| Total | $14.13 | $12.26 |

(1) The Sonnet arm's one doc write was auto-denied by the headless permission layer (the same path was allowed
in the Opus arm); the full draft from the denied call was scored.

## Reading

- Accuracy: Sonnet matched or beat Opus on every checklist (ahead on two, level on three). On wrong claims each
  lost one: Opus a half on the eShopOnWeb capture, Sonnet one mislocated impact in the upgrade plan. Both found the non-obvious items (eShopOnWeb's
  load-bearing core-to-client project reference, the seed retry that rethrows after success); each code-quality
  run found real defects the other missed (Sonnet: every order ships to one hard-coded address, a tracked Data
  Protection key ring; Opus: the auth cookie builder replaced after `HttpOnly` is set).
- Neither upgrade plan predicted the two real compile breaks (an NU1605 downgrade of System.IdentityModel.Tokens.Jwt
  and Azure.Identity, and CS0433 from the .NET 10 public `Program` class in a test project that references both
  hosts); both plans gate each stage on a build, which catches them.
- Cost and time: Opus was faster on every task (1.2x to 2.3x). Cost was even on four tasks; the code-quality
  capture is the outlier, where Sonnet ran a second gather round and 117 turns ($6.73 vs $4.24).
- One run per cell: a pointer, not a distribution. The code-quality cost gap is the result to re-measure first.

## Ruling

The user ruled on 2026-10-09 to drop the Opus nudges (same accuracy for the same money); the flows followed once
measured. The skills keep their `Model:` report line where they had one.
