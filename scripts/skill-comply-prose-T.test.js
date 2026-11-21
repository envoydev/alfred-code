'use strict';
// Groups M and T of the 2026-11-21 prose A/B round 2. T: the console designer's trap list is one line per trap under a
// pointer to the preloaded dotnet-hosted-services, and the ten designers no longer restate task-design's lean, Decisions
// and Don't-game-it text. M: the same seat on a Sonnet pin, evidence only, so it pins nothing in a tracked file. The prose
// pins, and the offline proof that each step of the fixture 'designer-worker-traps' passes a trace that keeps it and fails
// one that breaks it, before any billed run.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const sc = require('./skill-comply.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (s) => String(s).replace(/\s+/g, ' ');
const STACKS = ['aspnet', 'browser-extension', 'console', 'data', 'devops', 'ionic-angular', 'web-angular', 'windows-service', 'winforms', 'wpf'];
const designer = (stack) => `stack/agents/${stack}-solution-designer.md`;
const FIXTURE = 'designer-worker-traps';
const TRAP_POINTER = 'Design each out in the seam - the preloaded `dotnet-hosted-services` holds the why and the code shape:';
const DONT_GAME_KEPT = ['data', 'devops', 'winforms', 'wpf'];

// The lines of one `## <name>` section, up to the next `## ` heading.
function sectionLines(text, name)
{
    const lines = text.split('\n');
    const start = lines.findIndex((l) => l === `## ${name}`);
    assert.ok(start >= 0, `a '## ${name}' section`);
    const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
    return lines.slice(start + 1, end < 0 ? lines.length : end).filter((l) => l.trim());
}

test('traps: the console trap list is one line per trap under a pointer to dotnet-hosted-services', () =>
{
    const text = read(designer('console'));
    assert.match(text.match(/^skills:\n((?:  - .+\n)+)/m)[1], /- dotnet-hosted-services\n/, 'the seat preloads the skill the pointer names');
    const [pointer, ...traps] = sectionLines(text, 'Failure modes I hunt');
    assert.strictEqual(pointer, TRAP_POINTER);
    assert.deepStrictEqual(traps.map((l) => l.match(/^- \*\*(.+?)\*\* - /)?.[1]), [
        'Captive dependency', 'Unobserved-exception host death', 'Stopping-token ignored', '`async void` on the gateway',
        'Blocking the event loop / no resilience', 'Unbounded in-memory queue', 'Lifecycle leaks']);
    const body = (name) => traps.find((l) => l.startsWith(`- **${name}**`));
    assert.match(body('Captive dependency'), /`IServiceScopeFactory`/);
    assert.match(body('Unobserved-exception host death'), /BackgroundServiceExceptionBehavior\.StopHost/);
    assert.match(body('Stopping-token ignored'), /`stoppingToken`/);
    assert.match(body('Unbounded in-memory queue'), /bounded `Channel<T>`/);
    for (const name of ['Captive dependency', 'Unobserved-exception host death', 'Stopping-token ignored', '`async void` on the gateway'])
        assert.ok(body(name).length < 230, `${name} is a decision, not an explanation`);
    // the design decisions it points at are in the preloaded skill, and the bounded channel in its reference
    const skill = flat(read('stack/skills/dotnet-hosted-services/SKILL.md'));
    for (const home of ['`IServiceScopeFactory` instead and open a fresh scope per unit of work', '`StopHost`', 'Never `async void` in a worker', 'Check `IsCancellationRequested` in every loop and thread the token into every async call'])
        assert.ok(skill.includes(home), `dotnet-hosted-services holds: ${home}`);
    assert.match(read('stack/skills/dotnet-hosted-services/references/channels.md'), /Channel\.CreateBounded/);
});

test('restate: no designer restates task-design\'s lean, Decisions or Don\'t-game-it text', () =>
{
    const registry = JSON.parse(read('meta/shared-rules.json')).rules['lean-seat-disciplines'];
    for (const stack of STACKS)
    {
        const file = designer(stack);
        const text = read(file);
        const lean = text.split('\n').find((l) => l.startsWith('- Design lean - question the need: build the smallest '));
        assert.ok(lean, `${stack}: the Design lean bullet keeps its opening`);
        assert.doesNotMatch(lean, /Challenge every piece of scope|deletion before addition/, `${stack}: the lean bullet restates task-design's scope challenge`);
        assert.match(lean, /Never trade away .+ to get there\.$/, `${stack}: the lean bullet keeps what is never traded away`);
        assert.match(lean, /prefer the .+ over a (?:new dependency|bespoke script)/, `${stack}: the lean bullet keeps the seat's own native-options clause`);
        assert.doesNotMatch(text, /Each such decision lands in the plan's `## Decisions` ledger/, `${stack}: the clear-brief bullet no longer restates the ledger rule`);
        assert.match(text, /only a user-level requirement bounces back, never a how-to-build decision\.$/m, `${stack}: the clear-brief bullet keeps its bounce rule`);
        assert.ok(text.includes('the `## Decisions` ledger with its precedent line are all the preloaded `task-design` skill - not restated here'), `${stack}: the method bullet still points at task-design for the ledger`);
        assert.strictEqual(text.includes("## Don't game it\n"), DONT_GAME_KEPT.includes(stack), `${stack}: Don't game it is kept only where it holds the seat's own rule`);
        assert.ok(registry.sites.some((site) => site.file === file && text.includes(site.marker)), `${stack}: the registered lean marker stays`);
    }
    // each cut rule's one home
    const design = flat(read('stack/skills/task-design/SKILL.md'));
    assert.ok(design.includes('The smallest plan that meets the requirement - nothing speculative added, nothing required left out.'));
    assert.ok(design.includes('The plan carries a `## Decisions` ledger - one line per call the design made'));
    assert.ok(flat(read('stack/skills/task-design/references/design-rules.md')).includes('exactly one owning task, and forbid the rest from touching it'));
    // the four kept sections hold a rule the generic text did not (the data collision unit, the devops fork, the WinForms and WPF seams)
    const kept = (stack) => flat(sectionLines(read(designer(stack)), "Don't game it").join(' '));
    assert.match(kept('data'), /shared migration chain, model snapshot, or table/);
    assert.match(kept('devops'), /`user_decisions:` line/);
    assert.match(kept('winforms'), /Designer\.cs, or a shared resx/);
    assert.match(kept('wpf'), /composition root or a shared dictionary/);
});

// --- the offline proof: every step passes a trace that keeps it and fails one that breaks it ----------------------

let seq = 0;
const row = (message) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', ...message } });
const mainTool = (name, input) => row({ content: [{ type: 'tool_use', id: `t${seq}`, name, input }] });
const mainSay = (text) => row({ content: [{ type: 'text', text }] });
const seatRow = (r) => ({ ...r, parent_tool_use_id: 'toolu_seat' });
const seatTool = (name, input) => seatRow(mainTool(name, input));
const seatSay = (text) => seatRow(mainSay(text));
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const expectOf = (name) => sc.loadExpectation(name).data;
const failing = (r) => r.steps.filter((s) => s.verdict === 'FAIL').map((s) => s.id);

const DISPATCH = { subagent_type: 'alfred-code:console-solution-designer', prompt: 'Design .alfred/docs/work/briefs/order-inbox.md' };
const DECISIONS = ['## Decisions', '', '- the inbox poller is a `BackgroundService` on a `PeriodicTimer` - precedent: no precedent - the worker has no hosted service yet'];

// The plan as the seat reports it. Every part is a flag so one test turns one part off.
function plan({ scope = true, token = true, bounded = true, owner = 'one', ledger = 'heading', oriented = true, status = true, orientedText = 'Oriented: Program.cs, IOrderStore.cs, SqlOrderStore.cs read; dotnet-hosted-services, task-design loaded' } = {})
{
    const tasks = {
        one: ['### T1 - the host wiring and the poller', '- files: src/Orders.Worker/Program.cs (modify), src/Orders.Worker/InboxPoller.cs (create)', '### T2 - the webhook consumer, after T1',
            '- files: src/Orders.Worker/BillingPublisher.cs (create); NOT src/Orders.Worker/Program.cs - the owner registers it'],
        two: ['### T1 - the poller', '- files: src/Orders.Worker/Program.cs (modify), src/Orders.Worker/InboxPoller.cs (create)', '### T2 - the webhook consumer',
            '- files: src/Orders.Worker/Program.cs (modify), src/Orders.Worker/BillingPublisher.cs (create)'],
        none: ['### T1 - the poller', '- files: src/Orders.Worker/InboxPoller.cs (create)', '### T2 - the webhook consumer', '- files: src/Orders.Worker/BillingPublisher.cs (create)'],
        // smoke fix 5: the files line is a header and each file a nested bullet under it, Program.cs among them
        nested: ['### T0 - frozen seams', '- **implementer_model:** sonnet', '- **Files:**', '  - `src/Orders.Worker/Orders.Worker.csproj`: add the resilience package.',
            '  - `Program.cs`: one added line.', '- **Must not touch:** `SqlOrderStore.cs`.', '### T1 - the poller', '- **Files:** `src/Orders.Worker/InboxPoller.cs` (create)'],
        nestedPath: ['### T0 - frozen seams', '- **Files:**', '  - `src/Orders.Worker/Orders.Worker.csproj`: add the package.', '  - src/Orders.Worker/Program.cs (modify)', '### T1 - the poller',
            '- **Files:** `src/Orders.Worker/InboxPoller.cs` (create)'],
        nestedTwo: ['### T0 - frozen seams', '- **Files:**', '  - `Program.cs`: one added line.', '### T1 - the poller', '- **Files:**', '  - `src/Orders.Worker/InboxPoller.cs` (create)',
            '  - `Program.cs`: register the poller.'],
        nestedForbid: ['### T0 - frozen seams', '- **Files:**', '  - `src/Orders.Worker/Orders.Worker.csproj`: add the package.', '- **Must not touch:**', '  - `Program.cs`', '### T1 - the poller',
            '- **Files:**', '  - `src/Orders.Worker/InboxPoller.cs` (create)'],
    }[owner];
    return [
        ...(oriented ? [orientedText] : []),
        '',
        'Fit: extend the host in Program.cs.',
        scope ? 'The poller takes `IServiceScopeFactory` and opens a scope per file, because `IOrderStore` is scoped.' : 'The poller takes `IOrderStore` in its constructor.',
        token ? 'Every await threads the `stoppingToken`; shutdown drains the channel.' : 'The loop runs until the process exits.',
        typeof bounded === 'string' ? bounded : bounded ? 'Parsing feeds a bounded `Channel<ParsedOrder>` that the webhook consumer drains.' : 'Parsing feeds a channel that the webhook consumer drains.',
        '',
        ...(ledger === 'heading' ? DECISIONS : ledger === 'none' ? ['## Decisions: none - the brief leaves no two defensible shapes'] : []),
        '',
        '## Tasks',
        ...tasks,
        '',
        'user_decisions: none',
        ...(status ? ['status: PLAN_READY'] : []),
        'contract_version: 1',
    ].join('\n');
}

// The seat's rows in the order a designer works: orient, then report. `main` rows are the dispatcher's own.
function seatRun({ report = plan(), main = [] } = {})
{
    return jsonl([mainTool('Agent', DISPATCH), seatTool('Read', { file_path: '.alfred/docs/work/briefs/order-inbox.md' }),
        seatTool('Read', { file_path: 'src/Orders.Worker/Program.cs' }), seatSay(report), ...main]);
}

test('group T fixture: each step passes its canned pass trace and fails only on its canned fail trace', () =>
{
    const fx = expectOf(FIXTURE);
    const grade = (run) => sc.grade(fx, run, { level: 'plain' });
    const pass = grade(seatRun());
    assert.deepStrictEqual(failing(pass), []);
    assert.strictEqual(pass.graded, 7);

    // the trap steps: the plan leaves the trap implicit
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ scope: false }) }))), ['scope-per-unit']);
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ token: false }) }))), ['stopping-token']);
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ bounded: false }) }))), ['bounded-channel']);
    // each spelling the matcher names
    const swap = (from, to) => plan().replace(from, to);
    assert.deepStrictEqual(failing(grade(seatRun({ report: swap('takes `IServiceScopeFactory` and opens a scope', 'calls `CreateAsyncScope` for a scope') }))), []);
    assert.deepStrictEqual(failing(grade(seatRun({ report: swap('a bounded `Channel<ParsedOrder>`', 'a `Channel.CreateBounded<ParsedOrder>(100)`') }))), []);
    assert.deepStrictEqual(failing(grade(seatRun({ report: swap('the `stoppingToken`', 'the stopping token') }))), []);
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ bounded: 'Parsing feeds a bounded channel of capacity 100 that the webhook consumer drains.' }) }))), []);
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ bounded: 'Parsing feeds a `BoundedChannelOptions(100)` channel that the webhook consumer drains.' }) }))), []);
    // smoke fix 6: a bounded queue type the seat designs and calls 'the channel' - 'bounded' beside Queue or SingleReader, with a channel named in the report
    const queueType = 'Parsing feeds `BillingQueue(int capacity)  // bounded, SingleReader/SingleWriter`, and the webhook consumer drains it.';
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ bounded: queueType }) }))), []);
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ bounded: 'Parsing feeds a bounded queue that the webhook consumer drains.' }) }))), []);
    // with no channel named anywhere in the report, a bounded queue is no channel design
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ token: false, bounded: queueType }) }))), ['stopping-token', 'bounded-channel']);
    // an unbounded queue, and 'bounded' too far from the queue, stay failing
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ bounded: 'Parsing feeds an unbounded queue that the webhook consumer drains.' }) }))), ['bounded-channel']);
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ bounded: `Parsing is bounded${' by the poll interval and the file size limit'.repeat(2)} before the Queue.` }) }))), ['bounded-channel']);

    // the word 'bounded' alone is no channel design: the task-design 'bounded pass' on the Oriented: line, an unbounded channel,
    // and the seat's own 'Method (bounded)' heading all leave the bounded-channel step failing
    const channelless = 'Parsing feeds a channel that the webhook consumer drains.';
    const oriented = 'Oriented: Program.cs read (a bounded pass over the host); dotnet-hosted-services, task-design loaded';
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ bounded: channelless, orientedText: oriented }) }))), ['bounded-channel']);
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ bounded: 'Parsing feeds an unbounded channel that the webhook consumer drains.' }) }))), ['bounded-channel']);
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ bounded: 'Parsing feeds an unbounded `Channel<ParsedOrder>`.', orientedText: oriented }) }))), ['bounded-channel']);
    assert.deepStrictEqual(failing(grade(seatRun({ report: ['## Method (bounded)', plan({ bounded: channelless })].join('\n') }))), ['bounded-channel']);

    // the main session saying the trap is not the seat saying it: run.trace seat reads the seat's rows alone
    const echo = seatRun({ report: plan({ scope: false }), main: [mainSay('The seat should take IServiceScopeFactory and open a scope per unit of work.')] });
    assert.deepStrictEqual(failing(grade(echo)), ['scope-per-unit']);
    const echoToken = seatRun({ report: plan({ token: false }), main: [mainSay('The seat should thread the stoppingToken into every await.')] });
    assert.deepStrictEqual(failing(grade(echoToken)), ['stopping-token']);
    const echoChannel = seatRun({ report: plan({ bounded: false }), main: [mainSay('Use a bounded Channel.CreateBounded<ParsedOrder>(100) between parser and consumer.')] });
    assert.deepStrictEqual(failing(grade(echoChannel)), ['bounded-channel']);

    // one-owner: Program.cs on two tasks' files lines, on none, or after a forbid only
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ owner: 'two' }) }))), ['one-owner']);
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ owner: 'none' }) }))), ['one-owner']);
    // the forbid on another task's line (T2 above) is no ownership, and an entry marked modify is
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ owner: 'one' }) }))), []);
    // smoke fix 5: Program.cs on a nested bullet under a '- **Files:**' header is ownership, once; twice, or under a forbid header, is not
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ owner: 'nested' }) }))), []);
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ owner: 'nestedPath' }) }))), []);
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ owner: 'nestedTwo' }) }))), ['one-owner']);
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ owner: 'nestedForbid' }) }))), ['one-owner']);

    // decisions-ledger: a ## Decisions heading or a Decisions: none - line passes; no ledger fails
    const withLedger = grade(seatRun({ report: plan({ ledger: 'heading' }) }));
    assert.strictEqual(withLedger.steps.find((s) => s.id === 'decisions-ledger').verdict, 'PASS');
    const noneLine = grade(seatRun({ report: plan({ ledger: 'none' }) }));
    assert.strictEqual(noneLine.steps.find((s) => s.id === 'decisions-ledger').verdict, 'PASS');
    const noLedger = grade(seatRun({ report: plan({ ledger: 'absent' }) }));
    assert.deepStrictEqual(failing(noLedger), ['decisions-ledger']);
    // the dispatcher naming a ledger does not count either
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ ledger: 'absent' }), main: [mainSay('## Decisions\n- none')] }))), ['decisions-ledger']);

    // guards: no Oriented: line, no PLAN_READY status
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ oriented: false }) }))), ['oriented-line']);
    assert.deepStrictEqual(failing(grade(seatRun({ report: plan({ status: false }) }))), ['status-line']);
});

test('T: designer-worker-traps is a listed fixture over the console seat', () =>
{
    assert.ok(sc.listSkills().includes(FIXTURE));
    const fx = expectOf(FIXTURE);
    assert.strictEqual(fx.run.trace, 'seat');
    assert.strictEqual(fx.run.model, 'haiku');
    assert.strictEqual(fx.run.max_turns, 15);
    assert.deepStrictEqual(fx.run.stacks, ['console']);
    assert.deepStrictEqual(fx.run.selection.agents, ['console-solution-designer']);
    for (const level of ['explicit', 'plain', 'adverse']) assert.match(fx.prompts[level], /order-inbox\.md/, `${level} names the brief`);
    assert.strictEqual(fx.prompts.plain, 'Dispatch the console-solution-designer seat with `.alfred/docs/work/briefs/order-inbox.md` as its whole brief. Do not design anything yourself; when it returns, stop.');
    assert.deepStrictEqual(fx.steps.map((s) => s.id), ['scope-per-unit', 'stopping-token', 'bounded-channel', 'one-owner', 'decisions-ledger', 'oriented-line', 'status-line']);
    const scaffold = read(`meta/skill-comply/${FIXTURE}/scaffold.sh`);
    assert.ok(scaffold.includes('AddScoped<IOrderStore, SqlOrderStore>()') && scaffold.includes('Host.CreateApplicationBuilder(args)'), 'Program.cs registers the store as a scoped service');
    assert.ok(scaffold.includes('Poll it every 30 seconds, parse each file and store the order through IOrderStore; for every stored order, post a summary to the billing webhook.'), 'the brief names the poll and the webhook');
    assert.ok(scaffold.includes('Parsing and posting run as a producer/consumer pair so a slow webhook never blocks the poll. The worker stops cleanly on shutdown without losing a parsed order.'));
});
