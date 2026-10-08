'use strict';
// Task 23: the code-quality capture and its seat mirror the architecture-quality pair, judged against
// the rules the quality loop already carries - the numbered prompts under <docs-path>/loops/, the
// convention rules and the recorded code style. The quality loop takes the architecture loop's shape
// (analyze -> fix by tier -> loop), and an existing loops/ folder keeps working both ways: as the
// capture's rule source, and through the numbered-prompt run kept as the STAGED mode.
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite();
delete process.env.CLAUDE_CODE_ENTRYPOINT; // the runner's own entrypoint (sdk-cli under claude -p) never decides a case - hook-prelude.js unattended()
const assert = require('node:assert');
const { readClaudeDocs } = require('./claude-docs.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { placement, CORE } = require('./plugin-placement.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const squash = (s) => s.replace(/\s+/g, ' ');
const frontmatter = (text) =>
{
    const block = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(block, 'a frontmatter block');
    const keys = {};
    for (const line of block[1].split('\n'))
    {
        const m = /^([a-z-]+):\s*(.*)$/.exec(line);
        if (m) keys[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
    return keys;
};
const body = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, '');

const CAPTURE = 'stack/skills/capture-code-quality';
const LOOP = 'stack/skills/loop-quality';
const SEAT = 'stack/agents/code-quality-analyzer.md';

// A loops/ folder exactly as the 1.x bootstrap seeded it, plus what a project adds over time: a stage
// of its own (numbered 10, so a lexical sort would misplace it), the run's own records, and a note.
function seededLoops()
{
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-quality-loops-')));
    const loops = path.join(dir, '.claude', 'docs', 'loops');
    fs.mkdirSync(loops, { recursive: true });
    for (const f of ['0.fix-discipline.md', '1.structure.md', '2.code-quality.md', '3.naming.md', '4.logging.md', '5.comments.md',
        '10.security.md', 'RUN-STATE.md', 'DECISIONS.md', 'notes.md'])
        fs.writeFileSync(path.join(loops, f), `# ${f}\n`);
    return { dir, loops, rm: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// The shipped command, run as written - the text a session copies is the thing under test.
const bashBlocks = (text) => [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
const runBash = (script, cwd) => spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8' });

test('the capture is a copy and its seat rides the core, placed by the rule that places the architecture-quality pair', () =>
{
    // 2.1.0: every skill is a project copy, every seat rides the core.
    const p = placement();
    const core = p.plugins[CORE];
    for (const s of ['capture-architecture-quality', 'loop-architecture-quality', 'loop-quality', 'capture-code-quality'])
    {
        assert.ok(p.library.skills.includes(s), `${s} is a project copy`);
        assert.ok(!core.skills.includes(s), `${s} rides no plugin`);
    }
    for (const a of ['architecture-analyzer', 'code-quality-analyzer'])
    {
        assert.ok(core.agents.includes(a), `${a} rides the core`);
        assert.ok(!p.library.agents.includes(a), `${a} is never a library copy`);
    }

    const recs = JSON.parse(read('meta/recommendations.json'));
    assert.ok(recs.always.skills.includes('capture-code-quality'), 'seeded where the quality loop is');
    assert.ok(recs.always.skills.includes('loop-quality'));
    assert.ok(recs.always.agents.includes('code-quality-analyzer'), 'the capture seeds the seat it fans out');

    const manifest = JSON.parse(read('meta/stack-manifest.json'));
    assert.ok(manifest.skills.some((s) => s.name === 'capture-code-quality' && /CODE-ASSESSMENT\.md/.test(s.note)), 'manifest skill row');
    assert.ok(manifest.agents.some((a) => a.file === 'code-quality-analyzer.md' && /read-only/.test(a.note)), 'manifest agent row');

    const graph = JSON.parse(read('meta/stack-graph.json'));
    assert.ok(graph.skills['capture-code-quality'], 'graph skill node');
    assert.ok(graph.agents['code-quality-analyzer'], 'graph agent node');

    const entries = JSON.stringify(JSON.parse(read('meta/plugin-entries.json')));
    assert.ok(!entries.includes('./stack/skills/capture-code-quality"'), 'the skill is a project copy - no entry lists it');
    assert.ok(entries.includes('./stack/agents/code-quality-analyzer.md"'), 'the generated core entry lists the seat');

    // The loop invokes the capture as a Skill call, so it carries no disable-model-invocation - and the
    // generated usage policy lists it with the orchestration skills, marked as the by-design exception.
    const inventory = read('stack/skills/capture-agent-capabilities/scripts/capabilities-inventory.js');
    const set = /const MODEL_INVOCABLE_BY_DESIGN = new Set\(\[([^\]]*)\]\)/.exec(inventory);
    assert.ok(set && set[1].includes("'capture-code-quality'"), 'the capture is model-invocable by design');
});

test('the seat is a read-only sonnet support seat whose findings each name a file:line and a rule', () =>
{
    const text = read(SEAT);
    const fm = frontmatter(text);
    assert.strictEqual(fm.name, 'code-quality-analyzer');
    assert.strictEqual(fm.model, 'sonnet', 'pinned like the other support seats');
    assert.match(fm.description, /^Use /);
    const tools = fm.tools.split(',').map((t) => t.trim());
    for (const banned of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Agent', 'Task'])
        assert.ok(!tools.includes(banned), `a read-only seat carries no ${banned}`);
    for (const need of ['mcp__plugin_alfred-navigation_alfred-navigation__find_symbol', 'mcp__plugin_alfred-navigation_alfred-navigation__find_referencing_symbols',
        'mcp__plugin_alfred-navigation_alfred-navigation__get_symbols_overview', 'mcp__plugin_alfred-memory_alfred-memory__memory_store', 'mcp__plugin_alfred-memory_alfred-memory__memory_search',
        'mcp__plugin_alfred-memory_alfred-memory__memory_list', 'Read', 'Grep', 'Glob', 'Bash', 'Skill', 'LSP'])
        assert.ok(tools.includes(need), `the seat is granted ${need}`);

    const b = squash(body(text));
    assert.match(b, /status: CHARACTERIZED \| PARTIAL \| BLOCKED/, 'a routable status line');
    assert.match(b, /`F \| <severity> \| <file:line> \| <rule> \| <what breaks[^`]*> \| <smallest fix>`/, 'one finding per line, in the pinned shape');
    assert.match(b, /never trimmed/, 'every finding is listed');
    assert.match(b, /Read-only/);
    assert.match(b, /says it covers/, 'loads the convention skills by description');
    assert.match(b, /deterministic scan/, 'an enumerable class pairs the audit with a scan');

    // It judges only what it was handed: a convention skill loads because a handed rule names it,
    // never because the module happens to hold that file family.
    assert.match(b, /Judge only the rules the dispatch handed you/);
    assert.match(b, /only when a handed convention rule names it/);
    assert.doesNotMatch(b, /for each file family the module holds/, 'no skill loaded by file family alone');
    // N modules' reports all land in the judging session, so each has a ceiling like the architecture seat's.
    const report = squash(text.slice(text.indexOf('## Report')));
    assert.match(report, /the whole report under ~1\.5k tokens/);
    assert.match(report, /fold by rule/);
    // The description names where each thing it does not do goes.
    for (const dest of ['architecture-analyzer', 'test-coverage-analyzer', 'code-style-analyzer'])
        assert.ok(fm.description.includes(dest), `the seat's description sends its neighbour's work to ${dest}`);
});

test('the capture writes only quality/CODE-ASSESSMENT.md, fresh every run, and ORIENT -> GATHER -> JUDGE -> RE-GATHER -> WRITE -> REPORT', () =>
{
    const text = read(`${CAPTURE}/SKILL.md`);
    const fm = frontmatter(text);
    assert.strictEqual(fm.name, 'capture-code-quality');
    assert.match(fm.description, /^Use when /);
    assert.match(fm.description, /Not for /);
    assert.ok(!('disable-model-invocation' in fm), 'the loop invokes it, like the architecture-quality capture');
    assert.ok(fm.description.length <= 1000, 'lint 15 cap');

    const b = squash(body(text));
    let at = -1;
    for (const step of ['### 1. ORIENT', '### 2. GATHER', '### 3. JUDGE', '### 4. RE-GATHER', '### 5. WRITE', '### 6. REPORT'])
    {
        const i = b.indexOf(step);
        assert.ok(i > at, `${step} follows the step before it`);
        at = i;
    }
    assert.match(b, /`<docs-path>\/quality\/CODE-ASSESSMENT\.md`/);
    assert.match(b, /The only file you write/);
    assert.match(b, /no `watch\.json`/);
    assert.match(b, /code-quality-analyzer/, 'the seat it fans out');
    assert.match(b, /`<docs-path>\/loops\/`/, 'rule source: the numbered prompts');
    assert.match(b, /`<docs-path>\/code-style\/CODE-STYLE\.md`/, 'rule source: the recorded style');
    assert.match(b, /convention rules/, 'rule source: the stack convention rules');
    assert.match(b, /No `loops\/` folder[^.]*: say so[^.]*convention rules and `CODE-STYLE\.md` alone/, 'the fallback is said, not silent');
    assert.match(b, /Hard cap: 3 gather rounds/);
    assert.match(b, /Deliberate only, never mid-build|deliberate only, never mid-build/i);
    for (const field of ['`References:`', '`Rules:`', '`Decisions:`', '`Findings gate:`', '`Write:`', '`Model:`'])
        assert.ok(b.includes(field), `the REPORT receipt carries ${field}`);
    assert.match(b, /Read `references\/doc-shape\.md` before JUDGE/);

    // GATHER fans out ONE seat PER MODULE, in parallel - judged on the step's body, not its heading.
    const raw = body(text);
    const gatherAt = raw.indexOf('### 2. GATHER');
    const gather = squash(raw.slice(raw.indexOf('\n', gatherAt), raw.indexOf('### 3. JUDGE')));
    assert.match(gather, /Dispatch code-quality-analyzer per module/, 'one seat per module');
    assert.match(gather, /in a single message/, 'the module seats go out in parallel');
    // The decision log is read, never written - the rule stated as the hard rule it is.
    assert.match(b, /\*\*Reads decisions, never writes them - hard rule\.\*\*/);
    // No rule source at all: stop, write nothing - a doc judged against nothing reads as clean code.
    assert.match(b, /\*\*No rule source at all - stop\.\*\*[^*]*writing nothing/);
    assert.match(b, /No rule source at all - stop\.\*\*[^*]*`\/capture-code-style`[^*]*`\/loop-quality`/, 'and names the two ways to get rules, both slash-typed');
    // A remediation is checked against the OTHER handed rules, or the loop oscillates between them.
    const judge = squash(raw.slice(raw.indexOf('### 3. JUDGE'), raw.indexOf('### 4. RE-GATHER')));
    assert.match(judge, /Cross-check every Must-fix remediation against the other rules/);
    assert.match(judge, /Cross-check[^]*precedence[^]*tiered structural/);
    // The neighbours with their destinations live in the body's When to use (the 160-char description cannot hold them).
    const whenToUse = raw.slice(raw.indexOf('## When to use'), raw.indexOf('## Execution modes'));
    assert.ok(whenToUse.length > 0, 'the body has a When to use section before Execution modes');
    for (const dest of ['/loop-quality', 'capture-architecture-quality', 'capture-code-style', '/security-review', 'task-verify-code'])
        assert.ok(whenToUse.includes(dest), `Not for ... (${dest})`);
    assert.ok(read('stack/skills/capture-architecture-quality/SKILL.md').split('\n')[2].includes('(capture-code-quality)'),
        'the architecture-quality capture sends code quality to its new neighbour');
});

test('the doc shape ties every finding to file:line and to the rule it breaks, outside the docs engine', () =>
{
    const shape = read(`${CAPTURE}/references/doc-shape.md`);
    const head = shape.split('\n').slice(0, 15).join('\n');
    assert.match(head, /## Contents/, 'a reference over 100 lines opens with its contents');
    const s = squash(shape);
    for (const section of ['## Rule sources', '## The findings gate', '## The count rule', '## The three buckets', '## The shape', '## Format discipline', '## Write mechanics'])
        assert.ok(s.includes(section), `doc-shape carries ${section}`);
    assert.match(s, /pass all four questions or it is not a finding/);
    assert.match(s, /an output, never a target/);
    assert.match(s, /no `watch\.json`/);
    assert.match(s, /Target: ~300 lines/);
    assert.match(s, /As of: <branch>@<short-sha>, <YYYY-MM-DD>/);
    assert.match(s, /All three absent[^.]*stops[^.]*writes nothing/, 'no rule source at all is a stop, not a clean result');
    // The worked entry is the shape a run copies: a rule, a file:line, a severity, a tier, a remediation.
    const entry = /> \*\*C\d+ - [\s\S]*?\*\*Tier\*\* - (small|substantial|structural)\./.exec(shape);
    assert.ok(entry, 'one worked Must-fix entry');
    assert.match(entry[0], /\*\*Rule\*\* - `loops\/\d+\.[a-z-]+\.md`/, 'the entry names the loops prompt it breaks');
    assert.match(entry[0], /`[\w/.-]+\.\w+:\d+`/, 'the entry is located at file:line');
    assert.match(entry[0], /\*\*Severity\*\* - (BLOCKER|MAJOR|MINOR)/);
    assert.match(entry[0], /\*\*Remediation\*\* - /);
});

test('quality/CODE-ASSESSMENT.md is no docs domain - the engine never sections or versions it', () =>
{
    const { repo, HOOKS } = require('./docs-fixture');
    const r = repo();
    const ENGINE = require.resolve(path.join(HOOKS, 'docs.js'));
    const saved = { dir: process.env.CLAUDE_PROJECT_DIR, docs: process.env.ALFRED_CODE_DOCS_PATH };
    try
    {
        r.write('.claude/docs/architecture/watch.json', '{}');
        r.write('.claude/docs/quality/ASSESSMENT.md', '# x');
        r.write('.claude/docs/quality/CODE-ASSESSMENT.md', '# x');
        delete require.cache[ENGINE];
        process.env.CLAUDE_PROJECT_DIR = r.root;
        process.env.ALFRED_CODE_DOCS_PATH = '.claude/docs';
        assert.deepStrictEqual(require(ENGINE).domains(), ['architecture']);
    }
    finally
    {
        delete require.cache[ENGINE];
        if (saved.dir === undefined) delete process.env.CLAUDE_PROJECT_DIR; else process.env.CLAUDE_PROJECT_DIR = saved.dir;
        if (saved.docs === undefined) delete process.env.ALFRED_CODE_DOCS_PATH; else process.env.ALFRED_CODE_DOCS_PATH = saved.docs;
        r.rm();
    }
    const root = squash(read('stack/rules/alfred-docs-root.md'));
    assert.match(root, /`quality\/ASSESSMENT\.md` and `quality\/CODE-ASSESSMENT\.md`/, 'the docs-root rule names both beside each other');
});

test('an existing loops folder is the capture\'s rule source: numbered stages in numeric order, never the fix discipline or the run records', () =>
{
    const block = bashBlocks(read(`${CAPTURE}/SKILL.md`)).find((b) => b.includes('<docs-path>/loops'));
    assert.ok(block, 'the capture ships its rule-source command');
    const script = block.replace(/<docs-path>/g, '.claude/docs');

    const f = seededLoops();
    try
    {
        const out = runBash(script, f.dir);
        assert.strictEqual(out.status, 0, out.stderr);
        assert.deepStrictEqual(out.stdout.trim().split('\n'),
            ['loops: present', '1.structure.md', '2.code-quality.md', '3.naming.md', '4.logging.md', '5.comments.md', '10.security.md']);

        for (const x of fs.readdirSync(f.loops)) fs.rmSync(path.join(f.loops, x));
        assert.deepStrictEqual(runBash(script, f.dir).stdout.trim().split('\n'), ['loops: present'], 'an empty folder lists no rule');

        fs.rmSync(f.loops, { recursive: true });
        assert.deepStrictEqual(runBash(script, f.dir).stdout.trim().split('\n'), ['loops: absent'], 'absence is said, never an empty list');
    }
    finally { f.rm(); }
});

test('the numbered-prompt run stays reachable as the STAGED mode, over the same folder', () =>
{
    const loop = squash(body(read(`${LOOP}/SKILL.md`)));
    assert.match(loop, /\*\*STAGED\*\*/, 'the mode is named');
    assert.match(loop, /`\/loop-quality staged/, 'reached by naming it in the invocation');
    assert.match(loop, /`RUN-STATE\.md`/, 'a staged run in progress resumes staged');
    assert.match(loop, /Read `references\/staged-mode\.md`/);

    const staged = read(`${LOOP}/references/staged-mode.md`);
    const s = squash(staged);
    for (const part of ['## DISCOVERY', '## OUTER LOOP', '## INNER LOOP', '## STOP CONDITIONS', '## OUTPUT'])
        assert.ok(s.includes(part), `the staged run keeps ${part}`);
    for (const ref of new Set([...staged.matchAll(/`references\/([a-z-]+\.md)`/g)].map((m) => m[1])))
        assert.ok(exists(`${LOOP}/references/${ref}`), `staged-mode names references/${ref}, which ships`);
    assert.match(read(`${LOOP}/references/stage-close.md`), /staged-mode\.md/, 'the stage close points at the staged run, not the default body');

    // DISCOVERY's own order command, run over a 1.x folder: every numbered file in numeric order.
    const cmd = /`(ls "<LOOP_DIR>" \| sort -t\. -k1,1n)`/.exec(staged);
    assert.ok(cmd, 'the staged run keeps its order command');
    const f = seededLoops();
    try
    {
        const out = runBash(cmd[1].replace('<LOOP_DIR>', f.loops), f.dir);
        assert.strictEqual(out.status, 0, out.stderr);
        assert.deepStrictEqual(out.stdout.split('\n').filter((l) => /^\d+\./.test(l)),
            ['0.fix-discipline.md', '1.structure.md', '2.code-quality.md', '3.naming.md', '4.logging.md', '5.comments.md', '10.security.md']);
    }
    finally { f.rm(); }
});

test('the loop runs the capture each round and routes its findings by tier', () =>
{
    const text = read(`${LOOP}/SKILL.md`);
    const fm = frontmatter(text);
    assert.strictEqual(fm['disable-model-invocation'], 'true', 'still /-only');
    assert.match(fm.description, /^Use when /);
    assert.match(fm.description, /Not for /);
    assert.match(fm.description, /staged/, 'the description says where the numbered-prompt run went');

    const b = squash(body(text));
    let at = -1;
    for (const step of ['### 1. ANALYZE', '### 2. TRIAGE + FIX by tier', '### 3. LOOP or STOP'])
    {
        const i = b.indexOf(step);
        assert.ok(i > at, `${step} follows the step before it`);
        at = i;
    }
    assert.match(b, /`capture-code-quality`/, 'ANALYZE runs the capture');
    assert.match(b, /`<docs-path>\/quality\/CODE-ASSESSMENT\.md`/);
    // Each tier is judged on its OWN bullet - a match that may span the whole body proves nothing.
    const raw = body(text);
    const region = raw.slice(raw.indexOf('\n- **small**'), raw.indexOf('### 3. LOOP or STOP'));
    const bullets = region.split(/\n- (?=\*\*)/).filter((x) => x.trim());
    const tier = (name) =>
    {
        const t = bullets.find((x) => x.startsWith(`**${name}**`));
        assert.ok(t, `the ${name} tier has its own bullet`);
        return squash(t);
    };
    const small = tier('small');
    assert.match(small, /dispatch the matching domain implementer/, 'small goes to a domain implementer, never inline');
    assert.match(small, /batched into one scoped brief/);
    const substantial = tier('substantial');
    let from = -1;
    for (const step of ['domain solution-designer', '`task-verify-plan`', "the user's approval on that plan before building", 'domain implementers', 'domain verifier'])
    {
        const i = substantial.indexOf(step);
        assert.ok(i > from, `substantial: '${step}' comes after the step before it`);
        from = i;
    }
    const structural = tier('structural');
    assert.match(structural, /do NOT auto-apply/);
    assert.match(structural, /AskUserQuestion/, 'structural is the user\'s call');
    // Past the trigger the STOP reconcile offers the fresh session before the capture runs again.
    const stop = squash(raw.slice(raw.indexOf('### 3. LOOP or STOP')));
    assert.match(stop, /reconcile ONCE[^]*When this session is already past the fresh-session trigger, the same fresh-session choice above applies before the capture runs/);
    for (const v of ['SATISFIED', 'PLATEAU', 'CAPPED', 'BLOCKED']) assert.ok(b.includes(`**${v}**`), `verdict ${v}`);
    assert.match(b, /Hard cap: 3 improve rounds/);
    assert.match(b, /references\/anti-gaming-sweep\.md/, 'the never-weaken sweep survives the rework');
    assert.match(b, /references\/bootstrap\.md/, 'a missing folder is still seeded');
    assert.match(b, /never seed[^.]*around/, 'a user-authored folder is never seeded around');

    const mech = squash(read(`${LOOP}/references/loop-mechanics.md`));
    assert.match(mech, /RESUME - loop-quality/);
    assert.match(mech, /\*\*Mechanics\*\* - `loop-mechanics\.md: read`/);
    assert.match(mech, /\*\*Anti-gaming\*\*/);

    // The substantial tier is the domain-trio vertical, vendored like the other two loops' copies.
    assert.strictEqual(read(`${LOOP}/references/domain-trio-protocol.md`), read('stack/skills/task-solve-cross/references/domain-trio-protocol.md'));

    // The starter set still ships, so a project without a loops folder is seeded as before. It is a copy
    // source, never a read, so it sits in assets/ rather than references/ (2.1.5 audit M85).
    for (const f of ['fix-discipline.md', 'structure.md', 'code-quality.md', 'naming.md', 'logging.md', 'comments.md'])
    {
        assert.ok(exists(`${LOOP}/assets/loops-starter/${f}`), `starter prompt ${f}`);
        assert.ok(!exists(`${LOOP}/references/${f}`), `starter prompt ${f} left references/`);
    }
    assert.match(squash(read(`${LOOP}/SKILL.md`)), /`assets\/loops-starter\/`/, 'SKILL.md names the starter folder');
    assert.match(squash(read(`${LOOP}/references/bootstrap.md`)), /`assets\/loops-starter\/`/, 'bootstrap copies from it');
    assert.match(squash(read(`${LOOP}/references/staged-mode.md`)), /`assets\/loops-starter\/`/, 'the staged run seeds from it');
});

// The fresh-session guard's roster, read the way lint 29 reads it.
function orchestration()
{
    const m = /^const ORCHESTRATION = \/(.*)\/([a-z]*);$/m.exec(read('stack/hooks/guard-fresh-session-start.js'));
    assert.ok(m, 'the hook carries its ORCHESTRATION line');
    return new RegExp(m[1], m[2]);
}

test('every skill the inventory calls orchestration is on the fresh-session guard\'s roster', () =>
{
    const inventory = read('stack/skills/capture-agent-capabilities/scripts/capabilities-inventory.js');
    const set = /const MODEL_INVOCABLE_BY_DESIGN = new Set\(\[([^\]]*)\]\)/.exec(inventory);
    assert.ok(set, 'the inventory names its model-invocable orchestration skills');
    const names = [...set[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    assert.ok(names.includes('capture-code-quality'));
    const roster = orchestration();
    for (const name of names)
        assert.match(name, roster, `${name} is orchestration in the inventory, so the guard gates it too`);
});

test('a code-quality capture started past the fresh-session trigger is offered a fresh session first', () =>
{
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-fresh-'));
    try
    {
        const env = { ...process.env };
        for (const k of Object.keys(env)) if (k.startsWith('ALFRED_CODE_')) delete env[k];
        for (const [k, dir] of [['CLAUDE_CONFIG_DIR', 'acct'], ['CLAUDE_PROJECT_DIR', 'root'], ['ALFRED_CODE_HOOK_LOG_DIR', 'log']])
        {
            env[k] = path.join(tmp, dir);
            fs.mkdirSync(env[k]);
        }
        // 450k proves the 1M tier and sits past its 400k trigger; 50k is under every trigger.
        const transcript = (name, ctx) =>
        {
            const p = path.join(tmp, `${name}.jsonl`);
            const row = (id, usage) => ({ type: 'assistant', message: { id, content: [{ type: 'text', text: 'ok' }], usage } });
            fs.writeFileSync(p, [row(`${name}-floor`, { cache_creation_input_tokens: 20000 }), row(name, { cache_read_input_tokens: ctx })].map((r) => JSON.stringify(r)).join('\n') + '\n');
            return p;
        };
        const call = (skill, tp) => spawnSync(process.execPath, [path.join(ROOT, 'stack', 'hooks', 'guard-fresh-session-start.js')],
            { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill }, transcript_path: tp }), encoding: 'utf8', env });
        const hot = call('alfred-code:capture-code-quality', transcript('hot-code', 450000));
        assert.strictEqual(hot.status, 2, 'blocked past the trigger');
        assert.match(hot.stderr, /^Blocked: alfred-code:capture-code-quality/);
        assert.match(squash(hot.stderr), /ONE AskUserQuestion: start it in a fresh session \(recommended/);
        assert.strictEqual(call('capture-code-quality', transcript('hot-bare', 450000)).status, 2, 'the bare name too');
        assert.strictEqual(call('alfred-code:capture-architecture-quality', transcript('hot-arch', 450000)).status, 2, 'and its architecture twin');
        assert.strictEqual(call('alfred-code:capture-code-quality', transcript('cold', 50000)).status, 0, 'under the trigger it runs');
    }
    finally
    {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('the CLAUDE.md seat counts match the agents on disk', () =>
{
    const n = fs.readdirSync(path.join(ROOT, 'stack', 'agents')).filter((f) => f.endsWith('.md')).length;
    const doc = readClaudeDocs();
    assert.match(doc, new RegExp(`\`stack/agents/\` - ${n} subagents`));
    assert.match(doc, new RegExp(`twins of all ${n}\\b`));
    assert.match(doc, new RegExp(`all ${n} in the core plugin`));
});

test('the shared-rules registry pins the new homes of the loop and capture rules', () =>
{
    const rules = JSON.parse(read('meta/shared-rules.json')).rules;
    const sites = (id) => [rules[id].owner, ...(rules[id].sites || [])].map((x) => x.file);
    for (const id of ['findings-gate-four-questions', 'finding-count-is-output'])
        assert.ok(sites(id).includes(`${CAPTURE}/SKILL.md`), `${id} pins the capture`);
    for (const id of ['loop-round-receipt', 'small-tier-dispatch-consent', 'loop-close-commit-ask', 'mode-ask-at-start', 'fresh-session-at-boundaries'])
        assert.ok(sites(id).includes(`${LOOP}/SKILL.md`), `${id} pins the loop`);
    for (const id of ['domain-trio-protocol-vendored', 'implementer-worktree-step-zero', 'memories-purge-count'])
        assert.ok(sites(id).includes(`${LOOP}/references/domain-trio-protocol.md`), `${id} pins the vendored trio copy`);
    for (const id of ['report-lean', 'serena-overview-file-not-directory', 'on-demand-skill-availability'])
        assert.ok(sites(id).includes(SEAT), `${id} pins the seat`);
});
