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

const { writeStamp, shippedHooks, installedAlways, family, readPicked, readLibrary, readHooksRoute, readPlaywright, readPlaywrightEnabled, stampPath, stampFiles, migrateLegacyGlobal } = require('./install/stamp.js');

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
        hooksRoute: opts.hooksRoute,
        playwright: opts.playwright,
        playwrightEnabled: opts.playwrightEnabled,
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

test('install-stamp: every scope writes the stamp into the project - T16, R29', () =>
{
    const p = project();
    const acct = path.join(p.base, 'acct');
    assert.strictEqual(write(p, { scope: 'project' }).dest, path.join(p.base, '.claude', 'alfred-code.stamp'));
    assert.strictEqual(write(p, { scope: 'user', configDir: acct }).dest, path.join(p.base, '.claude', 'alfred-code.stamp'));
    assert.strictEqual(write(p, { scope: 'local', configDir: acct }).dest, path.join(p.base, '.claude', 'alfred-code.stamp'));
    assert.ok(!fs.existsSync(path.join(acct, 'alfred-code.stamp')), 'a user/local-scope write never touches the account dir');
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

test('install-stamp: a playwright ENGINE counts as its family', () =>
{
    assert.strictEqual(family('playwright-firefox'), 'playwright');
    assert.strictEqual(family('serena'), 'serena');
    const p = project({
        always: { rules: [], mcps: ['playwright', 'context7'] },
        plugins: { 'playwright-firefox@envoydev': true, 'context7@envoydev': true },
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

// Ruling R55: the copy route's None is read back only when the LAST run was the copy route, and the
// stamp is the one record of that - a leftover prelude on disk is not.
test('install-stamp: hooks-route records the route the hooks took, and a stamp without it reads as unknown', () =>
{
    for (const route of ['copy', 'plugin'])
    {
        const { dest, text } = write(project(), { hooksRoute: route });
        assert.match(text, new RegExp(`^hooks-route: ${route}$`, 'm'));
        assert.strictEqual(readHooksRoute(dest), route);
    }
    const p = project();
    const file = path.join(p.base, 'old.stamp');
    for (const body of ['sha: abc\nshipped-hooks: a,b\n', 'hooks-route: \n', 'hooks-route: both\n', 'hooks-route: copyish\n'])
    {
        fs.writeFileSync(file, body);
        assert.strictEqual(readHooksRoute(file), null, JSON.stringify(body));
    }
    assert.strictEqual(readHooksRoute(path.join(p.base, 'absent.stamp')), null);
    assert.doesNotMatch(write(project()).text, /^hooks-route:/m, 'no route given records none - never a guess');
});

// The stamp line is the record of the installed engines, never the listing: an engine the user left
// disabled is still installed, and the listing's project-scope flag can read a stale false (S22).
test('install-stamp: playwright-browsers records the picked engines and reads back; a stamp without the line reads as null', () =>
{
    const { dest, text } = write(project(), { playwright: ['chrome', 'firefox'] });
    assert.match(text, /^playwright-browsers: chrome,firefox$/m);
    assert.deepStrictEqual(readPlaywright(dest), ['chrome', 'firefox']);
    const none = write(project());
    assert.match(none.text, /^playwright-browsers: $/m, 'no engine picked is an empty line - the record says none');
    assert.deepStrictEqual(readPlaywright(none.dest), [], 'recorded empty is an answer');
    const p = project();
    const file = path.join(p.base, 'old.stamp');
    fs.writeFileSync(file, 'sha: abc\nshipped-hooks: a,b\n');
    assert.strictEqual(readPlaywright(file), null, 'an older stamp never recorded the picks');
    assert.strictEqual(readPlaywright(path.join(p.base, 'absent.stamp')), null);
    // Only the four engines, in the one canonical order, whatever a hand edit left there.
    fs.writeFileSync(file, 'playwright-browsers: webkit, safari,CHROME,webkit\n');
    assert.deepStrictEqual(readPlaywright(file), ['chrome', 'webkit']);
});

// R67: which installed engines the user chose to ENABLE - their last explicit answer, read back so an
// engine the run installs again (one uninstalled by hand) comes back the way the user left it.
test('install-stamp: playwright-enabled records the enabled engines beside the installed ones; no line reads as null', () =>
{
    const { dest, text } = write(project(), { playwright: ['chrome', 'firefox'], playwrightEnabled: ['firefox'] });
    assert.match(text, /^playwright-browsers: chrome,firefox\nplaywright-enabled: firefox$/m);
    assert.deepStrictEqual(readPlaywrightEnabled(dest), ['firefox']);
    const none = write(project(), { playwright: ['chrome'], playwrightEnabled: [] });
    assert.match(none.text, /^playwright-enabled: $/m, 'none enabled is an empty line - an answer, never a missing record');
    assert.deepStrictEqual(readPlaywrightEnabled(none.dest), []);
    const p = project();
    const file = path.join(p.base, 'old.stamp');
    fs.writeFileSync(file, 'sha: abc\nplaywright-browsers: chrome\n');
    assert.strictEqual(readPlaywrightEnabled(file), null, 'a stamp from before the line recorded no choice');
    assert.strictEqual(readPlaywrightEnabled(path.join(p.base, 'absent.stamp')), null);
    fs.writeFileSync(file, 'playwright-enabled: webkit,safari, Chrome\n');
    assert.deepStrictEqual(readPlaywrightEnabled(file), ['chrome', 'webkit']);
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
    assert.match(text, /^library-rules: $/m, 'no rules given is an empty line, like the other two');
    assert.deepStrictEqual(readLibrary(dest), { version: '1.0.0', skills: { demo: 'aa', other: 'cc' }, agents: { seat: 'bb' }, rules: {} });
});

test('install-stamp: a stamp without library lines, or no stamp, reads as null; recorded empty is an answer', () =>
{
    const p = project();
    const file = path.join(p.base, 'old.stamp');
    fs.writeFileSync(file, 'sha: abc\nversion: 1.2.0\npicked-skills: csharp\n');
    assert.strictEqual(readLibrary(file), null);
    assert.strictEqual(readLibrary(path.join(p.base, 'absent.stamp')), null);
    fs.writeFileSync(file, 'sha: abc\nversion: 1.3.0\nlibrary-skills: \nlibrary-agents: garbage,x=\n');
    assert.deepStrictEqual(readLibrary(file), { version: '1.3.0', skills: {}, agents: { x: '' }, rules: {} }, 'a malformed pair is skipped, never a crash');
    const { text } = write(project());
    assert.match(text, /^library-skills: $/m, 'no library given is an empty line');
});

// R29: rules are a third `library` kind, same as skills and agents.
test('install-stamp: the stamp records rule hashes alongside skills and agents', () =>
{
    const p = project();
    const { dest, text } = write(p, { library: { skills: { demo: 'aa' }, agents: { seat: 'bb' }, rules: { 'baseline-git': 'cc' } } });
    assert.match(text, /^library-rules: baseline-git=cc$/m);
    assert.deepStrictEqual(readLibrary(dest), { version: '1.0.0', skills: { demo: 'aa' }, agents: { seat: 'bb' }, rules: { 'baseline-git': 'cc' } });
});

// R29: a stamp a 1.x (pre-rules) release wrote carries library-skills/library-agents but no
// library-rules line at all. It must read as a STAMP (skills/agents drift checking must keep
// working), with an empty rules map - never null, and never a crash - so the first update after
// this release records fresh hashes instead of reporting every rule as drift.
test('install-stamp: a stamp with library-skills/agents but no library-rules line reads rules as empty, not null', () =>
{
    const p = project();
    const file = path.join(p.base, 'old.stamp');
    fs.writeFileSync(file, 'sha: abc\nversion: 1.4.0\nlibrary-skills: demo=aa\nlibrary-agents: seat=bb\n');
    assert.deepStrictEqual(readLibrary(file), { version: '1.4.0', skills: { demo: 'aa' }, agents: { seat: 'bb' }, rules: {} });
});

test('install-stamp: stampPath is where writeStamp writes - the project, whatever scope or configDir is handed in', () =>
{
    const p = project();
    const acct = path.join(p.base, 'acct');
    const want = path.join(p.base, '.claude', 'alfred-code.stamp');
    assert.strictEqual(stampPath({ scope: 'project', configDir: acct, projectRoot: p.base }), want);
    assert.strictEqual(stampPath({ scope: 'user', configDir: acct, projectRoot: p.base }), want);
    assert.strictEqual(stampPath({ scope: 'local', configDir: acct, projectRoot: p.base }), want);
    assert.strictEqual(write(p).dest, want);
});

// 2.0.0: a 1.x install's stamp is `claude-stack.stamp`. It is READ until the first 2.0.0 run writes // legacy-name
// `alfred-code.stamp`, and that run removes the old file, so the two can never disagree later.
const OLD_STAMP = 'claude-stack.stamp'; // legacy-name

test('install-stamp: writeStamp deletes the PROJECT 1.x stamp after writing the new one, at every scope - and never touches the account dir', () =>
{
    const p = project();
    const acct = path.join(p.base, 'acct');
    fs.mkdirSync(acct, { recursive: true });
    for (const dir of [path.join(p.base, '.claude'), acct]) fs.writeFileSync(path.join(dir, OLD_STAMP), 'sha: abc\nversion: 1.3.0\n');
    const dest = write(p, { scope: 'user', configDir: acct }).dest;
    assert.strictEqual(dest, path.join(p.base, '.claude', 'alfred-code.stamp'));
    assert.ok(fs.existsSync(dest), 'the new stamp was not written');
    assert.ok(!fs.existsSync(path.join(p.base, '.claude', OLD_STAMP)), 'the project 1.x stamp is still beside the new one');
    assert.ok(fs.existsSync(path.join(acct, OLD_STAMP)), 'writeStamp touched the account 1.x stamp - that is migrateLegacyGlobal\'s job, never this one\'s');
});

test('install-stamp: a run with no revision leaves the 1.x stamp where it is - it is still the only record', () =>
{
    const p = project();
    const old = path.join(p.base, '.claude', OLD_STAMP);
    fs.writeFileSync(old, 'sha: abc\nversion: 1.3.0\npicked-skills: csharp@claude-stack\n'); // legacy-name
    assert.strictEqual(write(p, { source: null }).dest, null);
    assert.ok(fs.existsSync(old));
});

// The order is the guarantee: the 1.x stamp goes only once the new one is on disk. A write that fails
// (here a directory standing where the new stamp goes) must leave the 1.x stamp as the only record.
test('install-stamp: a failed write of the new stamp leaves the 1.x stamp where it is', () =>
{
    const p = project();
    const old = path.join(p.base, '.claude', OLD_STAMP);
    fs.writeFileSync(old, 'sha: abc\nversion: 1.3.0\npicked-skills: csharp@claude-stack\n'); // legacy-name
    fs.mkdirSync(path.join(p.base, '.claude', 'alfred-code.stamp'));
    const r = write(p);
    assert.strictEqual(r.dest, null, 'the write was reported as done');
    assert.ok(fs.existsSync(old), 'the 1.x stamp was removed although the new one never landed');
    assert.strictEqual(fs.readFileSync(old, 'utf8'), 'sha: abc\nversion: 1.3.0\npicked-skills: csharp@claude-stack\n'); // legacy-name
});

test('install-stamp: stampFiles reads the new stamp, else the 1.x one, from the PROJECT whatever scope/configDir is handed in', () =>
{
    const p = project();
    const acct = path.join(p.base, 'acct');
    const at = { scope: 'user', configDir: acct, projectRoot: p.base };
    assert.deepStrictEqual(stampFiles(at), { read: null, write: stampPath(at) });
    fs.writeFileSync(path.join(p.base, '.claude', OLD_STAMP), 'sha: abc\npicked-skills: csharp@claude-stack\npicked-agents: \n'); // legacy-name
    assert.strictEqual(stampFiles(at).read, path.join(p.base, '.claude', OLD_STAMP));
    assert.deepStrictEqual(readPicked(stampFiles(at).read), { skills: ['csharp@claude-stack'], agents: [] }); // legacy-name
    write(p, { scope: 'user', configDir: acct });
    assert.strictEqual(stampFiles(at).read, stampPath(at));
});

// T16, R29: a 1.x GLOBAL install's stamp and skills sat in the account dir. migrateLegacyGlobal is
// the one-time reader that copies both into the project on the first 2.x update.
test('migrateLegacyGlobal: copies a 1.x account stamp and its skills into the project, leaving the account copies in place', () =>
{
    const p = project();
    const acct = path.join(p.base, 'acct');
    fs.mkdirSync(path.join(acct, 'skills', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(acct, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\n---\nbody\n');
    fs.writeFileSync(path.join(acct, OLD_STAMP), 'sha: abc\nversion: 1.3.0\npicked-skills: demo\n');
    const logs = [];
    const moved = migrateLegacyGlobal({ configDir: acct, projectRoot: p.base, log: (m) => logs.push(m) });
    assert.strictEqual(moved, true);
    // The project now carries the 1.x stamp under its OWN name - stampFiles' existing read-new-else-
    // legacy logic finds it unchanged.
    assert.strictEqual(fs.readFileSync(path.join(p.base, '.claude', OLD_STAMP), 'utf8'), 'sha: abc\nversion: 1.3.0\npicked-skills: demo\n');
    assert.strictEqual(fs.readFileSync(path.join(p.base, '.claude', 'skills', 'demo', 'SKILL.md'), 'utf8'), '---\nname: demo\n---\nbody\n');
    // The account copies are LEFT IN PLACE - other projects on the same machine may still read them.
    assert.ok(fs.existsSync(path.join(acct, OLD_STAMP)), 'the account stamp was deleted, not left for other projects');
    assert.ok(fs.existsSync(path.join(acct, 'skills', 'demo', 'SKILL.md')), 'the account skill was deleted, not left for other projects');
    assert.ok(logs.some((m) => /1 skill\(s\) were moved from/.test(m) && m.includes(acct)), logs.join(' | '));
});

test('migrateLegacyGlobal: nothing to migrate - no account stamp at all - is a silent no-op', () =>
{
    const p = project();
    const acct = path.join(p.base, 'acct');
    assert.strictEqual(migrateLegacyGlobal({ configDir: acct, projectRoot: p.base }), false);
    assert.ok(!fs.existsSync(path.join(p.base, '.claude', OLD_STAMP)));
});

test('migrateLegacyGlobal: runs only ONCE - a project that already has its own stamp is left alone', () =>
{
    const p = project();
    const acct = path.join(p.base, 'acct');
    fs.mkdirSync(acct, { recursive: true });
    fs.writeFileSync(path.join(acct, OLD_STAMP), 'sha: abc\nversion: 1.3.0\n');
    // A native run already wrote this project's own (new-name) stamp.
    write(p);
    const moved = migrateLegacyGlobal({ configDir: acct, projectRoot: p.base });
    assert.strictEqual(moved, false, 'a project with its own stamp must never be overwritten by an unrelated account one');
});

test('migrateLegacyGlobal: an account stamp with no skills folder still migrates - zero skills, no crash', () =>
{
    const p = project();
    const acct = path.join(p.base, 'acct');
    fs.mkdirSync(acct, { recursive: true });
    fs.writeFileSync(path.join(acct, OLD_STAMP), 'sha: abc\nversion: 1.3.0\n');
    assert.strictEqual(migrateLegacyGlobal({ configDir: acct, projectRoot: p.base }), true);
    assert.ok(fs.existsSync(path.join(p.base, '.claude', OLD_STAMP)));
    assert.ok(!fs.existsSync(path.join(p.base, '.claude', 'skills')));
});
