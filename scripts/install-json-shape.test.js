'use strict';
// Bug 4 of the complexity audit (2026-11-10): the installer wrote a person's JSON files two ways. Four writers kept the
// file's shape (its BOM, line ends and indent), the other 17 rewrote it as two spaces and LF - so a Windows user's
// CRLF settings.json, or a 4-space one, was re-laid out by an update. One helper in json-file.js now holds the shape
// rule, every installer write goes through it, and the sweep below fails a new write that does not.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseJson, formatOf, stringifyLike } = require('./install/json-file.js');
const { writeSettings } = require('./install/settings.js');
const { writeLike } = require('./install/workspace.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'json-shape-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let seq = 0;
const dirOf = () => { const d = path.join(TMP, `c-${seq++}`); fs.mkdirSync(d, { recursive: true }); return d; };
const loneLf = (t) => /(^|[^\r])\n/.test(t);

test('a file written back through formatOf and stringifyLike is byte-identical', () =>
{
    for (const t of ['\uFEFF{\r\n    "a": 1\r\n}\r\n', '{\n\t"a": [\n\t\t1\n\t]\n}', '{\n  "a": 1\n}\n'])
        assert.strictEqual(stringifyLike(parseJson(t), formatOf(t)), t, JSON.stringify(t));
});

test('a file with no indented line is written with two spaces and a final LF (ruling 5)', () =>
{
    assert.strictEqual(stringifyLike({ a: 1 }, formatOf(null)), '{\n  "a": 1\n}\n');
    assert.strictEqual(formatOf('{}').indent, '  ');
    assert.strictEqual(stringifyLike({ a: 1, b: 2 }, formatOf('{"a":1}\n')), '{\n  "a": 1,\n  "b": 2\n}\n');
    for (const blank of [undefined, '', '  \n']) assert.deepStrictEqual(formatOf(blank), { bom: false, indent: '  ', eol: '\n', final: true });
});

test('mixed line ends are written all CRLF, never a mix', () =>
{
    const t = '{\r\n  "a": 1\n}\n';
    assert.strictEqual(formatOf(t).eol, '\r\n');
    const out = stringifyLike({ a: 1, b: [1, 2] }, formatOf(t));
    assert.ok(!loneLf(out), JSON.stringify(out));
});

test('the settings writer keeps a BOM, CRLF and 4-space settings.json', () =>
{
    const dir = path.join(dirOf(), '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '\uFEFF{\r\n    "env": {\r\n        "MY_KEY": "1"\r\n    }\r\n}\r\n');
    writeSettings({ file, catalog: require('../meta/environment.json').env, migrations: {}, log: () => {}, note: () => {} });
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.startsWith('\uFEFF'), 'BOM kept');
    assert.match(text, /\r\n {4}"env"/);
    assert.ok(!loneLf(text), 'no lone LF');
    assert.strictEqual(parseJson(text).env.MY_KEY, '1');
});

test('the init writers (plugin-settings, and hud-statusline through its reader) keep a BOM, CRLF and 4-space settings file', () =>
{
    const { applyTargets } = require('./plugin-settings.js');
    const file = path.join(dirOf(), 'settings.local.json');
    fs.writeFileSync(file, '\uFEFF{\r\n    "env": {\r\n        "MY_KEY": "1"\r\n    }\r\n}\r\n');
    applyTargets([{ file: 'settings.local.json', absolute: file, rows: [{ status: 'missing', key: 'env.NEW_KEY', want: '2' }] }], false);
    const text = fs.readFileSync(file, 'utf8');
    assert.strictEqual(text, '\uFEFF{\r\n    "env": {\r\n        "MY_KEY": "1",\r\n        "NEW_KEY": "2"\r\n    }\r\n}\r\n');
});

test('the account writer writes through a link and keeps the target\'s CRLF and indent', { skip: process.platform === 'win32' && 'links need privileges on Windows' }, () =>
{
    const dir = dirOf();
    const real = path.join(dir, 'real.json');
    const link = path.join(dir, 'link.json');
    fs.writeFileSync(real, '{\r\n    "a": 1\r\n}\r\n');
    fs.symlinkSync(real, link);
    writeLike(link, fs.readFileSync(link, 'utf8'), { a: 1, b: 2 });
    assert.ok(fs.lstatSync(link).isSymbolicLink(), 'the link is still a link');
    assert.strictEqual(fs.readFileSync(real, 'utf8'), '{\r\n    "a": 1,\r\n    "b": 2\r\n}\r\n');
});

// The installer, plus the two init scripts that write a person's settings file (the account settings.json among them).
const PERSON_FILE_WRITERS = ['hud-statusline.js', 'plugin-settings.js'];
test('every indented JSON write in the installer and the init settings writers goes through stringifyLike', () =>
{
    const dir = path.join(__dirname, 'install');
    const files = [...fs.readdirSync(dir).filter((n) => n.endsWith('.js')).map((n) => [n, path.join(dir, n)]),
        ...PERSON_FILE_WRITERS.map((n) => [n, path.join(__dirname, n)])].sort(([a], [b]) => a.localeCompare(b));
    const counts = {};
    const lines = [];
    for (const [name, file] of files)
    {
        fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) =>
        {
            if (!/JSON\.stringify\([^\n]*, null, /.test(line)) return;
            counts[name] = (counts[name] || 0) + 1;
            lines.push(`${name}:${i + 1}`);
        });
    }
    // The helper itself, the plan-out file (alfred-code.js) and the generated meta/rule-openings.json are machine files.
    const allowed = { 'alfred-code.js': 1, 'json-file.js': 1, 'rule-openings.js': 1 };
    assert.deepStrictEqual(counts, allowed, `indented JSON writes found: ${lines.join(', ')}`);
});
