'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load, armHash, resolve, ARMS_DIR } = require('./arms.js');

const COMMON = {
    model: 'claude-sonnet-5',
    effort: 'medium',
    permissionMode: 'acceptEdits',
    settings: 'harness.settings.json',
    env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' },
    graceSec: 10,
    auth: ['ANTHROPIC_API_KEY'],
    scrub: ['CONTEXT7_API_KEY'],
};
const ARM = { name: 'solo', pin: { kind: 'tag', value: 'v1.0.0' }, setup: [['git', 'clone', '{root}', '{src}']], onboarding: ['/init'], expects: ['CLAUDE.md'], env: {} };

function armsDir(t, { common = COMMON, arms = [ARM] } = {})
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-arms-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'common.json'), JSON.stringify(common));
    fs.writeFileSync(path.join(dir, 'harness.settings.json'), JSON.stringify({ sandbox: { enabled: true } }));
    for (const a of arms) fs.writeFileSync(path.join(dir, `${a.name}.json`), JSON.stringify(a));
    return dir;
}

test('the four shipped arm files load against the shared session', () =>
{
    const { session, arms } = load({ dir: ARMS_DIR, names: ['ours', 'ecc', 'bare', 'baseline'] });
    assert.deepStrictEqual(arms.map((a) => a.name), ['ours', 'ecc', 'bare', 'baseline']);
    assert.strictEqual(session.model, 'claude-sonnet-5');
    assert.strictEqual(session.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS, '1');
    // A subscription session gets a 1-hour cache by default and an API key 5 minutes, and the price table
    // bills the two differently: every session is held at 5 minutes so the cost metric does not follow the route.
    assert.strictEqual(session.env.FORCE_PROMPT_CACHING_5M, '1');
    assert.strictEqual(session.env.DISABLE_AUTOUPDATER, '1', 'the allowlisted env drops the shell\'s own switch');
    // dotnet-ef is a local tool (dotnet-tools.json): `dotnet restore` alone never restores it, so a session's
    // own `dotnet tool restore` hit the sandbox's NuGet deny in pilot 2 (all 6 data-01 cells, 403 from the proxy).
    assert.deepStrictEqual(session.restore, [['dotnet', 'restore'], ['dotnet', 'tool', 'restore']], 'the local tool manifest restores at template time too, outside the sandbox');
    // A bare name matches only the bare command: the docs' form is 'docker *'. An excluded command then meets the
    // ordinary permission flow, which nobody answers in print mode, so each hole carries its allow rule too.
    assert.deepStrictEqual(session.settings.sandbox.excludedCommands, ['docker *', 'dotnet *'], 'the two declared holes, both host-equivalent');
    assert.deepStrictEqual(session.settings.permissions.allow, ['Bash(docker *)', 'Bash(dotnet *)']);
    assert.strictEqual(session.settings.sandbox.allowUnsandboxedCommands, false);
    // A compound command (`cd src && docker build . | tail`) runs INSIDE the sandbox, where the Docker socket and
    // Testcontainers need a unix socket: the owner allowed local sockets (AskUserQuestion, 2026-09-26).
    assert.strictEqual(session.settings.sandbox.network.allowAllUnixSockets, true);
    assert.strictEqual(session.env.MSBUILDDISABLENODEREUSE, '1', 'parallel cells never share a build node');
    // A sandboxed 'cd tests && dotnet test' runs inside the macOS sandbox, which admits a loopback connect to
    // 127.0.0.1 but not to the IPv4-mapped address a dual-stack .NET socket dials (vstest aborted after 90 s),
    // and whose second FileSystemWatcher hangs a WebApplicationFactory host. Measured with the CLI's own
    // sandbox runtime: both switches on, 18 unit and 26 integration tests pass inside it.
    assert.strictEqual(session.env.DOTNET_SYSTEM_NET_DISABLEIPV6, '1', 'vstest reaches its testhost over IPv4 loopback');
    assert.strictEqual(session.env.DOTNET_USE_POLLING_FILE_WATCHER, '1', 'a test host starts without a FileSystemWatcher');
    // `dotnet ef` builds its startup project through the muxer next to the running dotnet, never the PATH shim, so
    // MSBuild started a worker node for the Api's parallel project references: the node binds its pipe at
    // /tmp/MSBuild<pid>, the sandbox refuses the bind ('SocketException (13): Permission denied', exit 134), and
    // the parent waits 30 s per launch (pilot 3: every data-02 cell hung 120-302 s). MSBuild reads the env as
    // properties, so every build of every route references its projects one after another, in the one node.
    assert.strictEqual(session.env.BuildInParallel, 'false', 'no build route starts an MSBuild worker node');
    // Every sandboxed dotnet call dialled the telemetry endpoint the sandbox refuses (281 network refusals in ours'
    // flow cells alone), and the model's own fix - an env prefix - is the form print mode refuses.
    assert.strictEqual(session.env.DOTNET_CLI_TELEMETRY_OPTOUT, '1', 'no dotnet call dials its telemetry endpoint');
    assert.strictEqual(session.env.DOTNET_NOLOGO, '1', 'no first-run banner in a session\'s output');
    // ng build aborted (134) inside the sandbox on the unchanged baseline: Angular's persistent build cache opens
    // an lmdb store, lmdb takes a SysV semaphore the sandbox profile refuses, and lmdb's own error path frees an
    // unallocated pointer. Angular keeps that cache off when CI is set - for Bash commands alone, never the CLI.
    assert.deepStrictEqual(session.bashEnv, { CI: 'true' }, 'every Bash command, and nothing else, builds Angular without its disk cache');
    assert.strictEqual(session.env.CI, undefined, 'the CLI, its hooks and its MCP servers never see it');
    // A compose project per cell still published every cell's database on host port 5432: two cells starting it
    // at once collided. The fixture's compose file maps ${LENDING_DB_PORT:-5432}, and the API and the worker read
    // ConnectionStrings:Lending, so each cell gets a free port of its own and a connection string naming it.
    assert.deepStrictEqual(session.cellEnv, { LENDING_DB_PORT: '{port}', ConnectionStrings__Lending: 'Host=localhost;Port={port};Database=lending;Username=lending;Password=lending' }, 'the template lives here, never in code');
    assert.strictEqual(session.settings.sandbox.enabled, true);
    for (const a of arms) assert.match(a.hash, /^[0-9a-f]{64}$/);
});

// A stack's source comes from this repository, whose other branches hold every task's hidden tests and reference
// patches: a clone of it put them in the plugin source every cell runs from (git log --all, the Read grant on src).
// The pinned commit alone is fetched, one commit deep, and checked out - nothing else of this repository.
const PIN_FETCH = ['git init -q {src}', 'git -C {src} fetch --quiet --depth 1 file://{root} {pin}', 'git -C {src} checkout --quiet FETCH_HEAD'];

test('no arm takes more of this repository than its pinned commit', () =>
{
    const { arms } = load({ dir: ARMS_DIR, names: ['ours', 'ecc', 'bare', 'baseline'] });
    for (const a of arms)
    {
        const fromHere = a.setup.filter((s) => s.some((w) => w.includes('{root}')));
        for (const step of fromHere) assert.strictEqual(step.join(' '), PIN_FETCH[1], `${a.name}: '${step.join(' ')}' takes more of this repository than {pin}`);
        if (fromHere.length) assert.deepStrictEqual(a.setup.slice(0, 3).map((s) => s.join(' ')), PIN_FETCH, `${a.name} fetches its pin alone`);
    }
});

test('ours installs the Alfred Code 2.1.2 release by its README route, and onboards through its init', () =>
{
    const { arms: [ours] } = load({ dir: ARMS_DIR, names: ['ours'] });
    // The commit the v2.1.2 tag names, pinned by id: a tag can move, a commit cannot.
    assert.deepStrictEqual(ours.pin, { kind: 'commit', value: 'f57a70a20c3f900741db20cb62265d726de54853' });
    assert.deepStrictEqual(ours.setup.slice(0, 3).map((s) => s.join(' ')), PIN_FETCH, 'the pinned commit alone, never the clone\'s HEAD');
    const at = (argv) => ours.setup.findIndex((s) => s.join(' ') === argv);
    const market = at('claude plugin marketplace add {src}');
    const core = at('claude plugin install alfred-code@envoydev --scope project');
    const installer = ours.setup.findIndex((s) => s[1] === '{src}/scripts/install/alfred-code.js');
    assert.ok(market >= 0 && core > market, 'the core is installed from the pinned clone before anything else of the stack');
    assert.ok(installer > core, 'the installer runs after the core, so it reads the pinned marketplace key rather than adding the published one');
    assert.deepStrictEqual(ours.setup[installer].slice(2), ['install', '--source', '{src}', '--scope', 'project', '--selection', '{template}/selection.txt']);
    assert.deepStrictEqual(ours.onboarding, ['/alfred-code:init']);
    // Nobody answers an ask in print mode: the stack's unattended init takes each recommended option
    // instead - during onboarding only, so no measured cell takes recommended answers on its own.
    assert.deepStrictEqual(ours.onboardingEnv, { ALFRED_CODE_UNATTENDED: '1' });
    assert.deepStrictEqual(ours.env, {});
    assert.deepStrictEqual(ours.expects, ['.alfred/docs/architecture/ARCHITECTURE.md'], 'the architecture capture init runs, under the stack\'s default docs root');
});

test('each shipped arm names its own flow entry per task kind', () =>
{
    const { arms } = load({ dir: ARMS_DIR, names: ['ours', 'ecc', 'bare'] });
    const by = Object.fromEntries(arms.map((a) => [a.name, a.flow]));
    assert.deepStrictEqual(by.ours, {
        feature: ['/alfred-task-solve {prompt}'],
        cross: ['/alfred-task-solve-cross {prompt}'],
        // The diagnoser's close names the build: /alfred-task-solve with the findings file it wrote.
        bug: ['/alfred-issue-diagnoser {prompt}', '/alfred-task-solve {file:.alfred/docs/diagnoses/*.md}'],
    });
    assert.deepStrictEqual(by.ecc, {
        feature: ['/ecc:plan "{prompt}"', '/ecc:tdd-workflow'],
        cross: ['/ecc:plan "{prompt}"', '/ecc:tdd-workflow'],
        bug: ['/ecc:tdd-workflow {prompt}'],
    });
    assert.deepStrictEqual(by.bare, { feature: ['{prompt}'], cross: ['{prompt}'], bug: ['{prompt}'] });
});

// A release that renames a skill or command leaves a slash prompt naming nothing, and the session then
// runs without the flow it was meant to measure. The pinned list (arms/ours-vocabulary.txt) is what the
// release under test ships, so every slash prompt ours sends is held to it.
test('every slash prompt ours sends names a skill or command the pinned release ships', () =>
{
    const { pinnedOurNames } = require('../lint-prompts.js');
    const shipped = new Set(pinnedOurNames(path.join(ARMS_DIR, 'ours-vocabulary.txt')));
    const { arms: [ours] } = load({ dir: ARMS_DIR, names: ['ours'] });
    const prompts = [...ours.onboarding, ...Object.values(ours.flow).flat()];
    const named = prompts.map((p) => /^\/(?:[a-z0-9-]+:)?([a-z0-9-]+)/.exec(p)).filter(Boolean).map((m) => m[1]);
    assert.deepStrictEqual([...new Set(named)].sort(), ['alfred-issue-diagnoser', 'alfred-task-solve', 'alfred-task-solve-cross', 'init']);
    for (const name of named) assert.ok(shipped.has(name), `ours sends /${name}, which the pinned release does not ship`);
});

test('the flow entries stay out of the template key, and carry a key of their own', (t) =>
{
    const session = { model: 'claude-sonnet-5', effort: 'medium', permissionMode: 'acceptEdits', settings: {} };
    const FLOW = { feature: ['/go {prompt}'], cross: ['{prompt}'], bug: ['{prompt}', 'then build'] };
    assert.strictEqual(armHash({ ...ARM, flow: FLOW }, session), armHash(ARM, session), 'a flow prompt never rebuilds a template');
    const [plain] = load({ dir: armsDir(t), names: ['solo'] }).arms;
    const [flowing] = load({ dir: armsDir(t, { arms: [{ ...ARM, flow: FLOW }] }), names: ['solo'] }).arms;
    const [other] = load({ dir: armsDir(t, { arms: [{ ...ARM, flow: { ...FLOW, bug: ['{prompt}'] } }] }), names: ['solo'] }).arms;
    assert.strictEqual(plain.flow, null);
    assert.strictEqual(plain.flowHash, null);
    assert.deepStrictEqual(flowing.flow, FLOW);
    assert.match(flowing.flowHash, /^[0-9a-f]{64}$/);
    assert.notStrictEqual(other.flowHash, flowing.flowHash, 'a changed flow prompt changes the flow key');
    assert.strictEqual(flowing.hash, plain.hash);
});

test('a malformed flow is refused, by kind', (t) =>
{
    const ok = { feature: ['{prompt}'], cross: ['{prompt}'], bug: ['{prompt}'] };
    const cases = [
        ['{prompt}', /solo: flow is not a map of task kinds/],
        [{ ...ok, epic: ['{prompt}'] }, /solo: flow names an unknown kind 'epic'/],
        [{ feature: ok.feature, cross: ok.cross }, /solo: flow names no entry for kind 'bug'/],
        [{ ...ok, bug: [] }, /solo: flow bug is not a list of prompts/],
        [{ ...ok, bug: ['{prompt}', 3] }, /solo: flow bug is not a list of prompts/],
        [{ ...ok, bug: ['fix it'] }, /solo: flow bug never sends the task's \{prompt\}/],
        [{ ...ok, bug: ['{prompt} in {repo}'] }, /solo: flow bug uses an unknown placeholder \{repo\}/],
        [{ ...ok, bug: ['{prompt}', 'go {file:../x.md}'] }, /solo: flow bug names a file outside the clone/],
        [{ ...ok, bug: ['{prompt}', 'go {file:/etc/x.md}'] }, /solo: flow bug names a file outside the clone/],
        [{ ...ok, bug: ['{prompt}', 'go {file:a/*/x.md}'] }, /solo: flow bug names a file pattern with a wildcard above its last part/],
    ];
    for (const [flow, why] of cases) assert.throws(() => load({ dir: armsDir(t, { arms: [{ ...ARM, flow }] }), names: ['solo'] }), why, JSON.stringify(flow));
    const fine = { ...ok, bug: ['{prompt}', 'go {file:.docs/diagnoses/*.md}'] };
    assert.deepStrictEqual(load({ dir: armsDir(t, { arms: [{ ...ARM, flow: fine }] }), names: ['solo'] }).arms[0].flow, fine);
});

test('an onboarding-only env is validated like env and enters the template key', (t) =>
{
    const session = { model: 'claude-sonnet-5', effort: 'medium', permissionMode: 'acceptEdits', settings: {} };
    assert.notStrictEqual(armHash({ ...ARM, onboardingEnv: { X: '1' } }, session), armHash(ARM, session));
    assert.strictEqual(armHash({ ...ARM, onboardingEnv: {} }, session), armHash(ARM, session), 'absent and empty are the same template');
    const [arm] = load({ dir: armsDir(t, { arms: [{ ...ARM, onboardingEnv: { X: '1' } }] }), names: ['solo'] }).arms;
    assert.deepStrictEqual([arm.onboardingEnv, arm.env], [{ X: '1' }, {}]);
    assert.deepStrictEqual(load({ dir: armsDir(t), names: ['solo'] }).arms[0].onboardingEnv, {});
    assert.throws(() => load({ dir: armsDir(t, { arms: [{ ...ARM, onboardingEnv: { X: 1 } }] }), names: ['solo'] }), /solo: onboardingEnv is not a map of strings/);
    for (const key of ['HOME', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS'])
    {
        assert.throws(() => load({ dir: armsDir(t, { arms: [{ ...ARM, onboardingEnv: { [key]: '1' } }] }), names: ['solo'] }), new RegExp(`solo: onboardingEnv ${key} is the harness's`));
    }
    assert.throws(() => load({ dir: armsDir(t, { arms: [{ ...ARM, onboardingEnv: { X: '{run}' } }] }), names: ['solo'] }), /solo: unknown placeholder \{run\}/);
});

test('every shipped arm with an onboarding names what it must leave behind', () =>
{
    const { arms } = load({ dir: ARMS_DIR, names: ['ours', 'ecc', 'bare', 'baseline'] });
    const by = Object.fromEntries(arms.map((a) => [a.name, a.expects]));
    assert.deepStrictEqual(by, {
        ours: ['.alfred/docs/architecture/ARCHITECTURE.md'], ecc: ['CLAUDE.md'], bare: ['CLAUDE.md'], baseline: ['.claude/docs/architecture/ARCHITECTURE.md'],
    });
});

test('an onboarding with no expected output, or an expected path that leaves the clone, is refused', (t) =>
{
    const { expects, ...none } = ARM;
    assert.ok(expects);
    assert.throws(() => load({ dir: armsDir(t, { arms: [none] }), names: ['solo'] }), /solo: onboarding names no expected output/);
    for (const bad of [['/abs/CLAUDE.md'], ['../CLAUDE.md'], ['a/../../b'], [''], 'CLAUDE.md'])
    {
        assert.throws(() => load({ dir: armsDir(t, { arms: [{ ...ARM, expects: bad }] }), names: ['solo'] }), /solo: expects /, JSON.stringify(bad));
    }
    const quiet = { ...none, onboarding: [] };
    assert.deepStrictEqual(load({ dir: armsDir(t, { arms: [quiet] }), names: ['solo'] }).arms[0].expects, [], 'no onboarding, nothing expected');
});

test('the expected outputs are part of the template key', () =>
{
    const session = { model: 'claude-sonnet-5', effort: 'medium', permissionMode: 'acceptEdits', settings: {} };
    assert.notStrictEqual(armHash({ ...ARM, expects: ['other.md'] }, session), armHash(ARM, session));
});

test('baseline stays on v1.0.0 and its own installer', () =>
{
    const { arms: [baseline] } = load({ dir: ARMS_DIR, names: ['baseline'] });
    assert.deepStrictEqual(baseline.pin, { kind: 'tag', value: 'v1.0.0' });
    assert.ok(baseline.setup.some((s) => s[1] === '{src}/scripts/install/claude-stack.js'));
});

test('ecc is pinned to a named commit, never to a release a later tag could move', () =>
{
    const { arms: [ecc] } = load({ dir: ARMS_DIR, names: ['ecc'] });
    assert.deepStrictEqual(ecc.pin, { kind: 'commit', value: 'e482e579415fde18357cafce70f177ae19fd7f03' });
    assert.ok(ecc.setup.some((s) => s.join(' ') === 'git -C {src} checkout --quiet {pin}'));
});

test('ecc stores its hook options the way its own setup does, never through an env its users do not have', () =>
{
    const { arms: [ecc] } = load({ dir: ARMS_DIR, names: ['ecc'] });
    assert.ok(ecc.setup.some((s) => s.join(' ') === 'claude plugin install ecc@ecc --scope user --config hooks_enabled=true --config hook_profile=standard'));
    assert.deepStrictEqual(ecc.env, {});
});

test('an arm cannot set either spelling of the stack docs-path variable', () =>
{
    const { session } = load({ dir: ARMS_DIR, names: ['bare'] });
    for (const name of ['CLAUDE_STACK_DOCS_PATH', 'ALFRED_CODE_DOCS_PATH']) assert.ok(session.scrub.includes(name), name);
});

test('an arm naming a model, an effort or a permission mode is refused, by name', (t) =>
{
    for (const key of ['model', 'effort', 'permissionMode'])
    {
        const dir = armsDir(t, { arms: [{ ...ARM, [key]: 'x' }] });
        assert.throws(() => load({ dir, names: ['solo'] }), new RegExp(`solo.*${key}.*common\\.json`));
    }
});

test('a missing field is named', (t) =>
{
    for (const key of ['pin', 'setup', 'onboarding'])
    {
        const arm = { ...ARM };
        delete arm[key];
        const dir = armsDir(t, { arms: [arm] });
        assert.throws(() => load({ dir, names: ['solo'] }), new RegExp(`solo: missing ${key}`));
    }
    const dir = armsDir(t, { common: { ...COMMON, model: undefined } });
    assert.throws(() => load({ dir, names: ['solo'] }), /common\.json: missing model/);
});

test('an unknown key, a bad setup step and a name that is not the file are refused', (t) =>
{
    assert.throws(() => load({ dir: armsDir(t, { arms: [{ ...ARM, sttup: [] }] }), names: ['solo'] }), /solo: unknown key sttup/);
    assert.throws(() => load({ dir: armsDir(t, { arms: [{ ...ARM, setup: ['git clone x'] }] }), names: ['solo'] }), /solo: setup\[0\] is not a command/);
    const dir = armsDir(t);
    fs.writeFileSync(path.join(dir, 'other.json'), JSON.stringify(ARM));
    assert.throws(() => load({ dir, names: ['other'] }), /other\.json: name is 'solo'/);
    assert.throws(() => load({ dir, names: ['nope'] }), /no arm 'nope'/);
});

test('an arm env cannot override what the harness or common.json owns', (t) =>
{
    for (const key of ['CLAUDE_CONFIG_DIR', 'HOME', 'TMPDIR', 'CLAUDE_CODE_TMPDIR', 'PATH', 'UV_CACHE_DIR', 'UV_PYTHON_INSTALL_DIR', 'COMPOSE_PROJECT_NAME', 'CLAUDE_ENV_FILE', 'ANTHROPIC_API_KEY', 'CONTEXT7_API_KEY', 'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS'])
    {
        const dir = armsDir(t, { arms: [{ ...ARM, env: { [key]: '1' } }] });
        assert.throws(() => load({ dir, names: ['solo'] }), new RegExp(`solo: env ${key} is the harness's`));
    }
});

test('the template key follows the shared env and the restore steps, so a changed one rebuilds the template', () =>
{
    const session = { model: 'claude-sonnet-5', effort: 'medium', permissionMode: 'acceptEdits', settings: {}, env: { A: '1' }, restore: [['dotnet', 'restore']] };
    const h = armHash(ARM, session);
    assert.notStrictEqual(armHash(ARM, { ...session, env: { A: '2' } }), h);
    assert.notStrictEqual(armHash(ARM, { ...session, restore: [] }), h);
    assert.notStrictEqual(armHash(ARM, { ...session, bashEnv: { CI: 'true' } }), h, 'onboarding runs Bash too');
    assert.notStrictEqual(armHash(ARM, { ...session, cellEnv: { P: '{port}' } }), h, 'a resume refuses a changed cell env');
});

test('common.json cellEnv is a map of strings whose one placeholder is the cell\'s own {port}, and an arm env cannot set one of them', (t) =>
{
    assert.deepStrictEqual(load({ dir: armsDir(t), names: [] }).session.cellEnv, {});
    assert.deepStrictEqual(load({ dir: armsDir(t, { common: { ...COMMON, cellEnv: { P: '{port}' } } }), names: [] }).session.cellEnv, { P: '{port}' });
    for (const bad of [['P'], { P: 1 }]) assert.throws(() => load({ dir: armsDir(t, { common: { ...COMMON, cellEnv: bad } }), names: [] }), /common\.json: cellEnv is not a map of strings/);
    assert.throws(() => load({ dir: armsDir(t, { common: { ...COMMON, cellEnv: { P: '{host}' } } }), names: [] }), /common\.json: cellEnv P uses \{host\} - a cell's env knows \{port\} alone/);
    const dir = armsDir(t, { common: { ...COMMON, cellEnv: { P: '{port}' } }, arms: [{ ...ARM, env: { P: '1' } }] });
    assert.throws(() => load({ dir, names: ['solo'] }), /solo: env P is the harness's/);
});

test('common.json bashEnv is a map of shell names to strings, absent meaning none, and an arm env cannot set one of them', (t) =>
{
    assert.deepStrictEqual(load({ dir: armsDir(t), names: [] }).session.bashEnv, {});
    assert.deepStrictEqual(load({ dir: armsDir(t, { common: { ...COMMON, bashEnv: { CI: 'true' } } }), names: [] }).session.bashEnv, { CI: 'true' });
    for (const bad of [['CI'], { CI: true }, { 'NOT-A-NAME': 'x' }, { '1X': 'x' }]) assert.throws(() => load({ dir: armsDir(t, { common: { ...COMMON, bashEnv: bad } }), names: [] }), /common\.json: bashEnv is not a map of shell variable names to strings/);
    const dir = armsDir(t, { common: { ...COMMON, bashEnv: { CI: 'true' } }, arms: [{ ...ARM, env: { CI: '1' } }] });
    assert.throws(() => load({ dir, names: ['solo'] }), /solo: env CI is the harness's/);
});

test('common.json restore is a list of commands, absent meaning none', (t) =>
{
    assert.deepStrictEqual(load({ dir: armsDir(t), names: [] }).session.restore, []);
    assert.deepStrictEqual(load({ dir: armsDir(t, { common: { ...COMMON, restore: [['npm', 'ci']] } }), names: [] }).session.restore, [['npm', 'ci']]);
    for (const bad of ['npm ci', [['npm', 3]], [[]]]) assert.throws(() => load({ dir: armsDir(t, { common: { ...COMMON, restore: bad } }), names: [] }), /common\.json: restore is not a list of commands/);
});

test('the pin hash changes with the pin value and the session, never with a note', () =>
{
    const session = { model: 'claude-sonnet-5', effort: 'medium', permissionMode: 'acceptEdits', settings: {} };
    const h = armHash(ARM, session);
    assert.notStrictEqual(armHash({ ...ARM, pin: { kind: 'tag', value: 'v1.0.1' } }, session), h);
    assert.notStrictEqual(armHash(ARM, { ...session, model: 'claude-opus-5-5' }), h);
    assert.strictEqual(armHash({ _note: 'why', ...ARM }, session), h);
    assert.strictEqual(armHash({ env: {}, expects: ['CLAUDE.md'], onboarding: ['/init'], setup: ARM.setup, pin: ARM.pin, name: 'solo' }, session), h);
});

test('a run-level override replaces model and effort for every arm, and is validated', (t) =>
{
    const dir = armsDir(t);
    const base = load({ dir, names: ['solo'] });
    const opus = load({ dir, names: ['solo'], override: { model: 'claude-opus-5-5', effort: 'high' } });
    assert.strictEqual(opus.session.model, 'claude-opus-5-5');
    assert.strictEqual(opus.session.effort, 'high');
    assert.notStrictEqual(opus.arms[0].hash, base.arms[0].hash);
    assert.throws(() => load({ dir, names: ['solo'], override: { effort: 'huge' } }), /effort 'huge'/);
});

test('an arm using a placeholder the template does not define is refused at load', (t) =>
{
    const dir = armsDir(t, { arms: [{ ...ARM, setup: [['cp', '{run}/x', '{src}']] }] });
    assert.throws(() => load({ dir, names: ['solo'] }), /solo: unknown placeholder \{run\}/);
});

test('resolve fills every placeholder in strings, arrays and objects, and names an unknown one', () =>
{
    const vars = { src: '/t/src', repo: '/t/repo' };
    assert.deepStrictEqual(resolve([['git', '-C', '{src}', 'log'], { cwd: '{repo}' }], vars), [['git', '-C', '/t/src', 'log'], { cwd: '/t/repo' }]);
    assert.strictEqual(resolve('{src}/a/{src}', vars), '/t/src/a//t/src');
    assert.throws(() => resolve('{home}/x', vars), /unknown placeholder \{home\}/);
});
