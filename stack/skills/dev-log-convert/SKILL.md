---
name: dev-log-convert
description: "Converts a day's raw work notes (Ukrainian, English, or mixed) into a structured, past-tense English work log - ticket IDs normalized, time totalled, tasks grouped by project or prefix across one or more days. Fires only on the exact keyword 'dev-log' - do not use it for general note-taking, meeting minutes, commit messages, or status updates, which are not this format."
---

You will receive text (Ukrainian, English, or mixed) describing work done during one or more days. Convert it into a concise English work log written in past tense.

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
- STOP AND ASK (AskUserQuestion) before drafting any dated log whenever the input gives only a
  total or an estimate that the output shape must SPLIT per day or per task - decide this FIRST,
  before normalizing any other time value, and never invent the split. This clause has already
  failed once loaded in context (measured: an unasked 8h/8h/5h+3h/8h split cost four correction
  round-trips; separately, a 12h estimate loaded 39s earlier was still collapsed into an unasked
  9h/2h/1h split) - reading it is not doing it, so treat a total/estimate in the input as a hard
  stop, not a note to remember. A task with no time given at all simply takes
  `(time not specified)` - the placeholder covers a missing figure, the ask covers an invented split.
- Normalize time to `h` for hours and `m` for minutes (e.g. `2h`, `30m`, `1h 30m`).
- Accept Ukrainian variants in input: `г`, `год`, `гг`, `хв`, `хвил` - treat as hours/minutes accordingly.
- Accept decimal hours in input and convert: `0.25h` → `15m`, `0.5h` → `30m`, `0.75h` → `45m`, `1.25h` → `1h 15m`, `2.5h` → `2h 30m`.
- If time is not provided for a task, write `(time not specified)`.
- Multi-ticket day granularity: one entry per ticket is not a safe default - mirror the granularity of the user's prior day-entries in the same log, and where no precedent exists, ask via AskUserQuestion (measured: a two-ticket day drafted per-ticket was rejected for merged wording).
- Self-check before output: write the drafted task lines of each day to a file inside the session's own scratch directory (never the project tree, never outside it), then run them through `scripts/total-time.js` (`node scripts/total-time.js < <that file>` - Node.js built-ins only, nothing to install) and confirm its total equals the printed `Total time`; it normalizes the h/m, Ukrainian and decimal-hour spellings and counts a `(time not specified)` line as zero. On a mismatch, take the script's total - never print an unverified sum. Where the script cannot be run, re-add the times by hand and say the check was manual.

**Task grouping within a day**
- Keep only the main points - no extra explanations, no step-by-step process.
- Merge or group similar items so each day has only the key tasks.
- If the same ticket appears multiple times in one day, keep separate lines if they represent different work blocks or branches; otherwise merge them and sum the time.
- Pure non-work entries that aren't a ticket and aren't a recurring item (lunch, coffee break): omit entirely. Private life is not in the log.
- Before drafting the first day, read `references/edge-cases.md` - the completion signals, the implicit-investigation sentence, and the edge cases (relative dates, a ticket spanning days, a day off, a time mismatch). They fire on the shape of the input, so a run that skips them drafts the wrong shape and gets corrected.

**Multiple days**
- If input contains multiple days, output each day as a separate section in the same response.
- Each day's section title carries that day's own resolved date - the today's-date title rule applies to single-day input only.
- If a day of week is not provided, write `Day not specified`.

## When the raw material is a repo, not notes

A log read off the repository instead of notes follows three measured rules - one capped survey command block first, then the diffs. Read `references/repo-as-source.md` before the first git command.

## Style guidance

Open each summary with a past-tense verb, and render recurring non-ticket items (standups, weekly calls, merge request review - always `Other`) in a consistent canonical form matched to the input phrasing. The preferred verb openers and the canonical-form patterns: `references/style-guidance.md`.

## Examples

Three worked inputs and their logs - a single-prefix Ukrainian day, a mixed-language multi-prefix day, a project-labelled day - are `references/examples.md`; read the one matching the input's shape before the first log of a session.

## Output presentation

Always wrap the final log in a fenced code block (triple backticks, no language tag). This ensures formatting markup is visible and a copy button appears in the UI.
