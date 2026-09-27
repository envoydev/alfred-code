---
paths: ["**/*.cs"]
---

Editing C# - the FIRST action after this rule attaches is the `csharp` Skill call, before the NEXT
edit lands (a path-scoped rule attaches ON the touch, so it can never precede its own trigger -
measured 9.9-22 s late; and a run working through the shell gets no attach at all until it uses a
file tool, which is why `guard-read-whole-file.js` names this rule on the first shell write) - even
when the `.cs` touch is incidental to the session's main thread (measured: two sessions edited `.cs`
files with this rule attached and never loaded it; the sessions whose focus WAS the C# work loaded it
on cue). Name the skill you loaded, or say it was already in context - the receipt is what makes the
load happen.

Where a FRAMEWORK or SURFACE rule attached on the same touch, its skill loads in that SAME first
action, on top of this baseline, and that rule's list is the authority on what to load - one first
action, not two competing ones (a WinForms `*Form.cs` edit is the case that collides here).

Skip the load only when it is already in context this session (some seats preload it) - a compaction
carries a loaded skill forward only within a shared budget (the oldest dropped, a long one cut
short), so the exemption ends at the next compaction and the load is owed again
(measured: 23 `.cs` edits across two post-compaction tails with zero loads, the plan claiming the
skill was 'loaded earlier this session'); conventions are the source of truth, not recall. Writing or
changing a TEST file loads `dotnet-testing` in the same action (measured: new test methods shipped
with no testing skill loaded).

This is the C# baseline for every `.cs` file, backend or desktop - a WPF view-model is still C#, so it
loads here too, while WPF's .xaml view layer is governed separately. Skip one-line tweaks.

On C# pass `depth: 2` to `get_symbols_overview` - the default stops at the file's top-level symbol,
in C# the NAMESPACE, so it returns only the namespace name. 2 reaches type members (names only -
stays cheap); nested-type members need one more; a top-level-statements file returns `{}` at any
depth.
