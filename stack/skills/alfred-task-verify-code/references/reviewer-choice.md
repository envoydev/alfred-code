# Which reviewer - this skill, the seat, or /code-review

Read when choosing between the inline review and the verifier seat is not obvious.

## The choice this skill is

The flow's two house reviewers, pick by whether you want dispatch:

- **This skill (inline)** - deterministic cost, zero agents, the whole review stays in one context. Best when you want a predictable spend and no fan-out. The cost: its reads and build land in THIS chat's context, so in a long session that context carries forward - the price of no dispatch.
- **The `<stack>-verifier` seat** (dispatch it) - the same protocol in an isolated subagent, so its read volume never touches your chat, on its frontmatter model unless you name one. Best when the session is already long and you want the review's noise offloaded.

Both are the house review protocol; this skill just keeps it in your chat. `/code-review` (the CLI's broad parallel-angle sweep) is no longer a flow default - it always fans out and the stack can't tune it - but it stays available if you invoke it yourself for extra breadth.

## When not

- Not the plan audit - that is `alfred-task-verify-plan`, on the page before any code. This is after the build.
- Not for fixing what it finds - it flags and hands back (to `alfred-task-implement` or your own edit); a verifier authors nothing.
- Not the parallel-angle sweep - if you want breadth or an isolated subagent, use `/code-review` or dispatch the `<stack>-verifier`. This one stays inline by design.
