---
name: alfred-habits-skill-writing
description: "Use when writing, changing or reviewing a skill - its SKILL.md, description or frontmatter, or a file under its references/ folder - or when deciding whether a piece of guidance belongs in a skill at all rather than a rule, a hook or a reference. Not for a plugin's manifest, packaging or marketplace entry, and not for a project's CLAUDE.md."
---

# Skill writing - a trigger that fires, a body that changes the run, proof on both sides

A skill is judgment loaded on demand: the model sees its description on every turn and reads its
body only once the description says the moment has come. So a skill earns its place twice - a
description that fires on the right requests and stays quiet on the rest, and a body that makes the
run do what it would have got wrong without it. Miss the first and the body never loads; miss the
second and every session pays for a description that changes nothing.

## Is it a skill at all

Pick the home before writing a word:

- **A check a script can decide** (a file present, a pattern in a diff, an exit code) - a hook or a
  lint. The model may skip prose; nobody skips a gate.
- **A convention tied to a file type** - a path-scoped rule whose one job is to load the skill that
  holds the convention, attached when a matching file is touched.
- **Something every session needs from its first message** - an always-on rule, its size charged to
  every message of every session.
- **A long lookup one step consults** (an API table, a catalog of error signatures) - a file under
  the skill's `references/`, named at the step that reads it.
- **A judgment call keyed to a situation** - a skill.
- **How one bug was fixed once, or a fact about one project** - no skill: the project's docs or its
  memory.

## The description is the trigger

The body stays unread until the description earns the load, and the description is paid for on
every message whether it fires or not.

- Start on `Use when`, then the situation, in the words a request or a file would carry: the file
  types, tool names, error text and synonyms a user actually types.
- Close with `Not for` and the nearest neighbours that must stay quiet, each with where it goes
  instead - this is the clause that keeps a near-miss from loading the wrong skill.
- List what it covers as keywords, never its steps in order: a description that retells the
  procedure gets obeyed in place of the body, and whatever it left out is skipped.
- Third person throughout; as short as the triggers allow, and under the harness's per-entry cap.
- A skill that needs the user to name it before it loads has a broken description - repair the
  description, not the body.

## One home per piece

- Every rule, step and fact lives in one file; anything else that needs it points there. A second
  copy drifts, and within a release the two disagree.
- Name another skill only where it is guaranteed to sit beside the citer - preloaded by the same
  seat, shipped in the same package, or part of the always-installed set. Anywhere else, describe
  what it covers ('the skill covering the ORM, where the project has one'), so an absent skill costs
  nothing and a present one is still found.
- Point with a load directive at the step that needs the other skill, never a 'see also' list at the
  end.

## The body

- Lean: every line is paid for when the skill loads. Write for a capable model - state the decision
  it would get wrong, never what it already knows.
- Steps that must happen in order are numbered and imperative; the rest is bullets.
- Platform-neutral: no tool, path or command of one harness as the only way. Where harnesses differ,
  a condition says which branch applies ('inline when no dispatch is available').
- Detail that one step needs goes under `references/`, directly beneath the skill folder, read when
  that step names it. A reference longer than about a hundred lines opens with its own contents list.
- Choose the shape by the failure you saw:
  - skipped under pressure though the model knew better - a hard rule, the excuses it answers, and
    the signs it was skipped;
  - the right action with output in the wrong shape - a recipe that lays that shape out part by
    part, instead of a list of don'ts;
  - a required part left out - a slot for it in the template being filled;
  - behavior that hinges on a condition - the condition, stated as something the run can observe.

  A real exception gets a condition of its own; a hedge tacked on the end ('unless it matters') puts
  the whole rule back up for negotiation.
- One worked example in the project's own language beats several, and none is lifted from the
  session that wrote the skill.
- A script the skill runs is started through its interpreter (`node tool.js`), never as a bare
  path - an executable bit does not survive every packager.

## Prove it before shipping

A skill is code the model runs, so its test comes first and is seen to fail - the loop
`alfred-habits-test-first` runs for code, applied to prose:

1. **Baseline WITHOUT the skill.** Give a fresh context a realistic task that invites the failure,
   and record what it did and the reasons it gave. No failure seen means nothing to write - stop.
2. **Write the least that answers those failures** - nothing for a case the baseline never showed.
3. **The same task WITH it.** The failure is gone, and nothing else got worse.
4. **The adverse phrasing.** The same task plus pressure against the discipline - a deadline, 'just
   do it', work already sunk - and no explicit waiver. The discipline holds.
5. **The plain phrasing.** The task in the user's words, the skill unnamed. The description fires
   on its own.
6. **A new excuse** seen in any run is answered in the body, and the runs go again. One sample per
   arm proves little: run several, and read every hit a grader counts before trusting its number.

Where the project keeps a step grader - fixtures replayed at explicit, plain and adverse prompt
levels, a before arm compared with an after arm (a skill-comply harness) - add the new skill's steps
to it, and ship only when the after arm is no worse on any step. A replay through a nested session
is billed: the user says go first.

An edit to an existing skill is proven the same way. A change nobody saw alter a run is not known
to help.

## Signs it was skipped

- A skill shipped with no run seen failing without it.
- A description that retells the steps, or never says what must stay quiet.
- The same rule restated in a second file.
- A skill named by a citer it is not guaranteed beside.
- A table in the body that only one step reads.
