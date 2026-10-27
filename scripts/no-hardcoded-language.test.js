'use strict';
// No language but English is hardcoded in what the plugin ships (the user's task of 2026-10-27): a skill, rule, hook,
// command or catalog file carries no Cyrillic word, and the behaviour a Ukrainian session needs comes from rules that
// name no language - answer in the user's language, keep the markers a hook reads in English. Tests may hold
// Ukrainian input, since they prove the hooks' English-only side.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SHIPPED = ['stack', 'setup-plugin', 'meta', 'docs/alfred-code.html', 'README.md'];

test('no Cyrillic word in a shipped file', () =>
{
    const files = execFileSync('git', ['-C', ROOT, 'ls-files', '--', ...SHIPPED], { encoding: 'utf8' }).split('\n').filter(Boolean);
    const hits = [];
    for (const rel of files)
    {
        let text;
        try { text = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { continue; }
        text.split('\n').forEach((line, i) => { if (/\p{Script=Cyrillic}/u.test(line)) hits.push(`${rel}:${i + 1}`); });
    }
    assert.deepStrictEqual(hits, []);
});

test('an auto-run contract tells the run to write its asks in English, the language the hook reads', () =>
{
    const hook = fs.readFileSync(path.join(ROOT, 'stack', 'hooks', 'guard-fresh-session-start.js'), 'utf8');
    assert.match(hook, /write every AskUserQuestion's questions and labels in English while auto-run is on/);
    const rule = fs.readFileSync(path.join(ROOT, 'stack', 'rules', 'alfred-interaction.md'), 'utf8');
    assert.match(rule, /the AskUserQuestion labels a hook reads - a commit or push consent, an ask under auto-run/);
});
