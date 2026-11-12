'use strict';
// THE MODEL FILE (the workspace source design, Section 3; stage 2): a hand-edited `.alfred/agents.json` names, per host,
// the model a seat runs on. `stack/hooks/agent-models.js` reads it through the workspace chain - the nearest file naming
// the seat wins - and checks its shape; the dispatch guard puts an entry's model into the one `updatedInput` it writes.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { putWorkspace } = require('./workspace-fixture.js');
const models = require('../stack/hooks/agent-models.js');

const { readFile, modelFor, entries, SKILLS_APPLY, SKILLS_WHY, FULL_IDS, MODEL_RE, HOSTS, KINDS } = models;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-models-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const env = { HOME: TMP, CLAUDE_CONFIG_DIR: path.join(TMP, 'acct') };
// A fresh root per case; `ws` is a stamped workspace root holding the stamped child `ws/api`.
let seq = 0;
const fixture = () =>
{
    const top = path.join(TMP, `f${seq++}`);
    const at = (rel) => path.join(top, ...rel.split('/'));
    const project = (rel, record) =>
    {
        fs.mkdirSync(path.join(at(rel), '.claude'), { recursive: true });
        fs.writeFileSync(path.join(at(rel), '.claude', 'alfred-code.stamp'), 'sha: x\n');
        if (record) putWorkspace(at(rel), record);
    };
    const putText = (rel, text) => { fs.mkdirSync(path.dirname(at(rel)), { recursive: true }); fs.writeFileSync(at(rel), text); };
    const put = (rel, obj) => putText(rel, `${JSON.stringify(obj, null, 2)}\n`);
    project('ws', { role: 'root', children: ['api'] });
    project('ws/api', { parent: '..' });
    return { at, put, putText };
};
const MODEL_WORDS = 'the model must be 1 to 100 characters of letters, digits and . _ : [ ] - - skipped';

test('agent-models: the constants', () =>
{
    assert.deepStrictEqual(HOSTS, ['claude', 'cursor']);
    assert.deepStrictEqual(KINDS, ['agents', 'skills']);
    assert.strictEqual(String(MODEL_RE), String(/^[A-Za-z0-9._:\[\]-]{1,100}$/));
    assert.strictEqual(typeof SKILLS_APPLY, 'boolean');
    assert.strictEqual(SKILLS_WHY === '', SKILLS_APPLY, 'a reason exactly while skill entries are not applied');
    assert.deepStrictEqual(Object.keys(FULL_IDS), ['agents', 'skills']);
});

test('agent-models: the nearest file naming a seat wins, a plugin prefix is dropped', () =>
{
    const { at, put } = fixture();
    put('ws/.alfred/agents.json', { claude: { agents: { 'aspnet-verifier': { model: 'opus' }, 'web-angular-verifier': { model: 'opus' } } } });
    put('ws/api/.alfred/agents.json', { claude: { agents: { 'aspnet-verifier': { model: 'haiku' } } } });
    const ask = (start, name, extra = {}) => modelFor({ start: at(start), env: { ...env, ...extra }, host: 'claude', kind: 'agents', name });
    assert.deepStrictEqual(ask('ws/api', 'alfred-code:aspnet-verifier'), { model: 'haiku', from: 'here' });
    assert.deepStrictEqual(ask('ws/api', 'web-angular-verifier'), { model: 'opus', from: '..' });
    assert.strictEqual(ask('ws/api', 'web-angular-verifier', { ALFRED_CODE_WORKSPACE: '0' }), null);
    assert.deepStrictEqual(ask('ws', 'aspnet-verifier'), { model: 'opus', from: 'here' });
    assert.strictEqual(ask('ws', 'console-verifier'), null);
});

test('agent-models: no file, an empty file, garbage and a JSON array answer null and never throw', () =>
{
    const { at, putText } = fixture();
    const file = at('ws/.alfred/agents.json');
    const ask = () => modelFor({ start: at('ws'), env, host: 'claude', kind: 'agents', name: 'aspnet-verifier' });
    assert.deepStrictEqual(readFile(file), { state: 'absent', hosts: {}, problems: [] });
    assert.strictEqual(ask(), null);
    for (const text of ['', '{ not json', '[{ "claude": {} }]', '"claude"', 'null'])
    {
        putText('ws/.alfred/agents.json', text);
        assert.deepStrictEqual(readFile(file), { state: 'garbage', hosts: {}, problems: ['not JSON - the file is ignored'] }, JSON.stringify(text));
        assert.strictEqual(ask(), null, JSON.stringify(text));
    }
});

test('agent-models: a bad entry is skipped and named, the good one beside it applies', () =>
{
    const { at, put } = fixture();
    put('ws/.alfred/agents.json', {
        gemini: { agents: { a: { model: 'opus' } } },
        claude: {
            tools: { a: { model: 'opus' } },
            agents: { ok: { model: 'sonnet' }, empty: { model: '' }, long: { model: 'a'.repeat(101) }, spaced: { model: 'opus 4' }, quoted: { model: 'a"b' }, number: { model: 4 }, bare: {}, text: 'opus' },
        },
    });
    const read = readFile(at('ws/.alfred/agents.json'));
    assert.strictEqual(read.state, 'ok');
    assert.deepStrictEqual(read.hosts.claude.agents, { ok: 'sonnet' });
    assert.strictEqual(read.hosts.gemini, undefined);
    assert.deepStrictEqual(read.problems.sort(), [
        "unknown host 'gemini' skipped", "claude: unknown key 'tools' skipped",
        ...['empty', 'long', 'spaced', 'quoted', 'number', 'bare', 'text'].map((n) => `claude.agents.${n}: ${MODEL_WORDS}`),
    ].sort());
    assert.deepStrictEqual(modelFor({ start: at('ws'), env, host: 'claude', kind: 'agents', name: 'ok' }), { model: 'sonnet', from: 'here' });
    assert.strictEqual(modelFor({ start: at('ws'), env, host: 'claude', kind: 'agents', name: 'spaced' }), null);
});

test('agent-models: a host or a kind that is no object is named and skipped', () =>
{
    const { at, put } = fixture();
    put('ws/.alfred/agents.json', { claude: { agents: ['opus'] }, cursor: 'opus' });
    assert.deepStrictEqual(readFile(at('ws/.alfred/agents.json')).problems.sort(), ['claude.agents: not an object - skipped', 'cursor: not an object - skipped']);
});

const ALIAS_WORDS = 'the model must be one of sonnet, opus, haiku, fable - a full model id is not taken - skipped';
test('agent-models: a value of 1 and of 100 characters passes the shape check, 101 does not', () =>
{
    const { at, put } = fixture();
    const sizes = { one: { model: 'a' }, hundred: { model: 'a'.repeat(100) }, over: { model: 'a'.repeat(101) } };
    put('ws/.alfred/agents.json', { claude: { agents: sizes }, cursor: { agents: sizes } });
    const { problems } = readFile(at('ws/.alfred/agents.json'));
    assert.deepStrictEqual(problems.filter((p) => p.endsWith(MODEL_WORDS)), ['claude.agents.over', 'cursor.agents.over'].map((n) => `${n}: ${MODEL_WORDS}`));
    const ask = (name) => modelFor({ start: at('ws'), env, host: 'claude', kind: 'agents', name });
    // a value of the right shape still has to be one the Agent tool takes, unless full ids are
    for (const name of ['one', 'hundred'])
    {
        assert.strictEqual(ask(name) === null, !FULL_IDS.agents, name);
        assert.strictEqual(problems.includes(`claude.agents.${name}: ${ALIAS_WORDS}`), !FULL_IDS.agents, name);
    }
    assert.strictEqual(ask('over'), null);
});

// Stage 0, P6: the Agent tool's schema takes four names, and an updatedInput carrying any other model REFUSES the dispatch.
test('agent-models: only a name the Agent tool takes applies to a seat', () =>
{
    const { at, put } = fixture();
    const names = { a: 'sonnet', b: 'opus', c: 'haiku', d: 'fable', typo: 'opuss', wide: 'opus[1m]', upper: 'Opus', inherit: 'inherit', full: 'claude-haiku-5-5' };
    put('ws/.alfred/agents.json', { claude: { agents: Object.fromEntries(Object.entries(names).map(([n, model]) => [n, { model }])) } });
    const read = readFile(at('ws/.alfred/agents.json'));
    assert.strictEqual(FULL_IDS.agents, false, 'with full ids taken this list goes');
    assert.deepStrictEqual(read.hosts.claude.agents, { a: 'sonnet', b: 'opus', c: 'haiku', d: 'fable' });
    assert.deepStrictEqual(read.problems, ['typo', 'wide', 'upper', 'inherit', 'full'].map((n) => `claude.agents.${n}: ${ALIAS_WORDS}`));
});

test('agent-models: the cursor map is read and reported, never applied to claude', () =>
{
    const { at, put } = fixture();
    put('ws/.alfred/agents.json', { cursor: { agents: { 'aspnet-verifier': { model: 'gpt-5' } }, skills: { csharp: { model: 'gpt-5' } } } });
    assert.strictEqual(modelFor({ start: at('ws'), env, host: 'claude', kind: 'agents', name: 'aspnet-verifier' }), null);
    assert.strictEqual(modelFor({ start: at('ws'), env, host: 'cursor', kind: 'agents', name: 'aspnet-verifier' }), null);
    const texts = ['cursor.agents: read, not applied - waits for the Cursor run', 'cursor.skills: no route on this host'];
    for (const host of HOSTS)
    {
        const read = entries({ start: at('ws'), env, host });
        assert.deepStrictEqual(read.applied, [], host);
        assert.deepStrictEqual(read.problems, texts.map((text) => ({ from: 'here', text })), host);
    }
});

test('agent-models: the skills map follows SKILLS_APPLY, a full id follows FULL_IDS', () =>
{
    const { at, put } = fixture();
    put('ws/.alfred/agents.json', { claude: {
        agents: { full: { model: 'claude-haiku-5-5' }, plain: { model: 'opus' } },
        skills: { csharp: { model: 'haiku' }, typescript: { model: 'claude-haiku-5-5' } },
    } });
    const read = readFile(at('ws/.alfred/agents.json'));
    const ask = (kind, name) => modelFor({ start: at('ws'), env, host: 'claude', kind, name });
    assert.deepStrictEqual(ask('agents', 'plain'), { model: 'opus', from: 'here' });
    const fullWords = (kind, name) => `claude.${kind}.${name}: ${ALIAS_WORDS}`;
    assert.strictEqual(ask('agents', 'full') === null, !FULL_IDS.agents);
    assert.strictEqual(read.problems.includes(fullWords('agents', 'full')), !FULL_IDS.agents);
    const off = `claude.skills: not applied in this release (${SKILLS_WHY})`;
    assert.strictEqual(read.problems.filter((p) => p === off).length, SKILLS_APPLY ? 0 : 1);
    assert.strictEqual(ask('skills', 'csharp') === null, !SKILLS_APPLY);
    if (SKILLS_APPLY) assert.strictEqual(read.problems.includes(fullWords('skills', 'typescript')), !FULL_IDS.skills);
    else assert.deepStrictEqual(read.hosts.claude.skills, {});
});

test('agent-models: entries lists each applied entry with where it came from', () =>
{
    const { at, put } = fixture();
    put('ws/.alfred/agents.json', { claude: { agents: { 'aspnet-verifier': { model: 'opus' }, 'web-angular-verifier': { model: 'opus' }, bad: { model: '' } } }, gemini: {} });
    put('ws/api/.alfred/agents.json', { claude: { agents: { 'aspnet-verifier': { model: 'haiku' } } } });
    const read = entries({ start: at('ws/api'), env, host: 'claude' });
    assert.deepStrictEqual(read.applied, [
        { kind: 'agents', name: 'aspnet-verifier', model: 'haiku', from: 'here' },
        { kind: 'agents', name: 'web-angular-verifier', model: 'opus', from: '..' },
    ]);
    assert.deepStrictEqual(read.problems, [{ from: '..', text: `claude.agents.bad: ${MODEL_WORDS}` }], 'a member above: only its agents maps\' problems');
    assert.deepStrictEqual(entries({ start: at('ws/api'), env: { ...env, ALFRED_CODE_WORKSPACE: '0' }, host: 'claude' }).applied.map((r) => r.from), ['here']);
});

test('agent-models: a member\'s unreadable file is named from below', () =>
{
    const { at, putText } = fixture();
    putText('ws/.alfred/agents.json', '{ not json');
    assert.deepStrictEqual(entries({ start: at('ws/api'), env, host: 'claude' }), { applied: [], problems: [{ from: '..', text: 'not JSON - the file is ignored' }] });
});

test('agent-models: a member\'s skills map is not read from below', () =>
{
    const { at, put } = fixture();
    put('ws/.alfred/agents.json', { claude: { skills: { csharp: { model: 'haiku' } } } });
    assert.strictEqual(modelFor({ start: at('ws/api'), env, host: 'claude', kind: 'skills', name: 'csharp' }), null);
    assert.deepStrictEqual(entries({ start: at('ws/api'), env, host: 'claude' }), { applied: [], problems: [] });
    const own = entries({ start: at('ws'), env, host: 'claude' });
    assert.strictEqual(own.applied.length, SKILLS_APPLY ? 1 : 0);
    assert.strictEqual(own.problems.length, SKILLS_APPLY ? 0 : 1);
});

// The review's fix pass: the file is git-ignored under .alfred, so a linked worktree holds no copy of it.
test('agent-models: a linked git worktree reads the main checkout\'s file, its own file first', () =>
{
    const { execFileSync } = require('node:child_process');
    const base = fs.mkdtempSync(path.join(TMP, 'wt-'));
    const main = path.join(base, 'main');
    const wt = path.join(base, 'wt');
    fs.mkdirSync(path.join(main, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(base, 'gitconfig'), '');
    const gitEnv = { PATH: process.env.PATH, HOME: base, GIT_CONFIG_GLOBAL: path.join(base, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
    const git = (...a) => execFileSync('git', a, { cwd: main, env: gitEnv, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(main, '.gitignore'), '.claude/\n.alfred/\n');
    git('add', '.gitignore');
    git('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-q', '-m', 'start');
    fs.writeFileSync(path.join(main, '.claude', 'alfred-code.stamp'), 'sha: x\n');
    const write = (dir, model) => { fs.mkdirSync(path.join(dir, '.alfred'), { recursive: true }); fs.writeFileSync(path.join(dir, '.alfred', 'agents.json'), JSON.stringify({ claude: { agents: { 'aspnet-verifier': { model } } } })); };
    write(main, 'opus');
    git('worktree', 'add', '-q', '-b', 'wt', wt);
    const ask = () => modelFor({ start: wt, env, host: 'claude', kind: 'agents', name: 'aspnet-verifier' });
    assert.ok(!fs.existsSync(path.join(wt, '.alfred')), 'the worktree holds no copy');
    assert.deepStrictEqual(ask(), { model: 'opus', from: 'here' });
    write(wt, 'haiku');
    assert.deepStrictEqual(ask(), { model: 'haiku', from: 'here' }, 'the worktree\'s own file wins');
});

test('agent-models: an entry keyed with the plugin prefix applies under the bare seat name', () =>
{
    const { at, put } = fixture();
    put('ws/.alfred/agents.json', { claude: { agents: { 'alfred-code:aspnet-verifier': { model: 'opus' }, 'alfred-code:bad': { model: 'opus 4' } } } });
    const ask = (name) => modelFor({ start: at('ws'), env, host: 'claude', kind: 'agents', name });
    assert.deepStrictEqual(ask('alfred-code:aspnet-verifier'), { model: 'opus', from: 'here' });
    assert.deepStrictEqual(ask('aspnet-verifier'), { model: 'opus', from: 'here' });
    assert.deepStrictEqual(entries({ start: at('ws'), env, host: 'claude' }), { applied: [{ kind: 'agents', name: 'aspnet-verifier', model: 'opus', from: 'here' }],
        problems: [{ from: 'here', text: `claude.agents.alfred-code:bad: ${MODEL_WORDS}` }] });
});

test('the copy route ships agent-models.js beside the copied hooks', () =>
{
    assert.ok(require('./install/alfred-code.js').HOOK_MODULES.includes('agent-models.js'));
});

// ---- seats at dispatch (Task 2): the dispatch guard spawned on real payloads in a temp project ----
const { spawnSync } = require('node:child_process');
const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const GUARD = path.join(HOOKS, 'guard-unapproved-dispatch.js');
// The agent cap is off here: these cases count no running agents.
const dispatch = (root, toolInput, { env: extra = {}, guard = GUARD, sid = 's1' } = {}) => spawnSync(process.execPath, [guard], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'toolu_x', session_id: sid, cwd: root, tool_input: toolInput }),
    encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root, ALFRED_CODE_MAXIMUM_RUN_AGENTS: '0', ...extra },
});
const updated = (r) => JSON.parse(r.stdout).hookSpecificOutput;
const seatsFile = (seats) => ({ claude: { agents: Object.fromEntries(Object.entries(seats).map(([name, model]) => [name, { model }])) } });
const VERIFY = { subagent_type: 'alfred-code:aspnet-verifier', prompt: 'verify', description: 'd' };

test('dispatch guard: an entry puts its model into updatedInput, with no permission decision', () =>
{
    const { at, put } = fixture();
    put('ws/.alfred/agents.json', seatsFile({ 'aspnet-verifier': 'opus' }));
    const r = dispatch(at('ws'), VERIFY);
    assert.strictEqual(r.status, 0, r.stderr);
    const out = updated(r);
    assert.deepStrictEqual(out.updatedInput, { ...VERIFY, model: 'opus' });
    assert.strictEqual(out.hookEventName, 'PreToolUse');
    assert.strictEqual(out.permissionDecision, undefined);
    assert.strictEqual(updated(dispatch(at('ws/api'), VERIFY)).updatedInput.model, 'opus', 'a child takes the root\'s entry');
});

test('dispatch guard: a dispatch that names a model is left alone', () =>
{
    const { at, put } = fixture();
    put('ws/.alfred/agents.json', seatsFile({ 'aspnet-verifier': 'opus' }));
    const r = dispatch(at('ws'), { ...VERIFY, model: 'haiku' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '');
});

test('dispatch guard: no file, no entry and a garbage file write nothing', () =>
{
    const { at, put, putText } = fixture();
    const quiet = (why) => { const r = dispatch(at('ws'), VERIFY); assert.strictEqual(r.status, 0, why); assert.strictEqual(r.stdout, '', why); };
    quiet('no file');
    put('ws/.alfred/agents.json', seatsFile({ 'console-verifier': 'opus' }));
    quiet('no entry for the seat');
    putText('ws/.alfred/agents.json', '{ not json');
    quiet('garbage');
});

test('dispatch guard: an Explore dispatch carries the prompt change and the model in one updatedInput', () =>
{
    const { at, put } = fixture();
    const input = { subagent_type: 'Explore', prompt: 'find the readers', description: 'd' };
    const plain = updated(dispatch(at('ws'), input)).updatedInput;
    assert.deepStrictEqual(Object.keys(plain), Object.keys(input), 'with no entry: no model key, the fields as today');
    assert.ok(plain.prompt.startsWith('find the readers\n\n') && plain.prompt.length > 100);
    put('ws/.alfred/agents.json', seatsFile({ Explore: 'haiku' }));
    assert.deepStrictEqual(updated(dispatch(at('ws'), input)).updatedInput, { ...input, prompt: plain.prompt, model: 'haiku' });
    assert.deepStrictEqual(updated(dispatch(at('ws'), { ...input, model: 'sonnet' })).updatedInput, { ...input, prompt: plain.prompt, model: 'sonnet' }, 'a named model stays beside the prompt change');
});

test('dispatch guard: each allow exit carries the model', () =>
{
    const receipt = (root, rel, body) => { const file = path.join(root, '.alfred', 'state', ...rel.split('/')); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };
    const now = new Date().toISOString();
    for (const [why, name, input, setUp, sid] of [
        ['Explore', 'Explore', { subagent_type: 'Explore', prompt: 'find the readers' }],
        ['a verifier seat', 'aspnet-verifier', VERIFY],
        ['an implementer with its plan approved', 'aspnet-implementer', { subagent_type: 'alfred-code:aspnet-implementer', prompt: 'plan: plan-1\nbuild task 1' },
            (root) => receipt(root, 'approvals/plan-1/APPROVAL', 'APPROVED plan-1 - "go ahead"\n')],
        ['a generic seat with no stamp', 'general-purpose', { subagent_type: 'general-purpose', prompt: 'write the notes' }],
        ['a generic seat under a run that dispatches generic seats', 'general-purpose', { subagent_type: 'general-purpose', prompt: 'write the bundle' },
            (root) =>
            {
                receipt(root, 'approvals/APPROVAL', `AUTO - "/alfred-code:mode:auto-run on"\nsession: gen-sess\nskill: capture-usage-report\nat: ${now}\n`);
                receipt(root, 'sessions/AUTO-RUN-gen-sess', `skill: capture-usage-report\nprompt: 0123456789ab\nat: ${now}\n`);
            }, 'gen-sess'],
    ])
    {
        const { at, put } = fixture();
        put('ws/.alfred/agents.json', seatsFile({ [name]: 'opus' }));
        if (setUp) setUp(at('ws'));
        const r = dispatch(at('ws'), input, { sid: sid || 's1' });
        assert.strictEqual(r.status, 0, `${why}: ${r.stderr}`);
        assert.strictEqual(updated(r).updatedInput.model, 'opus', why);
    }
});

test('dispatch guard: a block carries nothing', () =>
{
    const { at, put } = fixture();
    put('ws/.alfred/agents.json', seatsFile({ 'aspnet-implementer': 'opus' }));
    const r = dispatch(at('ws'), { subagent_type: 'alfred-code:aspnet-implementer', prompt: 'build task 1' });
    assert.strictEqual(r.status, 2);
    assert.strictEqual(r.stdout, '');
});

test('dispatch guard: the off-list and the minimal profile leave the pin', () =>
{
    const { at, put } = fixture();
    put('ws/.alfred/agents.json', seatsFile({ 'aspnet-verifier': 'opus' }));
    for (const env of [{ ALFRED_CODE_HOOKS_OFF: 'guard-unapproved-dispatch' }, { CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal' }])
    {
        const r = dispatch(at('ws'), VERIFY, { env });
        assert.strictEqual(r.status, 0, JSON.stringify(env));
        assert.strictEqual(r.stdout, '', JSON.stringify(env));
    }
});

test('dispatch guard: a repo never set up leaves the pin on a core implementer too', () =>
{
    const bare = fs.mkdtempSync(path.join(TMP, 'bare-'));
    fs.mkdirSync(path.join(bare, '.alfred'));
    fs.writeFileSync(path.join(bare, '.alfred', 'agents.json'), JSON.stringify(seatsFile({ 'aspnet-implementer': 'opus', 'aspnet-verifier': 'opus' })));
    fs.mkdirSync(path.join(bare, '.alfred', 'state', 'approvals', 'plan-1'), { recursive: true });
    fs.writeFileSync(path.join(bare, '.alfred', 'state', 'approvals', 'plan-1', 'APPROVAL'), 'APPROVED plan-1 - "go ahead"\n');
    for (const subagent_type of ['alfred-code:aspnet-implementer', 'alfred-code:aspnet-verifier'])
    {
        const r = dispatch(bare, { subagent_type, prompt: 'plan: plan-1\nbuild task 1' }, { env: { CLAUDE_PLUGIN_ROOT: path.join(TMP, 'plugin-root') } });
        assert.strictEqual(r.status, 0, `${subagent_type}: ${r.stderr}`);
        assert.strictEqual(r.stdout, '', subagent_type);
    }
});

test('dispatch guard: without agent-models.js beside it the guard runs unchanged', () =>
{
    const dir = fs.mkdtempSync(path.join(TMP, 'bare-'));
    for (const f of fs.readdirSync(HOOKS)) if ((f.endsWith('.js') || f.endsWith('.json')) && f !== 'agent-models.js') fs.copyFileSync(path.join(HOOKS, f), path.join(dir, f));
    const { at, put } = fixture();
    put('ws/.alfred/agents.json', seatsFile({ 'aspnet-verifier': 'opus', Explore: 'opus' }));
    const r = dispatch(at('ws'), VERIFY, { guard: path.join(dir, 'guard-unapproved-dispatch.js') });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '');
    assert.doesNotMatch(r.stderr, /Cannot find module|TypeError|ReferenceError|SyntaxError/);
    const explore = dispatch(at('ws'), { subagent_type: 'Explore', prompt: 'find the readers' }, { guard: path.join(dir, 'guard-unapproved-dispatch.js') });
    assert.strictEqual(Object.hasOwn(updated(explore).updatedInput, 'model'), false, 'the prompt change still goes out, with no model');
});

// ---- skills (Task 4): stage 0's P5 says a skill's `model:` moves no request, so no entry reaches an installed copy ----
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
test('a skills entry changes no SKILL.md', POSIX_ONLY, () =>
{
    assert.strictEqual(SKILLS_APPLY, false, 'with skill entries applied this pin goes and the copy carries the model');
    const copies = (repo) =>
    {
        const dir = path.join(repo, '.claude', 'skills', 'markdown-style');
        return Object.fromEntries(fs.readdirSync(dir, { recursive: true }).map(String).sort()
            .filter((rel) => fs.statSync(path.join(dir, rel)).isFile()).map((rel) => [rel, fs.readFileSync(path.join(dir, rel), 'utf8')]));
    };
    const run = (prepare) => seedRun(['install', 'update'], 'skill markdown-style\nrule alfred-docs-root\n', { prepare, each: copies, scopeDefault: 'project' });
    const plain = run(() => {});
    const named = run((repo) =>
    {
        fs.mkdirSync(path.join(repo, '.alfred'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.alfred', 'agents.json'), JSON.stringify({ claude: { skills: { 'markdown-style': { model: 'haiku' } } } }));
    });
    assert.ok(Object.keys(plain.steps[0]).includes('SKILL.md'));
    assert.doesNotMatch(named.steps[1]['SKILL.md'], /^model:/m);
    assert.deepStrictEqual(named.steps[0], plain.steps[0], 'the install');
    assert.deepStrictEqual(named.steps[1], plain.steps[1], 'the update');
});
