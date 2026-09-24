'use strict';
// THE INSTALL STAMP OF THE NODE SEED - Phase 7, T2.
//
// The stamp is read by two things that matter: `/alfred-code:configure`, which diffs its SHA
// against main to say what an update would bring, and `--installed-only`, which reads
// `shipped-hooks` and the two `installed-always-*` lines to tell an item the user DROPPED from one
// that did not exist when the install was made. On disk those two look identical, so a wrong line
// here is a wrong adoption later.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeStamp, shippedHooks, installedAlways, family, readPicked, readLibrary, stampPath } = require('./install/stamp.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'install-stamp-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
function project({ rules = [], servers = {}, plugins = {}, always } = {})
{
    const base = path.join(TMP, `p-${seq++}`);
    const claude = path.join(base, '.claude');
    fs.mkdirSync(path.join(claude, 'rules'), { recursive: true });
    for (const r of rules) fs.writeFileSync(path.join(claude, 'rules', `${r}.md`), '# rule\n');
    fs.writeFileSync(path.join(claude, 'settings.json'), JSON.stringify({ enabledPlugins: plugins }));
    fs.writeFileSync(path.join(base, '.mcp.json'), JSON.stringify({ mcpServers: servers }));

    const src = path.join(base, 'src');
    fs.mkdirSync(path.join(src, 'meta'), { recursive: true });
    fs.writeFileSync(path.join(src, 'meta', 'recommendations.json'), JSON.stringify({
        always: always || { rules: ['baseline-interaction', 'baseline-security'], mcps: ['serena', 'context7', 'memory'] },
    }));
    return { base, src, mcpFile: path.join(base, '.mcp.json') };
}

const SOURCE = (dir) => ({ dir, sha: 'f'.repeat(40), ref: 'main', repoUrl: 'https://example.invalid/envoydev/alfred-code' });

function write(p, opts = {})
{
    const logs = [];
    const dest = writeStamp({
        source: opts.source === undefined ? SOURCE(p.src) : opts.source,
        action: opts.action || 'install',
        scope: opts.scope || 'project',
        configDir: opts.configDir || path.join(p.base, 'acct'),
        projectRoot: p.base,
        mcpFile: p.mcpFile,
        hooksCatalog: opts.hooksCatalog || [],
        picked: opts.picked,
        library: opts.library,
        version: opts.version || '1.0.0',
        now: new Date('2026-09-22T10:00:00.000Z'),
        log: (m) => logs.push(m), note: (m) => logs.push(m),
    });
    return { dest, logs, text: dest ? fs.readFileSync(dest, 'utf8') : '' };
}

test('install-stamp: NO SHA means NO STAMP - a run that resolved nothing claims nothing', () =>
{
    const p = project();
    const { dest, logs } = write(p, { source: null });
    assert.strictEqual(dest, null);
    assert.ok(logs.some((m) => /no source revision resolved/.test(m)), logs.join(' | '));
});

test('install-stamp: a failed run leaves the PREVIOUS stamp untouched', () =>
{
    const p = project();
    write(p);
    const before = fs.readFileSync(path.join(p.base, '.claude', 'alfred-code.stamp'), 'utf8');
    write(p, { source: { dir: p.src, sha: '', ref: '', repoUrl: 'x' } });
    assert.strictEqual(fs.readFileSync(path.join(p.base, '.claude', 'alfred-code.stamp'), 'utf8'), before,
        'a run with no revision overwrote a good stamp - configure would then report the wrong diff');
});

test('install-stamp: the stamp carries the revision, the action and the scope', () =>
{
    const p = project();
    const { text } = write(p, { action: 'update' });
    assert.match(text, /^sha: f{40}$/m);
    assert.match(text, /^ref: main$/m);
    assert.match(text, /^action: update$/m);
    assert.match(text, /^scope: project$/m);
    assert.match(text, /^version: 1\.0\.0$/m);
    assert.match(text, /^installed: 2026-09-22T10:00:00Z$/m);
    assert.match(text, /compare\/f{40}\.\.\.main/, 'the compare line is what configure tells a user to open');
});

test('install-stamp: project scope writes beside the install, global scope writes to the account', () =>
{
    const p = project();
    assert.strictEqual(write(p).dest, path.join(p.base, '.claude', 'alfred-code.stamp'));
    const acct = path.join(p.base, 'acct');
    assert.strictEqual(write(p, { scope: 'global', configDir: acct }).dest, path.join(acct, 'alfred-code.stamp'));
});

test('install-stamp: shipped-hooks is one entry per FILE, not per matcher', () =>
{
    // The catalog wires guard-read-whole-file on both Read and Bash. That is one hook file, and a
    // stamp that listed it twice would make --installed-only compare against a list that does not
    // match anything on disk.
    const catalog = [
        { file: 'guard-read-whole-file.js', matcher: 'Read' },
        { file: 'guard-read-whole-file.js', matcher: 'Bash' },
        { file: 'docs-session.js', matcher: 'SessionStart' },
    ];
    assert.deepStrictEqual(shippedHooks(catalog), ['guard-read-whole-file', 'docs-session']);
    const { text } = write(project(), { hooksCatalog: catalog });
    assert.match(text, /^shipped-hooks: guard-read-whole-file,docs-session$/m);
});

test('install-stamp: installed-always records what is CARRIED, not what shipped', () =>
{
    const p = project({
        rules: ['baseline-interaction'],                 // security shipped but is not on disk
        servers: { serena: {} },                         // context7 and memory are not registered
    });
    const { text } = write(p);
    assert.match(text, /^installed-always-rules: baseline-interaction$/m);
    assert.match(text, /^installed-always-mcps: serena$/m);
});

test('install-stamp: a server riding its PLUGIN counts as carried - there is no .mcp.json to read', () =>
{
    // This is the Phase 6 shape: on the plugin route the installer registers nothing, so a stamp
    // that only read the file would record an install with none of the locked three.
    const p = project({
        rules: ['baseline-interaction', 'baseline-security'],
        servers: {},
        plugins: { 'serena@envoydev': true, 'context7@envoydev': true, 'memory@envoydev': true },
    });
    const { text } = write(p);
    assert.match(text, /^installed-always-mcps: serena,context7,memory$/m);
});

test('install-stamp: a playwright ENGINE and the context7 local transport count as their family', () =>
{
    assert.strictEqual(family('playwright-firefox'), 'playwright');
    assert.strictEqual(family('context7-local'), 'context7');
    assert.strictEqual(family('serena'), 'serena');
    const p = project({
        always: { rules: [], mcps: ['playwright', 'context7'] },
        plugins: { 'playwright-firefox@envoydev': true, 'context7-local@envoydev': true },
    });
    const { text } = write(p);
    assert.match(text, /^installed-always-mcps: playwright,context7$/m);
});

test('install-stamp: a missing or malformed input is empty, never a crash', () =>
{
    const p = project();
    fs.writeFileSync(path.join(p.base, '.mcp.json'), '{ not json');
    fs.writeFileSync(path.join(p.base, '.claude', 'settings.json'), '');
    fs.rmSync(path.join(p.src, 'meta', 'recommendations.json'));
    const { text } = write(p);
    assert.match(text, /^installed-always-rules: $/m);
    assert.match(text, /^installed-always-mcps: $/m);
    assert.match(text, /^sha: f{40}$/m, 'the rest of the stamp was lost with the unreadable inputs');
});

test('install-stamp: installedAlways reads the two lists independently', () =>
{
    const p = project({ rules: ['baseline-security'], servers: { memory: {} } });
    const got = installedAlways({
        recommendations: path.join(p.src, 'meta', 'recommendations.json'),
        mcpFile: p.mcpFile,
        settingsFile: path.join(p.base, '.claude', 'settings.json'),
        rulesDir: path.join(p.base, '.claude', 'rules'),
    });
    assert.deepStrictEqual(got.rules, ['baseline-security']);
    assert.deepStrictEqual(got.mcps, ['memory']);
});

// T3: the skills and seats this run installed, so the next --installed-only can read back an item a
// release MOVED into an entry this project has not enabled - the new placement alone loses it.
test('install-stamp: picked-skills / picked-agents record what this run installed, and read back', () =>
{
    const p = project();
    const { dest, text } = write(p, { picked: { skills: ['csharp', 'dotnet'], agents: ['evidence-gatherer'] } });
    assert.match(text, /^picked-skills: csharp,dotnet$/m);
    assert.match(text, /^picked-agents: evidence-gatherer$/m);
    assert.deepStrictEqual(readPicked(dest), { skills: ['csharp', 'dotnet'], agents: ['evidence-gatherer'] });
});

test('install-stamp: a stamp without the picked lines (an older install, the shell twin) reads as null - never as an empty pick', () =>
{
    const p = project();
    const file = path.join(p.base, 'old.stamp');
    fs.writeFileSync(file, 'sha: abc\nshipped-hooks: a,b\n');
    assert.strictEqual(readPicked(file), null);
    assert.strictEqual(readPicked(path.join(p.base, 'absent.stamp')), null);
    fs.writeFileSync(file, 'sha: abc\npicked-skills: \npicked-agents: \n');
    assert.deepStrictEqual(readPicked(file), { skills: [], agents: [] }, 'recorded empty is an answer');
    const { text } = write(project());
    assert.match(text, /^picked-skills: $/m, 'no picks given is an empty line, never a crash');
});

// Library route: the hash of every library copy this run wrote, so validate and status can tell a
// hand edit from a stale copy, and the next update can say it overwrote one.
test('install-stamp: the stamp records library hashes and reads them back', () =>
{
    const p = project();
    const { dest, text } = write(p, { library: { skills: { demo: 'aa', other: 'cc' }, agents: { seat: 'bb' } } });
    assert.match(text, /^library-skills: demo=aa,other=cc$/m);
    assert.match(text, /^library-agents: seat=bb$/m);
    assert.deepStrictEqual(readLibrary(dest), { version: '1.0.0', skills: { demo: 'aa', other: 'cc' }, agents: { seat: 'bb' } });
});

test('install-stamp: a stamp without library lines, or no stamp, reads as null; recorded empty is an answer', () =>
{
    const p = project();
    const file = path.join(p.base, 'old.stamp');
    fs.writeFileSync(file, 'sha: abc\nversion: 1.2.0\npicked-skills: csharp\n');
    assert.strictEqual(readLibrary(file), null);
    assert.strictEqual(readLibrary(path.join(p.base, 'absent.stamp')), null);
    fs.writeFileSync(file, 'sha: abc\nversion: 1.3.0\nlibrary-skills: \nlibrary-agents: garbage,x=\n');
    assert.deepStrictEqual(readLibrary(file), { version: '1.3.0', skills: {}, agents: { x: '' } }, 'a malformed pair is skipped, never a crash');
    const { text } = write(project());
    assert.match(text, /^library-skills: $/m, 'no library given is an empty line');
});

test('install-stamp: stampPath is where writeStamp writes, per scope', () =>
{
    const p = project();
    const acct = path.join(p.base, 'acct');
    assert.strictEqual(stampPath({ scope: 'project', configDir: acct, projectRoot: p.base }), path.join(p.base, '.claude', 'alfred-code.stamp'));
    assert.strictEqual(stampPath({ scope: 'global', configDir: acct, projectRoot: p.base }), path.join(acct, 'alfred-code.stamp'));
    assert.strictEqual(write(p).dest, stampPath({ scope: 'project', configDir: acct, projectRoot: p.base }));
});
