'use strict';
// The run-dir gate reads a call that opens with `cd . && ` and/or the run dir's own tokens (`TMP=<dir>;`) as the literal call.
const test = require('node:test');
const assert = require('node:assert/strict');
const { approvesForms } = require('./run-dir-gate/forms.js');
const { decide } = require('./run-dir-gate/verdict.js');
const { D, MARKER, shippedCtx, winShipped, WIN_RUN, ctx, own, foreign } = require('./run-dir-gate-fixture.js');

const OTHER = '/t/alfred-code.Other1';
const LIVE_TAIL = 'node "$TMP/repo/scripts/update-preflight.js" --snapshot "$TMP/repo" --root . ; node "$TMP/repo/scripts/install/release-notes.js" --root . ; node "$TMP/repo/scripts/workspace.js" plan --root . --rescan --source "$TMP/repo" > "$TMP/plan.txt" ; grep -E \'^workspace-plan: ([2-9]|[0-9]{2,}) |^gone: |^rescan: |^nested: \' "$TMP/plan.txt" && cat "$TMP/plan.txt" "$TMP/repo/setup-plugin/references/update-workspace.md"';
const literal = (tail) => tail.replaceAll('$TMP', D);
const STAMP = 'node "$TMP/repo/scripts/install/stamp.js" state .';
const REMOVAL = 'r' + 'm -rf';

test('the live update call that sets TMP first is read as its literal form, which the gate allows', () =>
{
    assert.equal(approvesForms(literal(LIVE_TAIL), shippedCtx), true, 'the literal form is allowed');
    assert.equal(approvesForms(`cd . && TMP=${D}; ${LIVE_TAIL}`, shippedCtx), true);
});

test('a call may open with `cd . && ` and a leading run of TMP, TMP_WIN and MARK assignments, bare or double-quoted, joined by ; or &&', () =>
{
    const allowed = [
        `TMP=${D}; ${STAMP}`,
        `TMP="${D}"; ${STAMP}`,
        `TMP=${D} && ${STAMP}`,
        `cd . && TMP=${D}; ${STAMP}`,
        `cd . && ${literal(STAMP)}`,
        `TMP=${D}; TMP_WIN=${D}; MARK=${MARKER}; ${STAMP}`,
        `TMP=${D}; TMP_WIN="${D}" && MARK="${MARKER}"; ${STAMP}`,
        `TMP=${D}; node "\${TMP}/repo/scripts/install/stamp.js" state .`,
        `TMP=${D}; cat "$TMP/repo/scripts/x.js" "\${TMP}/o.json"`,
        `TMP=${D}; ${STAMP} > "$TMP/o.json"`,
        `TMP=${D}; ${STAMP} ; echo "install exit: $?"`,
    ];
    for (const form of allowed) assert.equal(approvesForms(form, ctx), true, form);
    assert.equal(approvesForms(`TMP=${D}; printf '%s\\n' "$TMP" > "$MARK"`, ctx), false, 'the substituted text still goes through the existing forms');
});

test('a call that sets anything else, sets it late, or sets a value that is not the run dir\'s own stays silent', () =>
{
    const refused = [
        `FOO=x; ${literal(STAMP)}`,
        `TMPDIR=${D}; ${STAMP}`,
        `export TMP=${D}; ${STAMP}`,
        `local TMP=${D}; ${STAMP}`,
        `declare TMP=${D}; ${STAMP}`,
        `${literal(STAMP)} ; TMP=${D}; ${STAMP}`,
        `TMP=${D}; FOO=x; ${STAMP}`,
        `TMP=${OTHER}; ${STAMP}`,
        `TMP=/p; ${STAMP}`,
        `TMP=${D}/repo; ${STAMP}`,
        `TMP=$HOME; ${STAMP}`,
        `TMP="${D}$X"; ${STAMP}`,
        `TMP=\`id\`; ${STAMP}`,
        `TMP=$(id); ${STAMP}`,
        `TMP="${D}\\"; ${STAMP}`,
        `TMP='${D}'; ${STAMP}`,
        `TMP=${D}; TMP=${D}; ${STAMP}`,
        `TMP=${D}; TMP="${D}"; ${STAMP}`,
        `TMP=${D}; node "$TMPX/repo/scripts/install/stamp.js" state .`,
        `TMP=${D}; node "$OTHER/repo/scripts/install/stamp.js" state .`,
        `TMP=${D}; node "\${TMP:-x}/repo/scripts/install/stamp.js" state .`,
        `TMP=${D}; node "\${TMP%/*}/repo/scripts/install/stamp.js" state .`,
        `TMP=${D}; node "$TMP_WIN/repo/scripts/install/stamp.js" state .`,
        `TMP=${D}; node "$MARK" state .`,
        `TMP=${D}; node '$TMP/repo/scripts/install/stamp.js' state .`,
        `TMP=${D}; node "\\$TMP/repo/scripts/install/stamp.js" state .`,
        `TMP=${D}; node "$(echo $TMP)/repo/scripts/install/stamp.js" state .`,
        `MARK=${OTHER}/m; cat "$MARK"`,
        `MARK=/p/.marker; ${STAMP}`,
        `TMP=${D} ${STAMP}`,
        `TMP=${D};`,
        `TMP=${D}`,
        `cd .. && TMP=${D}; ${STAMP}`,
        `cd ./sub && TMP=${D}; ${STAMP}`,
        `cd . ; TMP=${D}; ${STAMP}`,
        `TMP=${D}; cd . && ${STAMP}`,
        `TMP=${D}; ${STAMP}; ${REMOVAL} "$TMP"`,
        `TMP=${D}; node "$TMP/repo/scripts/install/nope.js" state .`,
        `TMP=${D}; ${STAMP} ; echo "$?"`,
        `TMP=${D}; ${STAMP} "$?"`,
    ];
    for (const form of refused) assert.equal(approvesForms(form, ctx), false, form);
});

test('TMP_WIN is the run dir in its Windows spelling, and the values on Windows compare the way the run-dir check does', () =>
{
    const stamp = (variable) => `node "$${variable}\\repo\\scripts\\install\\stamp.js" state .`;
    assert.equal(approvesForms(`TMP="${WIN_RUN}"; TMP_WIN="${WIN_RUN}"; node "$TMP/repo/scripts/install/stamp.js" state .`, winShipped), true);
    assert.equal(approvesForms(`TMP=/c/Temp/alfred-code.AbC123; node "$TMP/repo/scripts/install/stamp.js" state .`, winShipped), true, 'the MSYS spelling');
    assert.equal(approvesForms(`TMP_WIN="${WIN_RUN}"; ${stamp('TMP_WIN')}`, winShipped), true);
    assert.equal(approvesForms(`TMP=${WIN_RUN}; node "$TMP/repo/scripts/install/stamp.js" state .`, winShipped), false, 'a bare value with backslashes is no value');
    assert.equal(approvesForms(`TMP_WIN="C:\\Temp\\alfred-code.Other1"; ${stamp('TMP_WIN')}`, winShipped), false);
    assert.equal(approvesForms(`TMP_WIN="C:\\Temp\\alfred-code.AbC123\\repo"; ${stamp('TMP_WIN')}`, winShipped), false);
    assert.equal(approvesForms(`TMP_WIN=C:Temp; ${stamp('TMP_WIN')}`, winShipped), false);
});

test('decide denies a run dir the marker does not name, whether the call spells it literally or sets it first', () =>
{
    const marker = { path: MARKER, dir: D, session: 's1', owned: true };
    const base = { table: { resolves: [], scripts: {} }, sessionId: 's1', marker, ctx };
    const literalForm = `${REMOVAL} "${OTHER}"`;
    const assigned = `TMP=${OTHER}; ${REMOVAL} "$TMP"`;
    for (const command of [literalForm, assigned, `cd . && TMP=${OTHER}; node "$TMP/repo/scripts/install/stamp.js" state .`]) assert.equal(decide({ ...base, command, dirs: [foreign] }).decision, 'deny', command);
    const allowed = `cd . && TMP=${D}; node "$TMP/repo/scripts/install/stamp.js" state .`;
    assert.deepEqual(decide({ ...base, command: allowed, dirs: [own] }), { decision: 'allow' });
    assert.deepEqual(decide({ ...base, command: `TMP=${D}; ${STAMP}; ${REMOVAL} "$TMP"`, dirs: [own] }), { decision: null });
});
