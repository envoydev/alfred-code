# /alfred-code:init - screen B's second call

Read by the install phase right before screen B's second AskUserQuestion call. The tool takes four questions a call,
so screen B goes in calls of at most four, in the catalog's order: the first four `ask: true` rows of
`$TMP/repo/meta/environment.json` (a row with `asked_with` rides its owner's question) in the first call, every asked
row past them here. Every rule of screen B in `init-install.md` holds in this call too - the default shown, the value
the target settings file already carries offered first, a credential never printed - and the answers join the same
environment merge.

`ALFRED_CODE_MAXIMUM_RUN_AGENTS` - how many of a session's agents may run at once - is asked in this shape:

```ask
How many of a session's agents may run at once?
- '5 (Recommended)' - the default: a fan-out of five seats, the rest as each hands back
- 'No cap (0)' - every dispatch runs at once
```

Other takes a whole number from 0 to 50. An asked row with no template here is asked from its `default` and `what`, in
plain words, the way screen B's first call asks one.
