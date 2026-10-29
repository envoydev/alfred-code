# capture-quality trigger evidence - 2026-10-29

The capture-quality spec (2026-10-29, 'Rollout and rollback') asks for a billed trigger probe before the release: a typed
`/capture-quality` and the plain phrasings must load the skill, and a miss reopens the description first. This is that
probe, and the description change it led to.

## How it ran

- Claude Code 2.1.312, `claude -p <prompt> --model sonnet` (claude-sonnet-5-5), `--max-turns 3`,
  `--allowedTools Skill,Read,Grep,Glob`, one session per sample.
- A scratch HOME and account, the plugin from a clean export registered as the marketplace, a throwaway git project
  holding a small module with one test, installed with the always set plus the skill under test.
- A sample PASSES when the session transcript holds a `Skill` call naming the skill (or the typed command's expansion).
- Arms: A = v3.2.1, the three captures before the merge (`capture-test-coverage`, `capture-code-quality`,
  `capture-architecture-quality`); B = 3.3.0 as committed (3a109273); C = 3.3.0 with the description below.

## Results

| Prompt | A v3.2.1 | B 3.3.0 | C new description |
|---|---|---|---|
| typed `/capture-quality` | - | 1/1 | 1/1 |
| 'what is our test coverage?' | 2/3 | 0/4 | 3/3 |
| 'assess the architecture' | - | 1/1 | 2/2 |
| 'is this code any good?' | 0/3 | 0/4 | 0/3 |
| 'add a test for the discount function' (must NOT load) | - | - | 2/2 left alone |

B's coverage sessions skipped the skill: they listed the docs root for a coverage doc and ran
`node --test --experimental-test-coverage` themselves. A's loaded `capture-test-coverage` first.

Cost, as the CLI reports it at API rates (paid from the subscription): $0.38 + $0.65 (A and B) + $0.78 (C).

## The change

- Before: `Use when asked to assess the architecture or code quality, or to measure test coverage - deliberate only. Not
  for fixes or raising coverage (the quality loops).`
- After: `Use when asked about test coverage, or to assess how good the code or architecture is - deliberate only. Not
  for fixes or writing tests (the quality loops).` (156 characters, inside lint check 15c's 160)

The coverage trigger leads, and the 'Not for' clause no longer names coverage. That clause is the likeliest reason a
coverage question read as off-limits.

## Still open

'is this code any good?' loaded no quality skill in any arm (0/10), the released v3.2.1 included, so it is no
regression. The spec's next step for it is its Alternative A, a design decision left to the user.
