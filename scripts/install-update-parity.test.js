'use strict';
// An update from an older release equals a fresh install of this tree (plugin route). `/alfred-code:update` is
// `update --installed-only` with no --selection; whatever it leaves different from a fresh install of the same picks - a file,
// a settings key, a stamp line - is a leftover the next reader trips on (an empty .claude/settings.json was the first).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { realLong } = require('./test-paths.js');
const { seedRun, releaseExport, skipWithout, updateInstalled } = require('./seed-sandbox.js');

const SELECTION = 'agent aspnet-implementer\nrule markdown-docs\n';
const PLUGINS = JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, scope: 'user' }]);
const TAGS = ['v3.0.0', 'v3.14.2'];
const SKIPPED_PATH = /(^|\/)(state|statistics)(\/|$)|\.stamp$|\.lock$/;
const VARIABLES_FILE = '.alfred/.variables';
const STAMP_FILE = '.claude/alfred-code.stamp';
const STAMP_KEYS_IGNORED = new Set(['source', 'installed', 'installed-ms', 'version', 'initialised', 'commit', 'action']);

// A JSON value with its object keys sorted, so key order never counts.
const sorted = (value) => (Array.isArray(value) ? value.map(sorted)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, sorted(value[k])])) : value);

// Every file under .claude/ and .alfred/ as { relative path -> comparable text }; the sandbox's own paths are named, not compared.
function snapshotOf(repo)
{
    const roots = [repo, realLong(repo), path.dirname(repo), realLong(path.dirname(repo))];
    const neutral = (text) => roots.reduce((out, root) => out.split(root).join('<sandbox>'), text);
    const files = new Map();
    const walk = (dir) =>
    {
        for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [])
        {
            const at = path.join(dir, entry.name);
            const rel = path.relative(repo, at).split(path.sep).join('/');
            if (SKIPPED_PATH.test(rel)) continue;
            if (entry.isSymbolicLink()) { files.set(rel, `link -> ${neutral(fs.readlinkSync(at))}`); continue; }
            if (entry.isDirectory()) { walk(at); continue; }
            const text = neutral(fs.readFileSync(at, 'utf8'));
            if (rel === VARIABLES_FILE) files.set(rel, JSON.stringify(text.split(/\r?\n/).filter(Boolean).sort()));
            else if (rel.endsWith('.json')) { try { files.set(rel, JSON.stringify(sorted(JSON.parse(text)))); continue; } catch { /* compared as text */ } files.set(rel, text); }
            else files.set(rel, text);
        }
    };
    for (const top of ['.claude', '.alfred']) walk(path.join(repo, top));
    const stamp = fs.existsSync(path.join(repo, STAMP_FILE)) ? fs.readFileSync(path.join(repo, STAMP_FILE), 'utf8') : '';
    for (const line of stamp.split(/\r?\n/))
    {
        const key = /^([a-z-]+): /.exec(line);
        if (key && !STAMP_KEYS_IGNORED.has(key[1])) files.set(`stamp line ${line}`, 'present');
    }
    return files;
}

function differences(fresh, updated)
{
    const out = [];
    for (const key of new Set([...fresh.keys(), ...updated.keys()]).values())
    {
        if (fresh.get(key) === updated.get(key)) continue;
        const show = (v) => (v === undefined ? 'absent' : String(v).slice(0, 160));
        out.push(`${key}: fresh install ${show(fresh.get(key))} | update ${show(updated.get(key))}`);
    }
    return out.sort();
}

let freshInstall = null;
const fresh = () => { freshInstall ||= seedRun(['install'], SELECTION, { plugins: PLUGINS, inspect: snapshotOf }).result; return freshInstall; };

for (const tag of TAGS)
{
    test(`an update from ${tag} leaves what a fresh install of this tree leaves (plugin route)`, skipWithout(tag), () =>
    {
        const old = releaseExport(tag);
        const { result } = seedRun(['install'], SELECTION, { plugins: PLUGINS, source: old, seed: path.join(old, 'scripts', 'install', 'alfred-code.js'),
            inspect: (repo) => { updateInstalled(repo); return snapshotOf(repo); } });
        const found = differences(fresh(), result);
        assert.deepStrictEqual(found, [], `${found.length} differences between an update from ${tag} and a fresh install:\n${found.join('\n')}`);
    });
}
