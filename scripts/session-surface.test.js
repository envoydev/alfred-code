'use strict';
// THE SESSION SURFACE MAPS WHAT A FRESH SESSION IS SENT - per load point and owner, on synthetic installs: the
// project's files, an account dir with a plugin registry, a marketplace and cached plugins whose hooks are tiny
// node scripts. The real-install run is the temp-project matrix's; these pin the rules the map is built by.
const test = require('node:test');
const { isolateHookSuite } = require('./hook-test-env.js');
isolateHookSuite({ ownTmp: true });
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { surface, matches, main } = require('./session-surface.js');

const INVENTORY = {
    skills: new Set(['house-skill', 'manual-skill']),
    rules: new Set(['alfred-git', 'ts-conventions']),
    generated: new Set(['alfred-agent-awareness']),
    plugins: new Set(['claude-hud']),
};
const roots = [];
test.after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

function write(root, files)
{
    for (const [rel, body] of Object.entries(files))
    {
        const p = path.join(root, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
    }
}
const skill = (name, description, extra = '') => `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n# ${name}\n\nBody of ${name}.\n`;
const agent = (name, description, tools = 'Read, Grep') => `---\nname: ${name}\ndescription: ${description}\ntools: ${tools}\n---\n\nYou are ${name}.\n`;
// A hook that prints `context` as additionalContext for the event it is handed.
const hookScript = (context, extra = '') => `${extra}\nlet s='';process.stdin.on('data',(d)=>{s+=d;});process.stdin.on('end',()=>{const p=JSON.parse(s);`
    + `process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:p.hook_event_name,additionalContext:${JSON.stringify(context)}}}));});\n`;

// One install: `project/` and `acct/`; `plugins` maps a spec to { files, entry } - the cache copy and its marketplace entry.
function install({ project = {}, account = {}, plugins = {}, enabled = {} } = {})
{
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'surface-')));
    roots.push(root);
    const proj = path.join(root, 'project');
    const acct = path.join(root, 'acct');
    fs.mkdirSync(proj, { recursive: true });
    fs.mkdirSync(acct, { recursive: true });
    const registry = { version: 2, plugins: {} };
    const markets = {};
    const catalogs = {};
    for (const [spec, p] of Object.entries(plugins))
    {
        const [name, market] = spec.split('@');
        const cache = path.join(acct, 'plugins', 'cache', market, name, '1.0.0');
        fs.mkdirSync(cache, { recursive: true });
        write(cache, p.files || {});
        registry.plugins[spec] = [{ scope: p.scope || 'project', projectPath: proj, installPath: cache, version: '1.0.0' }];
        markets[market] = { source: { source: 'directory', path: path.join(acct, 'mp', market) }, installLocation: path.join(acct, 'mp', market) };
        (catalogs[market] = catalogs[market] || []).push({ name, source: './', ...(p.entry || {}) });
    }
    for (const [market, list] of Object.entries(catalogs)) write(path.join(acct, 'mp', market), { '.claude-plugin/marketplace.json': { name: market, plugins: list } });
    write(acct, { 'plugins/installed_plugins.json': registry, 'plugins/known_marketplaces.json': markets, ...account });
    const settings = project['.claude/settings.json'];
    const enabledPlugins = Object.fromEntries(Object.keys(plugins).filter((s) => !(plugins[s].scope === 'user')).map((s) => [s, true]));
    write(proj, { ...project, ...(typeof settings === 'string' ? {} : { '.claude/settings.json': { enabledPlugins: { ...enabledPlugins, ...enabled }, ...(settings || {}) } }) });
    return { root, proj, acct, run: (opts = {}) => surface(proj, { configDir: acct, inventory: INVENTORY, home: root, ...opts }) };
}
// main() prints the map; the suite's own stdout stays the runner's.
function quiet(fn)
{
    const [out, err] = [process.stdout.write, console.error];
    process.stdout.write = () => true;
    console.error = () => {};
    try { return fn(); }
    finally { process.stdout.write = out; console.error = err; }
}
const rowsAt = (s, point) => s.rows.filter((r) => r.loadPoint === point);
const flagsOf = (s, kind) => s.flags.filter((f) => f.kind === kind);

test('a matcher is a name, a | list or a regex; empty and * match everything', () =>
{
    assert.ok(matches(undefined, 'Bash') && matches('', 'Read') && matches('*', 'Write'));
    assert.ok(matches('Bash|PowerShell', 'PowerShell'));
    assert.ok(!matches('Bash|PowerShell', 'Bash2'), 'a | list is exact names, never a prefix');
    assert.ok(matches('^mcp__.*__browser_file_upload$', 'mcp__chrome-control__browser_file_upload'));   // mcp-fixture: a matcher test, no server is called
    assert.ok(!matches('[unclosed', 'Bash'), 'a broken regex matches nothing rather than throwing');
    assert.ok(matches('Write, Edit', 'Edit'), 'a comma list with spaces is exact names too');
    assert.ok(matches('Edit.*', 'NotebookEdit'), 'a regex is unanchored, as the docs say');
    assert.ok(matches('nothing-like-it', 'any prompt', 'UserPromptSubmit'), 'an event with no matcher support ignores the field');
});

test('a fresh install: rules, listings and seats land at their load points, each with its owner', () =>
{
    const fx = install({
        project: {
            '.claude/rules/alfred-git.md': '---\ndescription: git\n---\n<!-- maintainer note -->\nCommit only on the user\'s word.\n',
            '.claude/rules/ts-conventions.md': '---\npaths:\n  - "**/*.ts"\n---\nLoad `house-skill` before editing.\n',
            '.claude/rules/alfred-agent-awareness.md': 'The capabilities map.\n',
            '.claude/rules/my-own.md': 'A rule the project wrote.\n',
            '.claude/skills/house-skill/SKILL.md': skill('house-skill', 'Use when testing the map.'),
            '.claude/skills/manual-skill/SKILL.md': skill('manual-skill', 'Use when typed.', 'disable-model-invocation: true\n'),
            '.claude/AGENTS.md': '# Project\n\nThe build is npm run build.\n',
        },
        plugins: {
            'alfred-code@envoydev': {
                files: { 'agents/reviewer.md': agent('reviewer', 'Use when reviewing.'), 'agents/off.md': agent('off', 'Use never.'), 'skills/core/SKILL.md': skill('core', 'Use when routing.') },
                entry: { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/guard.js"', timeout: 5 }] }] } },
            },
        },
    });
    const settingsFile = path.join(fx.proj, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    settings.permissions = { deny: ['Agent(alfred-code:off)'] };
    fs.writeFileSync(settingsFile, JSON.stringify(settings));
    const s = fx.run();

    const start = rowsAt(s, 'session-start');
    const rule = start.find((r) => r.source === '.claude/rules/alfred-git.md');
    assert.equal(rule.owner, 'house');
    assert.equal(rule.chars, "Commit only on the user's word.".length, 'frontmatter and HTML comments are not sent');
    assert.equal(start.find((r) => r.source.endsWith('alfred-agent-awareness.md')).owner, 'generated');
    assert.equal(start.find((r) => r.source.endsWith('my-own.md')).owner, 'project');
    assert.equal(start.find((r) => r.source === '.claude/AGENTS.md').owner, 'generated', 'the stack seeds AGENTS.md');
    const scoped = rowsAt(s, 'path-scoped');
    assert.equal(scoped.length, 1);
    assert.match(scoped[0].note, /paths \*\*\/\*\.ts - names house-skill/);
    assert.ok(!start.some((r) => r.source.endsWith('ts-conventions.md')), 'a path-scoped rule is not sent at session start');

    const listing = start.filter((r) => r.listing === 'skill');
    assert.deepEqual(listing.map((r) => r.note.replace(/^skill listing /, '')).sort(), ['alfred-code:core', 'house-skill']);
    assert.equal(s.totals.skillListing.manualOnly, 1, 'a manual-only skill is left out of the listing and counted');
    const seats = start.filter((r) => r.listing === 'agent');
    assert.deepEqual(seats.map((r) => r.source), ['alfred-code:reviewer'], 'a denied seat leaves the listing');
    assert.equal(seats[0].chars, 'alfred-code:reviewer'.length + 'Use when reviewing.'.length + ' (Tools: Read, Grep)'.length);
    assert.equal(s.totals.agentListing.denied, 1);
    const tool = rowsAt(s, 'per-tool');
    assert.equal(tool.length, 1);
    assert.match(tool[0].note, /PreToolUse Bash - may deny, timeout 5/);
    assert.ok(s.notMeasured.some((n) => /not run/.test(n)), 'without --run-hooks the hook output is named as not measured');
    assert.deepEqual(s.writes, { project: [], stray: [] }, 'a static run writes nothing');
});

test("the user's own hook and MCP server stay the project's; a shared event and a shared endpoint are flagged", () =>
{
    const server = { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server.js'] };
    const fx = install({
        project: { '.claude/settings.json': { hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: 'node my-hook.js' }] }] } } },
        plugins: { 'alfred-code@envoydev': { entry: { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node guard.js' }] }] }, mcpServers: { nav: server } } } },
    });
    const cache = path.join(fx.acct, 'plugins', 'cache', 'envoydev', 'alfred-code', '1.0.0');
    write(fx.proj, { '.mcp.json': { mcpServers: { 'my-nav': { command: 'node', args: [`${cache}/server.js`] } } } });
    const s = fx.run();
    const mine = rowsAt(s, 'per-tool').find((r) => r.source === 'my-hook.js');
    assert.equal(mine.owner, 'project');
    assert.match(mine.note, /timeout default/, 'an untimed hook is named as running on the default');
    const shared = flagsOf(s, 'shared-event');
    assert.equal(shared.length, 1);
    assert.match(shared[0].detail, /^PreToolUse Bash: wired by house, project/, 'only the tool both matchers take is shared');
    const ep = flagsOf(s, 'mcp-endpoint');
    assert.equal(ep.length, 1);
    assert.match(ep[0].detail, /my-nav \(project \(\.mcp\.json\)\) and nav \(plugin alfred-code@envoydev\)/);
    assert.ok(!ep[0].detail.includes(fx.acct), 'no machine path in a flag');
    assert.match(ep[0].detail, /~config\/plugins\/cache/);
});

test('an empty project maps to no rows and exits 0', () =>
{
    const fx = install();
    fs.rmSync(path.join(fx.proj, '.claude'), { recursive: true, force: true });
    const s = fx.run();
    assert.equal(s.rows.length, 0);
    assert.equal(s.flags.length, 0);
    assert.equal(quiet(() => main([fx.proj, '--config-dir', fx.acct, '--json'])), 0);
});

test('malformed settings JSON is flagged unreadable and read as empty, never a crash', () =>
{
    const fx = install({ project: { '.claude/settings.json': '{ "enabledPlugins": ' } });
    write(fx.proj, { '.mcp.json': 'not json' });
    const s = fx.run();
    const bad = flagsOf(s, 'unreadable');
    assert.equal(bad.length, 2);
    assert.match(bad[0].detail, /project settings \(\.claude\/settings\.json\) is not valid JSON/);
    assert.match(bad[1].detail, /\.mcp\.json is not valid JSON/);
});

test('an enabled plugin missing from the cache is a dangling row of its own', () =>
{
    const fx = install({ enabled: { 'ghost@envoydev': true } });
    assert.match(flagsOf(fx.run(), 'dangling')[0].detail, /ghost@envoydev is enabled \(project\) but not in the plugin cache/);
});

test("a seat granted a server the install does not run is a dangling cite; a hidden plugin's server is not", () =>
{
    const server = { command: 'node', args: ['server.js'] };
    const fx = install({
        account: { 'settings.json': { enabledPlugins: { 'theirs@elsewhere': true } } },
        plugins: {
            'alfred-code@envoydev': { files: {
                'agents/gatherer.md': agent('gatherer', 'Use when gathering.', 'Read, mcp__plugin_nav_nav, mcp__plugin_nav_nav__find_symbol, mcp__plugin_chrome-control_chrome-control, mcp__plugin_theirs_srv'),   // mcp-fixture: the suite's own servers, none is called
                'agents/plain.md': agent('plain', 'Use when reading.'),
            } },
            'nav@envoydev': { entry: { mcpServers: { nav: server } } },
            'theirs@elsewhere': { scope: 'user', entry: { mcpServers: { srv: server } } },
        },
    });
    const dangling = flagsOf(fx.run(), 'dangling');
    assert.equal(dangling.length, 1, 'one flag per seat, and none for a seat whose grants all resolve');
    assert.equal(dangling[0].detail, 'seat alfred-code:gatherer is granted mcp__plugin_chrome-control_chrome-control - no such server in this install');
});

test('--run-hooks captures each injection at its load point; a turn is one prompt, not the samples summed', () =>
{
    const fx = install({
        plugins: {
            'alfred-code@envoydev': {
                files: { 'hooks/start.js': hookScript('The memory tag is project:x.'), 'hooks/turn.js': hookScript('Keep answers short.') },
                entry: { hooks: {
                    SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/start.js"', timeout: 10 }] }],
                    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/turn.js"', timeout: 10 }] }],
                    Stop: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/turn.js"' }] }],
                } },
            },
        },
    });
    const s = fx.run({ runHooks: true });
    const start = rowsAt(s, 'session-start').find((r) => r.source === 'start.js');
    assert.equal(start.chars, 'The memory tag is project:x.'.length);
    assert.match(start.note, /SessionStart:startup - exit 0/);
    assert.equal(rowsAt(s, 'compaction').filter((r) => r.source === 'start.js').length, 0, "a 'startup' matcher does not run after compaction");
    assert.equal(rowsAt(s, 'per-turn').length, 2, 'one row per sample prompt');
    assert.equal(s.totals.perLoadPoint['per-turn'], 'Keep answers short.'.length);
    assert.match(rowsAt(s, 'stop')[0].note, /Stop - may block the stop/, 'a Stop hook is listed, never run');
    assert.deepEqual(s.writes.stray, []);
});

test('a hook past its timeout is flagged, never waited out', () =>
{
    const fx = install({
        plugins: { 'alfred-code@envoydev': {
            files: { 'hooks/slow.js': 'setTimeout(() => {}, 5000);\n' },
            entry: { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/slow.js"', timeout: 1 }] }] } },
        } },
    });
    const started = Date.now();
    const s = fx.run({ runHooks: true });
    assert.ok(Date.now() - started < 4500, 'the probe stops at the hook timeout');
    assert.match(flagsOf(s, 'hook-timeout')[0].detail, /slow\.js on SessionStart:startup ran past 1s/);
});

test('a hook that writes outside the project fails the run; one that writes inside is listed', () =>
{
    const fx = install({
        plugins: { 'alfred-code@envoydev': {
            files: { 'hooks/leak.js': hookScript('', `require('fs').writeFileSync(process.env.CLAUDE_CONFIG_DIR + '/leak.txt', 'x');require('fs').mkdirSync('.alfred/docs',{recursive:true});require('fs').writeFileSync('.alfred/docs/ledger.jsonl','x');`) },
            entry: { hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/leak.js"', timeout: 10 }] }] } },
        } },
    });
    const s = fx.run({ runHooks: true, configDir: fx.acct });
    assert.deepEqual(s.writes.project, [path.join('.alfred', 'docs', 'ledger.jsonl')]);
    assert.equal(s.writes.stray.length, 1);
    assert.match(flagsOf(s, 'stray-write')[0].detail, /~config\/leak\.txt/);
    fs.rmSync(path.join(fx.acct, 'leak.txt'));
    assert.equal(quiet(() => main([fx.proj, '--config-dir', fx.acct, '--run-hooks'])), 1);
});

test('--with-user shows the user memory, skills and plugins; without it they are only counted', () =>
{
    const fx = install({
        account: { 'CLAUDE.md': 'My own global note.\n', 'skills/mine/SKILL.md': skill('mine', 'Use when it is mine.'), 'settings.json': { enabledPlugins: { 'theirs@elsewhere': true } } },
        plugins: { 'theirs@elsewhere': { scope: 'user', files: { 'skills/x/SKILL.md': skill('x', 'Use when x.') } } },
    });
    const off = fx.run();
    assert.ok(!off.rows.some((r) => r.owner === 'user'));
    assert.ok(off.notMeasured.some((n) => /1 plugin\(s\) enabled outside the stack/.test(n)));
    const on = fx.run({ withUser: true });
    const user = on.rows.filter((r) => r.owner === 'user').map((r) => r.source).sort();
    assert.deepEqual(user, ['theirs:skills/x/SKILL.md', '~config/CLAUDE.md', '~config/skills/mine/SKILL.md']);
});

test('the listing budget: at, one under and one over', () =>
{
    // window 1000 tokens x 0.01 x 4 chars = 40; an entry costs its listed name plus its description.
    const at = (descLength) => install({ project: { '.claude/skills/ab/SKILL.md': skill('ab', 'x'.repeat(descLength)) } }).run({ window: 1000, listingFraction: 0.01 });
    const exact = at(38);
    assert.equal(exact.totals.skillListing.chars, 40);
    assert.equal(exact.totals.skillListing.status, 'at');
    assert.equal(flagsOf(exact, 'listing-budget').length, 0);
    assert.equal(at(37).totals.skillListing.status, 'within');
    const over = at(39);
    assert.equal(over.totals.skillListing.status, 'over');
    assert.match(flagsOf(over, 'listing-budget')[0].detail, /41 chars is over the 40 budget/);
    assert.ok(exact.notMeasured.some((n) => /bundled skills share the 40-char listing budget and are not counted - 'at' is the stack's/.test(n)),
        "the harness's own skills are named as outside the count");
    const none = install().run({ window: 1000 });
    assert.equal(none.totals.skillListing.status, 'not computed', 'no fraction, no figure');
    assert.ok(!none.notMeasured.some((n) => /bundled skills/.test(n)), 'no budget, no line about it');
});

test('a long description is counted at the listing truncation, not its length', () =>
{
    const s = install({ project: { '.claude/skills/ab/SKILL.md': skill('ab', 'x'.repeat(2000)) } }).run();
    assert.equal(s.totals.skillListing.chars, 1536 + 2);
});

test('an injection that repeats a rule is flagged as paid twice', () =>
{
    const sentence = 'Never commit a change unless the user has named the commit in this turn.';
    const fx = install({
        project: { '.claude/rules/alfred-git.md': `${sentence}\n` },
        plugins: { 'alfred-code@envoydev': {
            files: { 'hooks/echo.js': hookScript(sentence) },
            entry: { hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/echo.js"', timeout: 10 }] }] } },
        } },
    });
    const s = fx.run({ runHooks: true });
    const overlap = flagsOf(s, 'injection-overlap');
    assert.equal(overlap.length, 1);
    assert.ok(overlap[0].detail.includes('hook:house:echo.js:SessionStart') && overlap[0].detail.includes('rule:.claude/rules/alfred-git.md'), overlap[0].detail);
});

test('a bare name beside a namespaced one shadows it; two namespaces sharing a name only overlap', () =>
{
    const fx = install({
        project: { '.claude/skills/setup/SKILL.md': skill('setup', 'Use when setting up mine.') },
        plugins: {
            'alfred-code@envoydev': { files: { 'commands/setup.md': '---\ndescription: Set up the stack.\n---\nGo.\n' } },
            'claude-hud@claude-hud': { files: { 'commands/setup.md': '---\ndescription: Set up the HUD.\n---\nGo.\n' } },
        },
    });
    const s = fx.run();
    assert.equal(flagsOf(s, 'name-shadow').length, 1, 'the project skill shadows');
    assert.equal(s.rows.find((r) => r.note === 'skill listing claude-hud:setup').owner, 'plugin:claude-hud', 'a plugin the stack installs is its own owner');
    const two = install({ plugins: {
        'alfred-code@envoydev': { files: { 'commands/setup.md': '---\ndescription: a\n---\n' } },
        'claude-hud@claude-hud': { files: { 'commands/setup.md': '---\ndescription: b\n---\n' } },
    } }).run();
    assert.equal(flagsOf(two, 'name-overlap').length, 1);
    assert.equal(flagsOf(two, 'name-shadow').length, 0);
});

test('an @import in a memory file is followed; a bare @word is not an import', () =>
{
    const fx = install({ project: { 'CLAUDE.md': '# Top\n\n@docs/run-book.md\n@Stop is an event name.\n', 'docs/run-book.md': 'Run npm test.\n', '.claude/AGENTS.md': 'ignored beside a CLAUDE.md\n' } });
    const start = rowsAt(fx.run(), 'session-start');
    assert.deepEqual(start.map((r) => r.source), ['CLAUDE.md', path.join('docs', 'run-book.md')]);
    assert.match(start[1].note, /imported by CLAUDE\.md/);
});

test('imports: four hops deep, never from a code span or a fenced block', () =>
{
    const fx = install({ project: {
        'CLAUDE.md': '# Top\n\nSee `@not/imported.md` here.\n\n```text\n@also/not.md\n```\n\n@h1.md\n',
        'h1.md': '@h2.md\n', 'h2.md': '@h3.md\n', 'h3.md': '@h4.md\n', 'h4.md': '@h5.md\n', 'h5.md': 'too deep\n',
    } });
    assert.deepEqual(rowsAt(fx.run(), 'session-start').map((r) => r.source), ['CLAUDE.md', 'h1.md', 'h2.md', 'h3.md', 'h4.md']);
});

test('a CLAUDE.md above the project still loads, and it keeps AGENTS.md out', () =>
{
    const fx = install({ project: { '.claude/AGENTS.md': 'the seeded instructions\n' } });
    fs.writeFileSync(path.join(fx.root, 'CLAUDE.md'), 'a parent note\n');
    const sources = rowsAt(fx.run(), 'session-start').map((r) => r.source);
    assert.deepEqual(sources, [path.join('..', 'CLAUDE.md')]);
});

test('usage: no project is exit 2, a missing directory exit 1', () =>
{
    assert.equal(quiet(() => main([])), 2);
    assert.equal(quiet(() => main([path.join(os.tmpdir(), 'no-such-project-surface')])), 1);
});
