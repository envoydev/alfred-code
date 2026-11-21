# Data-class guard - replay evidence

Date: 2026-11-21. Claude Code 2.1.330. Counts only: no sample, no query text, no path and no name is kept here, because the repo is public. The samples went to the session scratchpad and stay there.

## Command

```bash
node scripts/guard-data-class-replay.js --root ~/.claude/projects --samples <scratchpad>/data-class-samples.txt
```

Run time: about 3 s over 1.0 GB of local transcripts. The replay feeds each unique tool call (by its `tool_use` id) through the guard's own judges: a `Read` through the dump and document judges, a `WebSearch`, a `WebFetch` and a context7 call through the outside-query judge. A query is judged against its row's recorded folder when that folder still exists, else by code shape alone.

## Counts

```json
{"transcripts":641,"reads":3097,"asks":{"dump-size":0,"dump-name":0,"dump-pii":0,"document-untracked":0,"document-listed":0},"queries":{"WebSearch":4,"WebFetch":292,"mcp":2},"denies":0,"judgedWithRepo":297,"judgedShapeOnly":1,"unjudged":0}
```

The unique-call counts match an independent count of the same transcripts (Read 3,097; WebFetch 292; context7 2; WebSearch 4).

## Bars

- Asks under 1 in 200 Reads: met. 0 asks over 3,097 Reads, so the bar allows up to 15.
- The sample of denies holds no plain public query: met. There were 0 denies, so the sample is empty. Not shown by this corpus: that a public query is passed where project code is present, because the local corpus holds 4 WebSearch calls and no deny. The unit tests (`scripts/guard-data-class.test.js`) and the replay's own test (`scripts/guard-data-class-replay.test.js`) cover that case with synthetic input.
- A `getServerSideProps` question passes: met, by `scripts/guard-data-class-replay.test.js` (a repo declaring it, a query naming it, no deny) and by `PUBLIC_NAMES`.
- Failed or timed-out git calls: 0 (`unjudged`).

## Limits

- `document-listed` is always 0 here: the replay does not read a project's `.alfred/.sensitive-paths`.
- A transcript holds only what a session called. A corpus with more outside queries is a stronger test; rerun the command as it grows.
