# When the raw material is a repo, not notes

Read before the first git command when the log has to be read off a repository instead of notes - a week's log with no notes, or an effort estimate.

## When the raw material is a repo, not notes

Some runs arrive with no notes - 'write the log for what I did this week', or an effort estimate -
and the work has to be read off the repository. Three rules, each from a measured miss:

- **The opening survey is ONE capped pass, run as a single literal command block before any
  per-file diff** - prose order gets reordered, a command block does not (measured: a run read 5
  per-file diffs before its first `git status`/`git stash list`, despite the skill's own 'come
  first' text already loaded):
  ```
  git status --short
  git stash list
  git branch --show-current
  git diff <base>...HEAD --stat
  ```
  A full diff is read per file off that `--stat`, never as one uncapped dump. Measured: two
  uncapped `git diff HEAD` calls cost 10.3k tokens for an estimate a capped survey answered for
  ~4.3k in a sibling session, same repo, same task shape. `git stash list` is part of this survey
  for the same reason: a change analysis and effort estimate built from the diff and working tree
  alone was WRONG on scope until the user asked about the stash, and the recovery diffs cost ~9.8k.
- **The ticket id, when the notes name none, comes from that survey's `git branch --show-current`
  output or a commit trailer (`git log -1 --format=%s`) - never from comment or code text inside
  the diff.** Measured: a delivered log and commit message cited an id that occurred only on lines
  the diff REMOVED, while the real id sat one command away in the branch name.
- **A SECOND correction on the same axis is an ask, not a third redraft.** When two consecutive
  free-text corrections land on one axis - granularity, the time split, wording - stop regenerating
  and put that axis through ONE AskUserQuestion carrying the options the two corrections imply.
  Measured: two corrections on one axis were each answered with a fresh regeneration.
