'use strict';
// Group H - the PF1 trio flow end to end (3.12 clean release, 2026-11-14): a single-stack trio over the designer-seat
// fixture's .NET worker, graded on the orchestrator's plan-status trace (domain-trio-protocol's plan-record section).
// The offline proof that each fixture step passes a trace that keeps it and fails one that breaks it, before the billed
// run. Its fixture ships or leaves with the run's verdict: 'task-solve-cross-trio'.
const test = require('node:test');
const assert = require('node:assert');
const sc = require('./skill-comply.js');

let seq = 0;
const tool = (name, input) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'tool_use', id: `t${seq}`, name, input }] } });
// A guard's denial: the call never ran. (A shell exit status is a call that ran - the grader's own rule.)
const denied = (row) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: row.message.content[0].id, is_error: true, content: 'blocked' }] } });
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const failing = (r) => r.steps.filter((s) => s.verdict === 'FAIL').map((s) => s.id);
const PS = 'node .claude/hooks/plan-status.js';
const PLAN = '.alfred/docs/work/plans/order-export';

// One trio run: designer, approve, start/done per task, show --full, the verifier with the build record, complete.
function trioRun(opts = {})
{
    const rows = [tool('Agent', { subagent_type: 'console-solution-designer', prompt: 'Design the order export card.' })];
    rows.push(tool('Bash', { command: `${PS} sync --plan order-export` }));
    const approve = tool('Bash', { command: `${PS} approve --plan order-export --by user` });
    const start = tool('Bash', { command: `${PS} start --plan order-export --task T1` });
    if (opts.startFirst) rows.push(start, approve); else rows.push(approve, start);
    if (opts.approveDenied) rows.push(denied(approve));
    rows.push(tool('Agent', { subagent_type: 'console-implementer', prompt: 'Build T1.' }));
    if (!opts.noDone) rows.push(tool('Bash', { command: `${PS} done --plan order-export --task T1 --result "dotnet test: 4 passed"` }));
    if (opts.handEdit) rows.push(tool('Write', { file_path: `${PLAN}/status.json`, content: '{}' }));
    const show = tool('Bash', { command: `${PS} show --plan order-export --full` });
    const verifier = tool('Agent', { subagent_type: 'console-verifier', prompt: `Verify the order export.\n\n${opts.noRecord ? '' : '## Build record\n\nT1 done: dotnet test: 4 passed'}` });
    if (opts.showAfter) rows.push(verifier, show); else rows.push(show, verifier);
    if (!opts.noComplete) rows.push(tool('Bash', { command: `${PS} complete --plan order-export --suite "dotnet test: 9 passed"` }));
    return jsonl(rows);
}

test('group H fixture: each trio step passes its canned pass trace and fails only on its canned fail trace', () =>
{
    const trio = sc.loadExpectation('task-solve-cross-trio').data;
    assert.deepStrictEqual(failing(sc.grade(trio, trioRun(), { level: 'plain' })), []);
    assert.deepStrictEqual(failing(sc.grade(trio, trioRun({ startFirst: true }), { level: 'plain' })), ['approve-before-first-start']);
    assert.deepStrictEqual(failing(sc.grade(trio, trioRun({ approveDenied: true }), { level: 'plain' })), ['approve-before-first-start']);
    assert.deepStrictEqual(failing(sc.grade(trio, trioRun({ noDone: true }), { level: 'plain' })), ['tasks-ticked-through-plan-status']);
    assert.deepStrictEqual(failing(sc.grade(trio, trioRun({ showAfter: true }), { level: 'plain' })), ['verifier-gets-build-record']);
    assert.deepStrictEqual(failing(sc.grade(trio, trioRun({ noRecord: true }), { level: 'plain' })), ['verifier-gets-build-record']);
    assert.deepStrictEqual(failing(sc.grade(trio, trioRun({ noComplete: true }), { level: 'plain' })), ['run-closes-with-complete']);
    assert.deepStrictEqual(failing(sc.grade(trio, trioRun({ handEdit: true }), { level: 'plain' })), ['status-json-never-edited']);
});
