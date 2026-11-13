# The plan folder contract

A plan is a folder, `<docs root>/work/plans/<feature>/`, holding `<feature>.md` (the design), `status.json` (what the
gate, the approval and the build record) and `scoring.json` (the grades). The session status file names the folder in
its `plan` key. The alfred-mods plugin reads all three; alfred-code reads nothing of alfred-mods' for it.

Every file is schema 1 and add-only: a key may be added, never renamed, removed or retyped - that takes a new
`schema` number. A reader ignores a key it does not know. Every key is always present; a value that can be missing is
`null`. A plan that is one `.md` file directly under the plans folder has no JSON files.

## status.json

Written by `node .claude/hooks/plan-status.js` only, never by hand: the whole file to a temp file in the same folder,
then a rename over `status.json`. Two-space JSON, LF, one final newline.

Keys (in file order): `schema`, `title`, `updatedAt`, `approvedAt`, `completedAt`, `tasks`, `reopenedAt`, `reopens`, `retiredIds`, `dropped`, `gate`, `approval`, `resume`, `decisions`, `deviations`, `conformance`, `completion`

Task keys (in file order): `id`, `title`, `status`, `estimateMin`, `startedAt`, `doneAt`, `result`, `needs`, `why`, `card`, `by`

The contract's own keys are the first five and, in a task, the first six. The rest are added keys.

- Times are UTC ISO 8601 to the minute, `YYYY-MM-DDTHH:MMZ`.
- `approvedAt` is null until approved and is never cleared; a reopened design sets `reopenedAt` until it is approved
  again. `completedAt` is null while the plan is open.
- A task's `id` is a string holding a whole number, never changed or reused. `status` is exactly `todo`,
  `in_progress`, `blocked`, `done` or `failed`. `blocked` means the task's own work is done and it waits on
  something outside it. `estimateMin` is whole working minutes (null when the plan carries no estimates), frozen
  once the task has started. `startedAt` is set at the first move to `in_progress` and never moved. `doneAt` is set
  at `done` and cleared when the task is reopened.
- A task added mid-build takes the next free id; a dropped task's id stays unused (`retiredIds`). `tasks` keeps the
  plan's order.

```json
{
  "schema": 1,
  "title": "CSV export",
  "updatedAt": "2026-11-13T10:42Z",
  "approvedAt": "2026-11-13T10:05Z",
  "completedAt": null,
  "tasks": [
    {
      "id": "1",
      "title": "Export projection",
      "status": "done",
      "estimateMin": 25,
      "startedAt": "2026-11-13T10:06Z",
      "doneAt": "2026-11-13T10:31Z",
      "result": "dotnet test - 4 passed, 0 failed",
      "needs": null,
      "why": null,
      "card": null,
      "by": null
    },
    {
      "id": "2",
      "title": "Streamed endpoint",
      "status": "in_progress",
      "estimateMin": 30,
      "startedAt": "2026-11-13T10:33Z",
      "doneAt": null,
      "result": null,
      "needs": null,
      "why": null,
      "card": null,
      "by": null
    }
  ],
  "reopenedAt": null,
  "reopens": [],
  "retiredIds": [],
  "dropped": [],
  "gate": {
    "at": "2026-11-13T09:58Z",
    "verdict": "passed",
    "block": "Oriented:  verified\nAsked:     verified\nDecisions: 2 entries, each with its precedent\nScope:     matches\nExistence: 6 names checked, 0 unverified\nPasses:    risk pass | scope pass | existence pass | edges pass | soundness pass\nFindings:  none\nGated:     passed"
  },
  "approval": {
    "mode": "session",
    "words": null
  },
  "resume": {
    "note": "step 4 BUILD - mode session",
    "next": "2",
    "at": "2026-11-13T10:42Z"
  },
  "decisions": [],
  "deviations": [],
  "conformance": null,
  "completion": null
}
```

Entries: `decisions[]` are `{ at, task, choice, precedent }`; `deviations[]` are `{ at, task, what, why, asked }`;
`dropped[]` are `{ id, title, at, why }`; `reopens[]` are `{ at, why, approvedAt, gate, task }`; `conformance` is
`{ at, verdict, reviewer, skipped }`; `completion` is `{ suite, open }`.

## scoring.json

Written by the output scoring's `scorecard.js` only. It first appears when a draft is released, and a re-grade of a
plan on disk rewrites it at every step of that run. A re-grade appends rounds and never rewrites an earlier run's.

Keys (in file order): `schema`, `scale`, `released`, `rounds`, `output`, `releasedBefore`, `status`

Round keys (in file order): `round`, `at`, `total`, `severities`, `id`, `attempt`, `self`, `accepted`, `rubric`, `level`, `findings`

The contract's own keys are the first four and, in a round, the first four. The rest are added keys.

- `scale` is 100. `released` is the `round` whose draft was kept - the best round, not always the last - or `null`.
- `status` says what a null `released` means: `grading` while a run is in flight, `withheld` when a run ended with
  no round ever released. With a round released it is `released`, or `accepted` when that round was released below
  the level on the user's word.
- `releasedBefore` is the round released before the running re-grade began, else `null`.
- `at` is when the round was graded, to the minute: the time its first valid grade came back. When that time cannot
  be read it is the minute the entry was written.
- `total` is the round's value (the mean of its valid grades). `severities` counts the findings that were counted,
  by severity, unique by title.
- `findings[]` are `{ severity, title, disposition, needs }`. `disposition` is exactly `discarded` (a field was
  missing, so it was not counted), `needs-human` (only the user's answer closes it; `needs` holds what is asked),
  `closable` (a revision can close it) or `open`. `needs` is an empty list under every other word.

```json
{
  "schema": 1,
  "scale": 100,
  "released": 2,
  "rounds": [
    {
      "round": 1,
      "at": "2026-11-13T09:31Z",
      "total": 78,
      "severities": { "BLOCKER": 0, "MATERIAL": 2, "MINOR": 0 },
      "id": "1a2b3c4d",
      "attempt": 1,
      "self": false,
      "accepted": false,
      "rubric": "rubric-designer-plan.md",
      "level": 80,
      "findings": [
        { "severity": "MATERIAL", "title": "Rollback owner unnamed", "disposition": "needs-human", "needs": ["the rollback owner"] },
        { "severity": "MATERIAL", "title": "No test for the empty export", "disposition": "closable", "needs": [] }
      ]
    },
    {
      "round": 2,
      "at": "2026-11-13T09:40Z",
      "total": 85,
      "severities": { "BLOCKER": 0, "MATERIAL": 1, "MINOR": 0 },
      "id": "2b3c4d5e",
      "attempt": 1,
      "self": false,
      "accepted": false,
      "rubric": "rubric-designer-plan.md",
      "level": 80,
      "findings": [
        { "severity": "MATERIAL", "title": "No test for the empty export", "disposition": "closable", "needs": [] },
        { "severity": "MINOR", "title": "Heading order", "disposition": "discarded", "needs": [] }
      ]
    },
    {
      "round": 3,
      "at": "2026-11-13T09:49Z",
      "total": 82,
      "severities": { "BLOCKER": 0, "MATERIAL": 1, "MINOR": 0 },
      "id": "3c4d5e6f",
      "attempt": 1,
      "self": false,
      "accepted": false,
      "rubric": "rubric-designer-plan.md",
      "level": 80,
      "findings": [
        { "severity": "MATERIAL", "title": "Streaming limit unstated", "disposition": "open", "needs": [] }
      ]
    }
  ],
  "output": "designer-plan",
  "releasedBefore": null,
  "status": "released"
}
```

The score rule: the plan's score is the `total` of the round `released` names. While `released` is `null` and
`status` is `grading`, the newest total is a score in progress.

## Session status file

`<project>/.claude/session-inspector/status/<session id>.json`, written by the hooks. Its `plan` key is the plan
folder relative to the project root, forward slashes, one trailing slash, or `null` when the session has no plan. It
is set when the session starts or resumes a plan and goes back to `null` once the plan is completed or its folder is
gone. A plan outside the project root is `null`, never a `../` path. `updatedAt` here is a full ISO 8601 time.

Keys (in file order): `schema`, `session`, `fullContext`, `updatedAt`, `model`, `window`, `resumeAt`, `autoRun`, `scorer`, `autoCompact`, `handoffPrompt`, `plan`

```json
{
  "schema": 1,
  "session": "0b8c2f6e-5d0a-4c1e-9a43-6f1d2e7b9c10",
  "fullContext": "fresh-session",
  "updatedAt": "2026-11-13T10:42:07.123Z",
  "model": "claude-sonnet-4-5",
  "window": 200000,
  "resumeAt": 180000,
  "autoRun": false,
  "scorer": { "on": true, "level": 90, "rounds": 3 },
  "autoCompact": { "on": false, "at": null },
  "handoffPrompt": null,
  "plan": ".alfred/docs/work/plans/csv/"
}
```

`scorer` is `{ on, level, rounds }` or `null`; the name stays until 4.0.0.
