'use strict';
// update-workspace.md: the re-check of children an earlier update joined, on the items this update added (2026-11-19).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REFERENCES = path.join(__dirname, '..', 'setup-plugin', 'references');
const body = (name) => fs.readFileSync(path.join(REFERENCES, `${name}.md`), 'utf8');
const flat = (text) => text.replace(/\s+/g, ' ');
const askBlocks = (text) => [...text.matchAll(/^```ask\n([\s\S]*?)^```/gm)].map((m) => m[1].trim().split('\n'));
const labelsOf = (block) => block.slice(1).map((l) => (/^- '(.*)' - /.exec(l) || [])[1]);

test('the re-check section names added.txt, its sources and the --only call', () =>
{
    const text = flat(body('update-workspace'));
    assert.match(text, /## Children joined earlier - re-checked on the items this update added/);
    assert.match(text, /every `new:` row whose verdict is `arrives` and for each offer taken as an `--add`/);
    assert.match(text, /stack-select\.js" --redundant --only "\$TMP\/added\.txt" --installed "\$TMP\/parent\.json"/);
    assert.match(text, /that this run did NOT join \(not a `rescan:` row\) and that is not ignored/);
    assert.match(text, /No such row and no offer taken: the file stays empty, and this section runs nothing and asks nothing/);
    assert.match(text, /A grandchild is not checked here/);
    assert.match(text, /a missing file exits 2 with one line on stderr and no list, and an empty one prints nothing/);
});

test('the re-check ask is a second fit-style template: three options, the Recommended one first', () =>
{
    const asks = askBlocks(body('update-workspace')).filter((b) => /inherits <k> new item\(s\) from this update/.test(b[0]));
    assert.strictEqual(asks.length, 1);
    assert.match(asks[0][0], /fit none of its stacks: .* Ignore those here\?$/);
    assert.deepStrictEqual(labelsOf(asks[0]), ['Ignore the <k> suggested (Recommended)', 'Keep everything inherited', 'Pick']);
});

test('unattended, the re-check keeps everything inherited, and the walk and the slow path run it', () =>
{
    const text = flat(body('update-workspace'));
    assert.match(text, /Whenever nobody answers this ask - `unattended: on` or no ask tool - take 'Keep everything inherited', as the join ask does/);
    assert.match(flat(body('update-slow-path')), /run its re-check on the added items too/);
});

test('a nested cascade row is named in the plan text and the close, and is no follow-up', () =>
{
    assert.match(flat(body('update-workspace')), /the cascade counts it `nested` \(`cascade: <rel>` and `nested`, with one `cascade: <rel> is part of this repository now` line, no `!!`\)/);
    const close = flat(body('update-close'));
    assert.match(close, /`gone-kept` \/ `nested`/);
    assert.match(close, /A `nested` row is a child that is part of this repository now: it is not unfinished and puts nothing on the follow-ups card/);
});

test('one first call scans every child of both checks, with one numbering', () =>
{
    const text = flat(body('update-workspace'));
    assert.match(text, /the evidence scan of every child checked in this run - the ones joined now and the ones re-checked below - \(one `scan-evidence\.js` per child, `<n>` its number across both, joined ones first/);
    assert.match(text, /its first call already scanned each child checked here, under the same `<n>`/);
});

test('added.txt is written once step 2\'s new-items answer is applied, on either path', () =>
{
    const text = flat(body('update-workspace'));
    assert.match(text, /Once step 2's new-items answer is applied \(either path\), before the installer call, write one line/);
    assert.ok(!/Once step 4's answers/.test(text));
});

test('the walk\'s bullet carries the conditions of both checks, and stays under its cap', () =>
{
    const walk = flat(body('update-walk'));
    assert.match(walk, /- With a `rescan:` row, run `update-workspace\.md`'s fit check now; with a joined child this run did not join and a non-empty `\$TMP\/added\.txt`, its re-check\./);
    assert.ok(body('update-walk').length <= 24000, 'the C15 cap');
});

test('the close reports the ignores of a re-checked child too', () =>
{
    assert.match(flat(body('update-close')), /report each project joined or re-checked by this update and the ignores applied to it, one line each/);
});
