'use strict';
// Group B of the 2026-11-04 prose A/B round - task-design and the designer seats: CAP-2 (step 4's cited-source and
// parallel-ownership rules moved to references/design-rules.md) and ab-Q2 (the designers' preference-id sentence). The
// prose pins, and the offline proof that each new fixture step passes a trace that keeps it and fails one that breaks
// it, before any billed run. Its fixtures ship or leave with the group's verdict: 'task-design-cited-card',
// 'designer-seat-decisions'.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const sc = require('./skill-comply.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (s) => String(s).replace(/\s+/g, ' ');
const body = (text) => String(text).replace(/^---\n[\s\S]*?\n---\n/, '');
const DESIGN = 'stack/skills/task-design/SKILL.md';
const RULES = 'stack/skills/task-design/references/design-rules.md';
const CITED = 'When the ask cites a spec row, a card or a spec file, that source is requirement too: every clause of a cited row and every Verify or Done-when bullet of a cited card maps to a task\'s `test:`, and the close\'s done gate demonstrates them.';
const OWNER = 'Where tasks may build in parallel, give every file two tasks would both edit - the route registry, a root config or DI composition root, a barrel or shared index - exactly one owning task, and forbid the rest from touching it.';
const OLD_Q2 = 'each `## Decisions` row names the preference id it meets';
const NEW_Q2 = 'each `## Decisions` row a preference decides names that preference\'s id';
const DESIGNERS = fs.readdirSync(path.join(ROOT, 'stack/agents')).filter((f) => f.endsWith('-solution-designer.md')).map((f) => `stack/agents/${f}`);

let seq = 0;
const tool = (name, input, parent) => ({ type: 'assistant', ...(parent ? { parent_tool_use_id: parent } : {}), message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'tool_use', id: `t${seq}`, name, input }] } });
const say = (text, parent) => ({ type: 'assistant', ...(parent ? { parent_tool_use_id: parent } : {}), message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'text', text }] } });
const user = (text, parent) => ({ type: 'user', ...(parent ? { parent_tool_use_id: parent } : {}), message: { role: 'user', content: text } });
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const expectOf = (name) => sc.loadExpectation(name).data;
const failing = (r) => r.steps.filter((s) => s.verdict === 'FAIL').map((s) => s.id);

test('CAP-2: step 4 points at references/design-rules.md, which holds the cited-source and one-owner rules verbatim', () =>
{
    const skill = flat(body(read(DESIGN)));
    assert.ok(skill.includes('A cited spec row, card or spec file, tasks that may build in parallel, or a bug seen only on the customer\'s side - read `references/design-rules.md` before writing the tasks.'));
    for (const moved of [CITED, OWNER]) assert.ok(!skill.includes(moved), `left SKILL.md: ${moved.slice(0, 40)}`);
    const rules = read(RULES);
    const at = rules.indexOf('\n## Decomposition rules step 4 points to\n');
    assert.ok(at > 0 && at < rules.indexOf('\n## A customer-side bug\n'), 'the new section sits above the customer-side one');
    for (const moved of [CITED, OWNER]) assert.ok(flat(rules).includes(moved), `in design-rules.md: ${moved.slice(0, 40)}`);
    assert.ok(body(read(DESIGN)).length < 11700, 'the body keeps 300 chars of room under its 12,000 cap');
});

test('ab-Q2: the ten designers and their shared-rules markers name the id of the preference that decides a row', () =>
{
    assert.strictEqual(DESIGNERS.length, 10);
    for (const f of DESIGNERS)
    {
        const t = read(f);
        assert.ok(t.includes(NEW_Q2), `${f} carries the new sentence`);
        assert.ok(!t.includes(OLD_Q2), `${f} no longer carries the old one`);
    }
    const shared = read('meta/shared-rules.json');
    assert.strictEqual(shared.split(NEW_Q2).length - 1, 10, 'the owner and nine site markers');
    assert.ok(!shared.includes(OLD_Q2));
});

// --- the offline proof: every new step passes a trace that keeps it and fails one that breaks it -----------------

const PLAN = '/work/project/.alfred/docs/work/plans/order-export.md';
// The output scoring is seeded on: the plan waits as its draft before it reaches work/plans/ (the 2026-11-04 smoke's
// both arms stopped at the fix offer with the plan only there). The cycle's task.md is never the plan.
const DRAFT = '/work/project/.alfred/state/sessions/scoring/s1/order-export/65ca8b67.draft.md';
const TASK = '/work/project/.alfred/state/sessions/scoring/s1/order-export/task.md';
// forbid: the other task's files: line forbids the shared file, as the rule asks and both 2026-11-04 re-run plans wrote
// zeroOrders: the header-row bullet as the empty export's literal ('literal'), or a zero-orders case that names no header ('vague')
function planText({ verify = ['header row', 'doubled', '403'], secondOwner = false, noOwner = false, quoteExample = false, forbid = false, zeroOrders = null } = {})
{
    const lines = [];
    const t1 = [];
    if (zeroOrders === 'literal') t1.push('zero orders -> status 200 and body equals `id,sku,quantity,note\\r\\n` (Verify 1)');
    else if (zeroOrders === 'vague') t1.push('zero orders -> status 200 (Verify 1)');
    else if (verify.includes('header row')) t1.push('an export of zero orders is a header row only');
    if (verify.includes('doubled')) t1.push(quoteExample ? 'a note `say "hi"` exports as `"say ""hi"""`' : 'a quote in a note is doubled');
    if (verify.includes('403')) t1.push('the route answers 403 to a non-admin');
    lines.push('# Order export - plan', '', '## Tasks', '',
        '### Task 1 - the CSV export and both routes', '', '- status: TODO',
        `- files: src/export.js (create)${noOwner ? '' : ', src/routes.js (modify)'}`,
        '- anchors: src/routes.js:routes, src/auth.js:isAdmin',
        `- test: ${t1.join('; ') || 'the export answers text/csv'}`,
        '- acceptance: `npm test` - every test green', '',
        '### Task 2 - the export link handler', '', '- status: TODO',
        `- files: src/export-link.js (create)${secondOwner ? ', src/routes.js (modify)' : ''}${forbid ? `. Must NOT touch ${secondOwner ? 'src/export.js' : 'src/routes.js'}` : ''}`,
        '- traps: src/routes.js is task 1\'s - the link route is registered there, never here',
        '- test: the link answers the export URL', '',
        '## Decisions', '', '- one registry owner - precedent: src/routes.js registers every handler once');
    return lines.join('\n');
}
function designRun(opts = {})
{
    const rows = [user('<command-name>/task-design</command-name>\n<command-args>.alfred/docs/work/cards/order-export.md - design it here in this chat</command-args>'),
        tool('Skill', { skill: 'habits-clarify' }), tool('Read', { file_path: '/work/project/.alfred/docs/work/cards/order-export.md' }),
        tool('Write', { file_path: opts.path || PLAN, content: planText(opts) })];
    if (opts.code) rows.push(tool('Write', { file_path: '/work/project/src/export.js', content: '\'use strict\';\n' }));
    rows.push(say('Plan written - .alfred/docs/work/plans/order-export.md'));
    return jsonl(rows);
}

function report({ a1 = true, invented = false, verify = ['header row', 'doubled', '403'], bold = false, lower = false, stamp = false } = {})
{
    if (stamp) return stampReport({ a1, verify, lower });
    const tests1 = [];
    if (verify.includes('header row')) tests1.push('an export of zero orders is a header row only');
    if (verify.includes('doubled')) tests1.push('a quote in a note is doubled');
    return [
        'Oriented: Program.cs, Api/RouteTable.cs, Orders/IOrderStore.cs read; ARCHITECTURE-PREFERENCES.md read; task-design, dotnet-hosted-services loaded',
        '',
        bold ? '**Decisions**' : '## Decisions',
        '',
        `- the export reads the orders through IOrderStore.All() - ${a1 ? `${lower ? 'a1' : 'A1'} (ARCHITECTURE-PREFERENCES)` : 'precedent: Program.cs registers the store'}`,
        '- the CSV writer is a static helper beside the route - precedent: RouteTable.cs keeps its handlers inline',
        ...(invented ? ['- RFC 4180 quoting for every field - C2'] : []),
        '',
        '## Tasks',
        '',
        '### T1 - the export route, the link route, the admin check',
        '- files: src/OrdersWorker/Api/RouteTable.cs (modify), src/OrdersWorker/Api/OrderCsv.cs (create)',
        `- test: ${tests1.join('; ') || 'the export answers text/csv'}`,
        '- acceptance: `dotnet test` green',
        '',
        '### T2 - the export link handler, after T1',
        '- files: src/OrdersWorker/Api/ExportLink.cs (create)',
        `- test: ${verify.includes('403') ? 'the route answers 403 to a non-admin' : 'the link names the export URL'}`,
        '',
        'user_decisions: none',
        'status: PLAN_READY',
        'contract_version: 1',
    ].join('\n');
}
// The seat's report as the 2026-11-04 smoke's after arm wrote it: numbered bold Decisions rows citing the doc's id
// comment (a1), and tasks stamped acceptance with backticked test names - no test: line at all.
function stampReport({ a1, verify, lower })
{
    const names = [];
    if (verify.includes('header row')) names.push('`An_export_of_zero_orders_is_a_header_row_only`');
    if (verify.includes('doubled')) names.push('`A_quote_in_a_note_is_doubled`');
    if (verify.includes('403')) names.push('`The_route_answers_403_to_a_non_admin`');
    return [
        'Oriented: Program.cs, Api/RouteTable.cs, Orders/IOrderStore.cs read; ARCHITECTURE-PREFERENCES.md read',
        '',
        '## Decisions',
        '',
        '1. **The CSV writer is a static helper beside the route.** Precedent: RouteTable.cs keeps its handlers inline.',
        `2. **The export reads the orders through \`IOrderStore\`.** Precedent: ${a1 ? `${lower ? 'a1' : 'A1'} - the store seam is the one read path` : 'Program.cs registers the store'}.`,
        '',
        '## Tasks',
        '',
        '### T1 - the export route, the link route, the admin check',
        '- files: src/OrdersWorker/Api/RouteTable.cs (modify), src/OrdersWorker/Api/OrderCsv.cs (create)',
        `- acceptance: ${names.join(', ')} green under \`dotnet test\``,
        '',
        'user_decisions: none',
        'status: PLAN_READY',
        'contract_version: 1',
    ].join('\n');
}
function seatRun(opts = {})
{
    const dispatch = tool('Agent', { subagent_type: 'console-solution-designer', description: 'design the export', prompt: 'Brief: .alfred/docs/work/briefs/order-export.md' });
    const id = dispatch.message.content[0].id;
    return jsonl([user('Dispatch the console-solution-designer seat with `.alfred/docs/work/briefs/order-export.md` as its whole brief.'), dispatch,
        user('Brief: .alfred/docs/work/briefs/order-export.md', id),
        tool('Read', { file_path: '/work/project/.alfred/docs/preferences/ARCHITECTURE-PREFERENCES.md' }, id),
        tool('Read', { file_path: '/work/project/.alfred/docs/work/briefs/order-export.md' }, id),
        say(report(opts), id),
        { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'the report' }] } },
        say('The seat returned PLAN_READY; stopping here as asked.'),
        { type: 'result', subtype: 'success', result: 'The seat returned PLAN_READY; stopping here as asked.' }]);
}

test('group B fixtures: each new step passes its canned pass trace and fails only on its canned fail trace', () =>
{
    // verify-mapped and one-owner on the plan file the design writes
    const card = expectOf('task-design-cited-card');
    assert.deepStrictEqual(failing(sc.grade(card, designRun())), []);
    assert.deepStrictEqual(failing(sc.grade(card, designRun({ verify: ['header row', '403'] }))), ['verify-mapped']);
    assert.deepStrictEqual(failing(sc.grade(card, designRun({ secondOwner: true }))), ['one-owner']);
    assert.deepStrictEqual(failing(sc.grade(card, designRun({ noOwner: true }))), ['one-owner']);
    assert.deepStrictEqual(failing(sc.grade(card, designRun({ code: true }))), ['plans-no-code']);
    // the plan held as the output scoring's draft, its doubled bullet written as the example: both plan steps read it
    assert.deepStrictEqual(failing(sc.grade(card, designRun({ path: DRAFT, quoteExample: true }))), []);
    assert.deepStrictEqual(failing(sc.grade(card, designRun({ path: DRAFT, verify: ['header row', '403'] }))), ['verify-mapped']);
    assert.deepStrictEqual(failing(sc.grade(card, designRun({ path: DRAFT, secondOwner: true }))), ['one-owner']);
    // the header-row bullet as the empty export's literal passes; a zero-orders case with no header fails
    assert.deepStrictEqual(failing(sc.grade(card, designRun({ path: DRAFT, zeroOrders: 'literal' }))), []);
    assert.deepStrictEqual(failing(sc.grade(card, designRun({ path: DRAFT, zeroOrders: 'vague' }))), ['verify-mapped']);
    // a files: line that forbids src/routes.js is no second owner; one that lists it ahead of a forbid still is
    assert.deepStrictEqual(failing(sc.grade(card, designRun({ path: DRAFT, forbid: true }))), []);
    assert.deepStrictEqual(failing(sc.grade(card, designRun({ path: DRAFT, forbid: true, secondOwner: true }))), ['one-owner']);
    // the cycle's task.md beside the draft is never the plan
    assert.deepStrictEqual(failing(sc.grade(card, designRun({ path: TASK }))), ['verify-mapped', 'one-owner']);

    // the seat's own report: the dispatcher's rows are not graded
    const seat = expectOf('designer-seat-decisions');
    assert.deepStrictEqual(failing(sc.grade(seat, seatRun())), []);
    assert.deepStrictEqual(failing(sc.grade(seat, seatRun({ bold: true }))), []);
    assert.deepStrictEqual(failing(sc.grade(seat, seatRun({ a1: false }))), ['pref-row-id']);
    assert.deepStrictEqual(failing(sc.grade(seat, seatRun({ invented: true }))), ['no-invented-id']);
    assert.deepStrictEqual(failing(sc.grade(seat, seatRun({ verify: ['header row', 'doubled'] }))), ['verify-mapped']);
    // the doc's id comment spelling (a1), and the acceptance-stamped report with backticked test names
    assert.deepStrictEqual(failing(sc.grade(seat, seatRun({ lower: true }))), []);
    assert.deepStrictEqual(failing(sc.grade(seat, seatRun({ stamp: true, lower: true }))), []);
    assert.deepStrictEqual(failing(sc.grade(seat, seatRun({ stamp: true, a1: false }))), ['pref-row-id']);
    assert.deepStrictEqual(failing(sc.grade(seat, seatRun({ stamp: true, verify: ['header row', 'doubled'] }))), ['verify-mapped']);
    // the T1 / T2 task ids sit under the Tasks heading, outside the Decisions rows, and count for nothing
    assert.ok(/### T1 /.test(report()));
});
