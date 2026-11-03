'use strict';
// scripts/install/marketplace-autoupdate.js - Claude Code's auto-update for the stack's marketplace, offered once by
// /alfred-code:init (U01 of the 2026-11-03 usage audit). Where the flag lives is the docs' order
// (https://code.claude.com/docs/en/plugins/loading.md, 'When auto-update runs'): `autoUpdate` on the marketplace's
// `extraKnownMarketplaces` entry in a settings file, then on its known_marketplaces.json entry, then off. A yes or a
// no is written to the account settings.json's entry alone - never another marketplace's, never another key.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const au = require('./install/marketplace-autoupdate.js');

const SCRIPT = path.join(__dirname, 'install', 'marketplace-autoupdate.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-autoupdate-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const STACK = { source: 'github', repo: 'envoydev/alfred-code' };
const OTHER = { source: 'github', repo: 'someone/else' };
let seq = 0;
// A throwaway account dir, a project and a managed file path that does not exist - never the real ones.
function world({ known, user, project, local, managed } = {})
{
    const top = path.join(TMP, `w-${seq++}`);
    const acct = path.join(top, 'acct');
    const root = path.join(top, 'proj');
    fs.mkdirSync(path.join(acct, 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    const put = (file, v) => { if (v !== undefined) fs.writeFileSync(file, typeof v === 'string' ? v : JSON.stringify(v, null, 2)); };
    put(path.join(acct, 'plugins', 'known_marketplaces.json'), known);
    put(path.join(acct, 'settings.json'), user);
    put(path.join(root, '.claude', 'settings.json'), project);
    put(path.join(root, '.claude', 'settings.local.json'), local);
    const managedFile = path.join(top, 'managed', 'managed-settings.json');
    if (managed !== undefined) { fs.mkdirSync(path.dirname(managedFile), { recursive: true }); put(managedFile, managed); }
    return { acct, root, managedFile, userFile: path.join(acct, 'settings.json'), env: { CLAUDE_CONFIG_DIR: acct, HOME: path.join(top, 'home') } };
}
const KNOWN = (extra = {}) => ({ envoydev: { source: STACK, installLocation: '/x', lastUpdated: '2026-11-01T00:00:00.000Z', ...extra } });
const opts = (w, env = {}) => ({ projectRoot: w.root, env: { ...w.env, ...env }, managedFile: w.managedFile });
const read = (f) => fs.readFileSync(f, 'utf8');
const json = (f) => JSON.parse(read(f));

test('not registered: no marketplace of the stack on this account - not asked', () =>
{
    const w = world({ known: { other: { source: OTHER } } });
    const s = au.autoUpdateState(opts(w));
    assert.strictEqual(s.state, 'not-asked');
    assert.match(au.stateLine(s), /^auto-update: not asked - the stack's marketplace is not registered on this account/);
    const missing = world();
    assert.strictEqual(au.autoUpdateState(opts(missing)).state, 'not-asked', 'no known_marketplaces.json at all');
});

test('registered with no choice anywhere: ask; a yes adds the entry with the known source verbatim, and a re-run writes nothing', () =>
{
    const w = world({ known: KNOWN(), user: { theme: 'dark', enabledPlugins: { 'alfred-code@envoydev': true } } });
    const s = au.autoUpdateState(opts(w));
    assert.deepStrictEqual([s.state, s.key], ['ask', 'envoydev']);
    assert.strictEqual(au.stateLine(s), 'auto-update: ask envoydev');
    const r = au.applyAutoUpdate({ ...opts(w), value: true });
    assert.strictEqual(r.written, true, r.line);
    assert.match(r.line, /^auto-update: on for envoydev - autoUpdate true written to /);
    const data = json(w.userFile);
    assert.deepStrictEqual(data, { theme: 'dark', enabledPlugins: { 'alfred-code@envoydev': true }, extraKnownMarketplaces: { envoydev: { source: STACK, autoUpdate: true } } });
    const before = read(w.userFile);
    const again = au.applyAutoUpdate({ ...opts(w), value: true });
    assert.strictEqual(again.written, false);
    assert.match(again.line, /^auto-update: already on for envoydev/);
    assert.strictEqual(read(w.userFile), before, 'idempotent');
    const now = au.autoUpdateState(opts(w));
    assert.strictEqual(now.state, 'on');
    assert.match(au.stateLine(now), /^auto-update: on for envoydev \(/);
});

test('the entry marketplace add wrote: only its autoUpdate changes - another marketplace, every other key and the file shape stay', () =>
{
    const user = '{\r\n    "extraKnownMarketplaces": {\r\n        "other": {\r\n            "source": {\r\n                "source": "github",\r\n                "repo": "someone/else"\r\n            }\r\n        },\r\n        "envoydev": {\r\n            "source": {\r\n                "source": "github",\r\n                "repo": "envoydev/alfred-code"\r\n            }\r\n        }\r\n    },\r\n    "model": "x"\r\n}\r\n';
    const w = world({ known: { ...KNOWN(), other: { source: OTHER, autoUpdate: false } }, user });
    assert.strictEqual(au.autoUpdateState(opts(w)).state, 'ask');
    assert.strictEqual(au.applyAutoUpdate({ ...opts(w), value: true }).written, true);
    const text = read(w.userFile);
    assert.ok(text.includes('\r\n') && !/[^\r]\n/.test(text), 'CRLF kept');
    assert.match(text, /^ {4}"extraKnownMarketplaces"/m, 'the 4-space indent kept');
    const data = json(w.userFile);
    assert.deepStrictEqual(data.extraKnownMarketplaces.other, { source: OTHER }, 'another marketplace untouched');
    assert.deepStrictEqual(data.extraKnownMarketplaces.envoydev, { source: STACK, autoUpdate: true });
    assert.strictEqual(data.model, 'x');
    assert.deepStrictEqual(Object.keys(data), ['extraKnownMarketplaces', 'model'], 'key order kept');
    assert.deepStrictEqual(json(path.join(w.acct, 'plugins', 'known_marketplaces.json')).other, { source: OTHER, autoUpdate: false }, 'the CLI record is only read');
    // an editor's BOM is read through and kept
    const BOM = String.fromCharCode(0xFEFF);
    const bom = world({ known: KNOWN(), user: `${BOM}{\n  "a": 1\n}\n` });
    assert.strictEqual(au.autoUpdateState(opts(bom)).state, 'ask');
    assert.strictEqual(au.applyAutoUpdate({ ...opts(bom), value: true }).written, true);
    assert.ok(read(bom.userFile).startsWith(BOM));
    assert.deepStrictEqual(JSON.parse(read(bom.userFile).slice(1)), { a: 1, extraKnownMarketplaces: { envoydev: { source: STACK, autoUpdate: true } } });
});

test('a no writes autoUpdate false, so no later init asks; the user can still say yes later', () =>
{
    const w = world({ known: KNOWN(), user: { extraKnownMarketplaces: { envoydev: { source: STACK } } } });
    const r = au.applyAutoUpdate({ ...opts(w), value: false });
    assert.strictEqual(r.written, true);
    assert.match(r.line, /^auto-update: off for envoydev - autoUpdate false written to .*no project of this account asks again/);
    assert.strictEqual(json(w.userFile).extraKnownMarketplaces.envoydev.autoUpdate, false);
    const s = au.autoUpdateState(opts(w));
    assert.strictEqual(s.state, 'off');
    assert.match(au.stateLine(s), /^auto-update: off for envoydev \(/);
    assert.strictEqual(au.applyAutoUpdate({ ...opts(w), value: true }).written, true, 'an explicit yes later still writes');
    assert.strictEqual(json(w.userFile).extraKnownMarketplaces.envoydev.autoUpdate, true);
});

test('garbage, empty or a wrong shape is never written over: the line names the file', () =>
{
    for (const [label, spec] of [
        ['garbage settings', { known: KNOWN(), user: '{ not json' }],
        ['empty settings', { known: KNOWN(), user: '' }],
        ['garbage known', { known: '[[[', user: { a: 1 } }],
        ['settings an array', { known: KNOWN(), user: [] }],
        ['extraKnownMarketplaces a string', { known: KNOWN(), user: { extraKnownMarketplaces: 'x' } }],
        ['the entry a string', { known: KNOWN(), user: { extraKnownMarketplaces: { envoydev: 'x' } } }],
    ])
    {
        const w = world(spec);
        const before = fs.existsSync(w.userFile) ? read(w.userFile) : null;
        const s = au.autoUpdateState(opts(w));
        const r = au.applyAutoUpdate({ ...opts(w), value: true });
        assert.strictEqual(r.written, false, `${label}: ${r.line}`);
        assert.match(r.line, /^auto-update: not written - /, label);
        assert.strictEqual(fs.existsSync(w.userFile) ? read(w.userFile) : null, before, `${label}: the file changed`);
        assert.strictEqual(s.state, 'not-asked', `${label}: init must not ask what it cannot write`);
    }
    // registered in a settings file only, with no record to copy a source from: still not asked
    const noSource = world({ known: { envoydev: { installLocation: '/x' } } });
    assert.strictEqual(au.autoUpdateState(opts(noSource)).state, 'not-asked');
});

test('no account settings.json yet: a yes makes one holding only the entry', () =>
{
    const w = world({ known: KNOWN() });
    assert.strictEqual(au.autoUpdateState(opts(w)).state, 'ask');
    assert.strictEqual(au.applyAutoUpdate({ ...opts(w), value: true }).written, true);
    assert.deepStrictEqual(json(w.userFile), { extraKnownMarketplaces: { envoydev: { source: STACK, autoUpdate: true } } });
});

// Review fix pass, run B (m7): a dotfiles setup links the account settings.json to a file it tracks, and the temp file
// renamed over the link replaced it with a plain file - the account cut loose from the dotfiles. The write lands on the
// link's real file now, still a temp file and a rename, in that file's own folder; the link stays as it was.
test('a symlinked account settings.json stays a link: its real file gets the entry, every other byte of it kept', { skip: process.platform === 'win32' && 'links need privileges on Windows' }, () =>
{
    const w = world({ known: KNOWN() });
    const dots = path.join(path.dirname(w.acct), 'dotfiles', 'claude');
    fs.mkdirSync(dots, { recursive: true });
    const real = path.join(dots, 'settings.json');
    fs.writeFileSync(real, '{\n    "theme": "dark",\n    "model": "x"\n}\n');
    fs.symlinkSync(real, w.userFile);
    assert.strictEqual(au.autoUpdateState(opts(w)).state, 'ask');
    const r = au.applyAutoUpdate({ ...opts(w), value: true });
    assert.strictEqual(r.written, true, r.line);
    assert.ok(fs.lstatSync(w.userFile).isSymbolicLink(), 'the link is still a link');
    assert.strictEqual(fs.readlinkSync(w.userFile), real, 'pointing where it did');
    assert.strictEqual(read(real), '{\n    "theme": "dark",\n    "model": "x",\n    "extraKnownMarketplaces": {\n        "envoydev": {\n            "source": {\n'
        + '                "source": "github",\n                "repo": "envoydev/alfred-code"\n            },\n            "autoUpdate": true\n        }\n    }\n}\n',
        'the real file holds the entry, its keys, indent and line ending as they were');
    assert.deepStrictEqual([...fs.readdirSync(dots), ...fs.readdirSync(w.acct)].filter((n) => n.includes('.tmp')), [], 'no temp file left');
    assert.strictEqual(au.applyAutoUpdate({ ...opts(w), value: true }).written, false, 'a re-run writes nothing');
    assert.ok(fs.lstatSync(w.userFile).isSymbolicLink());
    // a relative link, and a no on top of the yes
    const rel = world({ known: KNOWN() });
    const relDots = path.join(path.dirname(rel.acct), 'dots');
    fs.mkdirSync(relDots, { recursive: true });
    fs.writeFileSync(path.join(relDots, 'settings.json'), '{\n  "a": 1\n}\n');
    fs.symlinkSync(path.join('..', 'dots', 'settings.json'), rel.userFile);
    assert.strictEqual(au.applyAutoUpdate({ ...opts(rel), value: false }).written, true);
    assert.strictEqual(fs.readlinkSync(rel.userFile), path.join('..', 'dots', 'settings.json'), 'the relative link is kept as written');
    assert.deepStrictEqual(json(path.join(relDots, 'settings.json')), { a: 1, extraKnownMarketplaces: { envoydev: { source: STACK, autoUpdate: false } } });
});

test('the update switches off the whole pass: not asked unless FORCE_AUTOUPDATE_PLUGINS=1', () =>
{
    const w = world({ known: KNOWN() });
    for (const key of ['DISABLE_UPDATES', 'DISABLE_AUTOUPDATER', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'])
    {
        const s = au.autoUpdateState(opts(w, { [key]: '1' }));
        assert.strictEqual(s.state, 'not-asked', key);
        assert.match(au.stateLine(s), new RegExp(`${key} is set.*FORCE_AUTOUPDATE_PLUGINS=1`), key);
        assert.strictEqual(au.autoUpdateState(opts(w, { [key]: '1', FORCE_AUTOUPDATE_PLUGINS: '1' })).state, 'ask', `${key} forced`);
        assert.strictEqual(au.autoUpdateState(opts(w, { [key]: '0' })).state, 'ask', `${key}=0 is not set`);
    }
    const viaSettings = world({ known: KNOWN(), user: { env: { DISABLE_AUTOUPDATER: '1' } } });
    assert.strictEqual(au.autoUpdateState(opts(viaSettings)).state, 'not-asked', 'a settings env block counts too');
});

test('a higher settings file decides: managed and this project\'s files are never written, and a project entry wins whole', () =>
{
    const managed = world({ known: KNOWN(), managed: { extraKnownMarketplaces: { envoydev: { source: STACK } } } });
    const m = au.autoUpdateState(opts(managed));
    assert.strictEqual(m.state, 'not-asked');
    assert.match(au.stateLine(m), /managed settings declare envoydev/);
    assert.strictEqual(au.applyAutoUpdate({ ...opts(managed), value: true }).written, false);
    const managedOn = world({ known: KNOWN(), managed: { extraKnownMarketplaces: { envoydev: { source: STACK, autoUpdate: true } } } });
    assert.strictEqual(au.autoUpdateState(opts(managedOn)).state, 'on');

    const proj = world({ known: KNOWN(), user: { extraKnownMarketplaces: { envoydev: { source: STACK, autoUpdate: true } } }, project: { extraKnownMarketplaces: { envoydev: { source: STACK } } } });
    const p = au.autoUpdateState(opts(proj));
    assert.strictEqual(p.state, 'not-asked', 'the project entry, without autoUpdate, replaces the account one whole');
    assert.match(au.stateLine(p), /\.claude\/settings\.json declares envoydev/);
    const projBefore = read(path.join(proj.root, '.claude', 'settings.json'));
    assert.strictEqual(au.applyAutoUpdate({ ...opts(proj), value: true }).written, false);
    assert.strictEqual(read(path.join(proj.root, '.claude', 'settings.json')), projBefore);
    const local = world({ known: KNOWN(), local: { extraKnownMarketplaces: { envoydev: { source: STACK, autoUpdate: false } } } });
    const l = au.autoUpdateState(opts(local));
    assert.strictEqual(l.state, 'off');
    assert.match(au.stateLine(l), /settings\.local\.json/);
});

test('the /plugin toggle\'s record: on in known_marketplaces.json reads on, and an explicit no is written over it in the account file', () =>
{
    const w = world({ known: KNOWN({ autoUpdate: true }) });
    const s = au.autoUpdateState(opts(w));
    assert.strictEqual(s.state, 'on');
    assert.match(au.stateLine(s), /known_marketplaces\.json/);
    assert.strictEqual(au.applyAutoUpdate({ ...opts(w), value: false }).written, true);
    assert.strictEqual(au.autoUpdateState(opts(w)).state, 'off', 'a settings entry outranks the CLI record');
});

test('the stack under another key (a fork, a renamed registration) and the alias spelling', () =>
{
    const fork = world({ known: { mine: { source: STACK } } });
    const s = au.autoUpdateState(opts(fork));
    assert.deepStrictEqual([s.state, s.key], ['ask', 'mine']);
    au.applyAutoUpdate({ ...opts(fork), value: true });
    assert.deepStrictEqual(json(fork.userFile).extraKnownMarketplaces.mine, { source: STACK, autoUpdate: true });

    const alias = world({ known: KNOWN(), user: { additionalMarketplaces: { envoydev: { source: STACK } } } });
    assert.strictEqual(au.applyAutoUpdate({ ...opts(alias), value: true }).written, true);
    const data = json(alias.userFile);
    assert.deepStrictEqual(data.additionalMarketplaces.envoydev, { source: STACK, autoUpdate: true }, 'written where the entry is');
    assert.ok(!Object.hasOwn(data, 'extraKnownMarketplaces'));
});

test('CLI: --check by default, --apply and --decline print one line, two modes refuse', () =>
{
    const w = world({ known: KNOWN() });
    const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args, '--root', w.root, '--managed-file', w.managedFile], { env: { ...process.env, ...w.env, DISABLE_UPDATES: '', DISABLE_AUTOUPDATER: '', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '' }, encoding: 'utf8' });
    const check = run();
    assert.strictEqual(check.status, 0, check.stderr);
    assert.strictEqual(check.stdout.trim(), 'auto-update: ask envoydev');
    const yes = run('--apply');
    assert.strictEqual(yes.status, 0, yes.stderr);
    assert.match(yes.stdout, /^auto-update: on for envoydev - /);
    assert.strictEqual(json(w.userFile).extraKnownMarketplaces.envoydev.autoUpdate, true);
    const no = run('--decline');
    assert.match(no.stdout, /^auto-update: off for envoydev - /);
    const both = run('--apply', '--decline');
    assert.strictEqual(both.status, 2);
    assert.match(both.stderr, /one of --check, --apply or --decline/);
});
