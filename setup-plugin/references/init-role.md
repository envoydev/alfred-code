# /alfred-code:init - the project's role

Read by section 1's detection call, beside `workspace.js role --root . --when init`, which prints `role: <current>`, a
`why:` line when a folder above cannot take this project, and one `ask: <label><TAB><answer>` line per option,
Recommended first. Ask it in its own AskUserQuestion call before screen A: a child's answer changes screen A's scope
ask, so the two cannot share a call. `role: workspace off` (`ALFRED_CODE_WORKSPACE=0`) prints no `ask:` line: install
standalone, ask nothing, write nothing.

```ask
What is this project's role? <the why: line, when there is one>
- '<the first ask: label up to its mark> (Recommended)' - <its words below>
- '<each next ask: label>' - <its words below>
```

The labels are the `ask:` lines' as printed, in their order. The words: Child of `<rel>` - takes that install's set and
values and adds its own picks; Standalone - an install of its own, asked again only when the folders around it change;
Root - an install of its own that projects below can join. Unattended, take the first.

- **Child of `<rel>`** - read `${CLAUDE_PLUGIN_ROOT}/setup-plugin/references/init-child.md` now: the child install's
  changes to every step, its scope ask among them. Its join runs `role --answer child` before the install call.
- **Standalone** or **Root** - every step runs as `init-install.md` writes it. In the call before the install (step 10),
  run `node "$TMP/repo/scripts/workspace.js" role --root . --answer <standalone|root>`, with `--data-path <folder>`
  when screen B's data question took a folder other than `.alfred`, so the answer lands in this project's data root.
  A `!!` line it prints is pasted and the install goes on: the role is asked again at configure.
