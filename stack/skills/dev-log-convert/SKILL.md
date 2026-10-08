---
name: dev-log-convert
description: "Use when the user says 'dev-log' - converts a day's raw work notes into a past-tense English work log. Not for meeting minutes or commit messages."
---

You will receive text (Ukrainian, English, or mixed) describing work done during one or more days. Convert it into a concise English work log written in past tense.

## When to use

Converts a day's raw work notes (Ukrainian, English, or mixed) into a structured, past-tense English work log - ticket IDs normalized, time totalled, tasks grouped by project or prefix across one or more days. Fires only on the exact keyword 'dev-log'. A request to log work read off the repo still starts from 'dev-log'.

Do not use it for general note-taking, meeting minutes, commit messages, or status updates, which are not this format.

## Ticket IDs

A ticket ID matches the pattern `[A-Z][A-Z0-9]*-\d+` (one or more uppercase letters/digits, a dash, then digits). Examples: `ABC-123`, `PROJ7-4521`.

- Output ticket IDs in uppercase, even if the input used lowercase.
- Silently correct obvious typos in prefixes (e.g. transposed letters) when surrounding tickets in the same input make the intended prefix unambiguous.
- If a task has no ticket, use `Other` as the ticket ID.

## Output format

### Single-prefix day

When all ticketed tasks in a day share the same prefix (or there are no tickets at all), use a flat list:

```
Log of work <dd.mm.yyyy>.

<Day of week>:
1 <TICKET-ID> (<time>) - <Summary sentence(s).>
2 <TICKET-ID> (<time>) - <Summary sentence(s).>
3 Other (<time>) - <Summary.>
Total time: <sum>.
```

### Multi-prefix day

When ticketed tasks in a day use two or more different prefixes, group them. Numbering restarts within each group.

```
Log of work <dd.mm.yyyy>.

<Day of week>:

<GROUP_LABEL_1>:
1 <TICKET-ID> (<time>) - <Summary.>
2 Other (<time>) - <Summary.>

<GROUP_LABEL_2>:
1 <TICKET-ID> (<time>) - <Summary.>

Total time: <sum across all groups>.
```

**Group label rules**
- If the input explicitly names a project for a set of tasks (e.g. 'Today on ProjectX:' or 'ProjectX - APV49-...'), use that name as the group label.
- Otherwise, use the ticket prefix itself as the label.
- If the input declares that several distinct prefixes belong to one project, treat them as one group under that project name.
- `Other` items go under the group whose tasks they were mentioned alongside in the input. If `Other` items have no clear group, place them under a final `Other` group.

**Ordering**
- Order groups by total time spent that day, largest first.
- Within a group: ticketed tasks first (largest time first), then `Other` items.
- The date in the title is today's date in `dd.mm.yyyy` format - for single-day input with no date of its own; a dated or multi-day input takes each entry's resolved date (see Multiple days and Edge cases).

## Rules

**Language**
- Default output language is English.
- If the input is entirely in English, keep the output in English.
- If the input is in Ukrainian or mixed Ukrainian/English, translate everything to English by default.
- If the user explicitly asks to keep the output in Ukrainian (e.g. 'keep in Ukrainian', 'залиш українською', 'не перекладай', 'output in Ukrainian'), produce the log in Ukrainian instead. In that case, translate any English fragments in the input to Ukrainian for consistency. This preference applies only to the current request unless the user says otherwise.
- Never use Russian under any circumstances.
- Use past tense only.
- Each task summary is 1-2 short sentences.
- Use a normal dash `-` instead of an em dash.
- Use straight double quotes `" "` only - do not use curly quotes.
- Replace semicolons with a full stop and start a new sentence.

**Line format**
- Ticket ID comes first on each task line, then time in brackets, then dash, then summary.

**Time**
- STOP AND ASK before drafting any dated log whenever the input gives only a total or an estimate
  that the output shape must SPLIT per day or per task - decide this FIRST, before normalizing any
  other time value, and never invent the split. Reading this clause has not been enough before, so a
  total or estimate in the input is a hard stop, not a note to remember:

  ```ask
  The notes give a total but the log needs per-day times - how should I split it?
  - 'I will give the split (Recommended)' - the log never invents per-day or per-task time
  - 'One line per day, time not specified' - keeps the days, leaves the hours to you
  ```

  A task with no time given at all simply takes `(time not specified)` - the placeholder covers a
  missing figure, the ask covers an invented split.
- Normalize time to `h` for hours and `m` for minutes (e.g. `2h`, `30m`, `1h 30m`).
- Accept Ukrainian variants in input: `г`, `год`, `гг`, `хв`, `хвил` - treat as hours/minutes accordingly.
- Accept decimal hours in input and convert: `0.25h` → `15m`, `0.5h` → `30m`, `0.75h` → `45m`, `1.25h` → `1h 15m`, `2.5h` → `2h 30m`.
- Multi-ticket day granularity: one entry per ticket is not a safe default - mirror the granularity of the user's prior day-entries in the same log, and where no precedent exists, ask:

  ```ask
  Several tickets fall on one day - how should the log list them?
  - 'Merge related tickets into one line (Recommended)' - the wording a per-ticket draft was corrected to before
  - 'One line per ticket' - each ticket keeps its own time and summary
  ```
- Self-check before output: write the drafted task lines of each day to a file inside the session's own scratch directory (never the project tree, never outside it), then run them through this skill's bundled `total-time.js` - resolved from the skill's own folder, never from the session's working directory, where a bare `scripts/` path misses it or runs the project's own file (Node.js built-ins only, nothing to install; run from the project root):

  ```bash
  LINES='<the scratch file holding the drafted task lines>'
  T="${CLAUDE_SKILL_DIR}/scripts/total-time.js"
  [ -f "$T" ] || T=.claude/skills/dev-log-convert/scripts/total-time.js
  node "$T" < "$LINES"
  ```

  Confirm its total equals the printed `Total time`; it reads only the bracketed time after the ticket id (a duration in the summary never counts), normalizes the h/m, Ukrainian and decimal-hour spellings, and counts a `(time not specified)` line as zero. On a mismatch, take the script's total - never print an unverified sum. Where neither path holds the script, re-add the times by hand and say the check was manual.

**Task grouping within a day**
- Keep only the main points - no extra explanations, no step-by-step process.
- Merge or group similar items so each day has only the key tasks.
- If the same ticket appears multiple times in one day, keep separate lines if they represent different work blocks or branches; otherwise merge them and sum the time.
- Pure non-work entries that aren't a ticket and aren't a recurring item (lunch, coffee break): omit entirely. Private life is not in the log.

**Per-input-shape rules** - they fire on the shape of the input, not on every run; apply each before drafting the first day.

- Completion signals:
  - Context says a task was tested or verified but not yet merged: append `Testing.` - only if the summary does not already mention testing or verification.
  - Context says a task is fully done and merged: append `Testing. Merged changes.` - only if the summary does not already mention those actions.
  - Other markers where the input clearly signals the state: `In progress.`, `Created merge request.`, `Code review.` - never invented.
  - Never append a signal that duplicates what the summary already says.
- Implicit investigation:
  - A task completed within the day (a fix applied or a feature fully implemented in that single day) with no mention of investigation, analysis or research opens with `Investigated <brief topic>.` before the fix sentence - a same-day fix began with finding the cause, and the log credits it.
  - Not when the task runs across several days, the summary already opens with an investigation verb, or the input mentions investigation or analysis.
- Edge cases:
  - Relative dates (`today`, `yesterday`, `сьогодні`, `вчора`): resolve to absolute `dd.mm.yyyy` from today's date (Mon-Sun, no weekend skip).
  - Same ticket over several days: a separate line under each day with that day's time only - never summed across days.
  - A ticket's FIRST day-entry in a split (no earlier entry for it anywhere in this log) opens with a start verb (`Started`, `Investigated`, `Worked on`), never `Continued` - `Continued` is only for a later day of the same split.
  - A day with no work (vacation, sick leave, public holiday): the day header, then a single line `Off (<reason>).`, no `Total time`.
  - A task with no action verb: prefix `Worked on` (English) or `Працював над` (Ukrainian).
  - Time mismatch (bullets sum to a different total than the input states): trust the bullets and recompute `Total time` from them - never echo the input's total.

**Multiple days**
- If input contains multiple days, output each day as a separate section in the same response.
- Each day's section title carries that day's own resolved date - the today's-date title rule applies to single-day input only.
- If a day of week is not provided, write `Day not specified`.

## When the raw material is a repo, not notes

Some runs arrive with no notes - 'write the log for what I did this week', or an effort estimate -
and the work has to be read off the repository. Three rules:

- **The opening survey is ONE capped pass, run as a single literal command block before any
  per-file diff** - prose order gets reordered, a command block does not:
  ```
  git status --short
  git stash list
  git branch --show-current
  git diff <base>...HEAD --stat
  ```
  A full diff is read per file off that `--stat`, never as one uncapped dump. `git stash list` is
  in the survey because an estimate built from the diff and the working tree alone misses stashed
  scope.
- **The ticket id, when the notes name none, comes from that survey's `git branch --show-current`
  output or a commit trailer (`git log -1 --format=%s`) - never from comment or code text inside
  the diff**, where an id on a REMOVED line can pass for the real one.
- **A SECOND correction on the same axis is an ask, not a third redraft.** When two consecutive
  free-text corrections land on one axis - granularity, the time split, wording - stop regenerating
  and put that axis through ONE AskUserQuestion carrying the options the two corrections imply.

## Style guidance

Open each summary with a past-tense verb, and render recurring non-ticket items (standups, weekly calls, merge request review - always `Other`) in a consistent canonical form matched to the input phrasing. The preferred verb openers and the canonical-form patterns: `references/style-guidance.md`.

## Examples

### Example 1 - single prefix, Ukrainian input

Input:
> Понеділок: ABC-1319 - 2г досліджував проблему з ротацією культур по ID поля, виправив обробку відсутніх записів, протестував. ABC-1320 - 30хв створив merge request. Нарада з командою - 1г.

Output:
```
Log of work 13.04.2026.

Monday:
1 ABC-1319 (2h) - Investigated a crop rotation issue by field ID. Fixed missing record handling. Testing.
2 ABC-1320 (30m) - Created a merge request.
3 Other (1h) - Attended team meeting.
Total time: 3h 30m.
```

More worked examples - a multi-prefix day grouped by ticket prefix, and a multi-project day with explicit labels: `references/examples.md`.

## Output presentation

Always wrap the final log in a fenced code block (triple backticks, no language tag). This ensures formatting markup is visible and a copy button appears in the UI.
