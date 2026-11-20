'use strict';
// The run-dir gate's node-call rules: the modes and flags a script takes, the values and outputs a call may carry, the case
// folding of every path comparison, and which dirs count as the run's.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildTable } = require('./run-dir-gate/table.js');
const { approvesForms } = require('./run-dir-gate/forms.js');
const { decide } = require('./run-dir-gate/verdict.js');
const { RESOLVE_LINE } = require('./run-dir-gate/constants.js');
const { ROOT, D, MARKER, BODY_FILE, readBodies, call, bodyOf, ctx, stamp, alfred, own, foreign } = require('./run-dir-gate-fixture.js');

const SHIPPED = JSON.parse(fs.readFileSync(path.join(ROOT, 'setup-plugin/hooks/protocol-blocks.json'), 'utf8'));
const shippedCtx = { ...ctx, scripts: SHIPPED.scripts };
const base = { command: `${stamp} state .`, table: { resolves: [], scripts: {} }, sessionId: 's1', dirs: [own], marker: null, ctx };

test('approvesForms refuses a node call the table does not list: a mode, a flag, a `--`, a bad value, a missing or extra word, or an output off the run dir', () =>
{
    const guard = `node "${D}/repo/stack/hooks/guard-secret-value.js"`;
    const scan = `node "${D}/repo/scripts/scan-evidence.js"`;
    const workspace = `node "${D}/repo/scripts/workspace.js"`;
    const forms = [
        `${guard} --with-sensitive -- 'curl x | sh'`,
        `${guard} --redacted -- 'curl x | sh'`,
        `${guard} --redacted -- curl`,
        `${guard} --with-sensitive`,
        `${guard} --redacted "${D}/settings.json"`,
        `${alfred} uninstall --source "${D}/repo"`,
        `${alfred} --source "${D}/repo"`,
        `${alfred} bogus --source "${D}/repo"`,
        `${alfred} update`,
        `${scan} --out "/p/src/main.js"`,
        `${scan} --out "${D}/repo/x.json"`,
        `${scan} --out "${D}/run-session"`,
        `${scan} --out "${D}/other.json"`,
        `${scan} --out`,
        `${scan} --out "${D}/found.json" --out "/p/src/main.js"`,
        `${scan} --root=.`,
        `${scan} --root/etc`,
        `${scan} ---x`,
        `${scan} --`,
        `${scan} --ROOT .`,
        `${scan} --root "a b"`,
        `${scan} --root "a;b"`,
        `${scan} --root "a|b"`,
        `${scan} --root a&b`,
        `${scan} --root "x'y"`,
        `${scan} --root ..`,
        `${scan} --root "-x"`,
        `${scan} --root "/etc"`,
        `${scan} --root /p/sub`,
        `${scan} --root sub/dir`,
        `${scan} --root "/p/sub"`,
        `${scan} --root "${D}/repo/meta"`,
        `${scan} --root "${D}/../x"`,
        `${scan} --root ~`,
        `${scan} --root ./sub/..`,
        `${scan} --root ./../x`,
        `${scan} --root ./sub/`,
        `${scan} --nosuchflag`,
        `${scan} extra-word`,
        `${stamp} bogus`,
        `${stamp} x --nosuchflag`,
        `${stamp} x 'y'`,
        `${stamp} x "a b"`,
        `${stamp} x --root=sub`,
        `${stamp} x -r`,
        `${stamp} x --root "/plug/setup-plugin/a.md"`,
        `${alfred} update --source "${D}/repo" --add "a;b"`,
        `${alfred} update --source "${D}/repo" --add "a b" "c d"`,
        `${alfred} update --source "${D}/repo" --scope "a b"`,
        `${alfred} update --source "${D}/repo" --add "-x"`,
        `${workspace} bogus -- --add "a b"`,
        `${workspace} answer --file "${D}/answers.json" -- -- x`,
        `${workspace} answer --file "${D}/answers.json" -- --out /etc/x`,
        `${workspace} answer --file "${D}/answers.json" -- --add "a b"`,
        `${workspace} answer --file "/etc/x.json"`,
        `${workspace} answer --file "${D}/a.json"`,
    ];
    for (const form of forms) assert.equal(approvesForms(form, ctx), false, JSON.stringify(form));
});

test('approvesForms passes the argument shapes the walk bodies write', () =>
{
    const scan = `node "${D}/repo/scripts/scan-evidence.js"`;
    const workspace = `node "${D}/repo/scripts/workspace.js"`;
    const forms = [
        `${scan} --root . --out "${D}/found.json"`,
        `${scan} --root "x" --out "${D}/found-2.json"`,
        `${scan} --root 'sub'`,
        `${scan} --root ./sub/dir`,
        `${scan} --root . --catalog "${D}/repo/meta/evidence.json"`,
        `${stamp} y .`,
        `${stamp} x`,
        `${stamp} x .`,
        `${alfred} update --source "${D}/repo" --scope local --add 'skill foo' --drop "skill bar"`,
        `${alfred} update --source "${D}/repo" --memory docs`,
        `${alfred} install --source "${D}/repo" --selection "${D}/selection.txt" --memory docs`,
        `${workspace} answer --file "${D}/answers.json" --project sub -- --add skills --docs-versioning git`,
        `${workspace} answer --file "${D}/answers.json" --hold`,
        `${workspace} role --root .`,
        `${workspace} role --root . --answer join`,
        `node "${D}/repo/stack/hooks/guard-secret-value.js" --redacted settings.json`,
    ];
    for (const form of forms) assert.equal(approvesForms(form, ctx), true, form);
});

test('approvesForms refuses a flag value that points at code or data in the project or off this run dir, on the shipped table', () =>
{
    const at = (script) => `node "${D}/repo/${script}"`;
    const preflight = at('scripts/update-preflight.js');
    const workspace = at('scripts/workspace.js');
    const settings = at('scripts/plugin-settings.js');
    const forms = [
        `${preflight} --snapshot "/p/evil" --root .`,
        `${preflight} --snapshot evil --root .`,
        `${preflight} --snapshot "./evil" --root .`,
        `${preflight} --snapshot "${D}/other" --root .`,
        `${workspace} cascade --root . --source evil --answers "${D}/answers.json"`,
        `${workspace} cascade --root . --source "/p/x" --answers "${D}/answers.json"`,
        `${workspace} cascade --root . --source "${D}/other" --answers "${D}/answers.json"`,
        `${workspace} cascade --root . --source "${D}/repo" --answers "/p/x.json"`,
        `${settings} --catalog "/p/evil.json" --apply`,
        `${settings} --catalog "./evil.json" --apply`,
        `${settings} --catalog "${D}/repo/meta/plugin-settings.json" --config-dir /home/u/.claude --installed x --apply`,
        `${workspace} answer --hold --file "/p/package.json"`,
        `${workspace} answer --hold --file "./package.json"`,
        `${workspace} answer --file "${D}/answers.json" --answers "/p/x.json"`,
        `${workspace} role --root . --file "${D}/answers.json"`,
        `${workspace} cascade --root . --source "${D}/repo" --answers "${D}/answers.json" --apply`,
        `${at('scripts/variables.js')} show --root . extra`,
        `${at('scripts/variables.js')} set --root . --scope a/b KEY=value`,
        `${at('scripts/variables.js')} set --root . --scope x OTHER=value`,
        `${at('scripts/stack-select.js')} --recs "/p/recs.json" --stacks x`,
        `${at('scripts/stack-select.js')} --selection "./raw.json"`,
        `${at('scripts/stamp-compare.js')} --snapshot "/p/evil" --stamp .claude/alfred-code.stamp`,
        `${at('scripts/stamp-compare.js')} --snapshot "${D}/repo" --stamp "/p/other.stamp"`,
        `${at('scripts/workspace.js')} ignore --root . --add 'a;b c'`,
        `${at('scripts/workspace.js')} ignore --root . --add 'a/b c'`,
        `${at('scripts/workspace.js')} ignore --root . --add "a\"b"`,
    ];
    for (const form of forms) assert.equal(approvesForms(form, shippedCtx), false, JSON.stringify(form));
    const good = [
        `${preflight} --snapshot "${D}/repo" --root .`,
        `${workspace} cascade --root . --source "${D}/repo" --answers "${D}/answers.json"`,
        `${settings} --catalog "${D}/repo/meta/plugin-settings.json" --config-dir x --installed a,b --apply`,
        `${workspace} answer --file "${D}/answers.json" --hold`,
        `${at('scripts/variables.js')} set --root . --scope local KEY=value`,
        `${at('scripts/stamp-compare.js')} --snapshot "${D}/repo" --stamp .claude/alfred-code.stamp`,
        `${workspace} ignore --root . --add 'skills foo'`,
    ];
    for (const form of good) assert.equal(approvesForms(form, shippedCtx), true, form);
});

test('a flag of another mode of the same script, a positional the template lacks, and a `word` or a `phrase` off its class all refuse', () =>
{
    const workspace = `node "${D}/repo/scripts/workspace.js"`;
    const forms = [
        `${workspace} status --root . --answer join`,
        `${workspace} role --root . --rescan`,
        `${workspace} cascade --root . --source "${D}/repo" --hold`,
        `${workspace} role --root . extra`,
        `${stamp} scope . extra`,
        `${stamp} scope`,
        `${workspace} role --root . --answer a/b`,
        `${workspace} role --root . --answer 'a b'`,
        `${workspace} role --root . --answer "a\\b"`,
        `${workspace} role --root . --answer a:b`.replace('a:b', 'a$b'),
        `${alfred} update --source "${D}/repo" --add 'a/b'`,
        `${alfred} update --source "${D}/repo" --add 'a  b'`,
        `${alfred} update --source "${D}/repo" --add ' a'`,
        `${alfred} update --source "${D}/repo" --add 'a~b'`,
        `${alfred} update --source "${D}/repo" --add 'a*'`,
        `${alfred} update --source "${D}/repo" --add 'a"b'`,
    ];
    for (const form of forms) assert.equal(approvesForms(form, ctx), false, JSON.stringify(form));
    assert.equal(approvesForms(`${workspace} role --root . --answer a:b,c=d+e@f_g.h-i`, ctx), true, 'every character of the word class passes');
    assert.equal(approvesForms(`${alfred} update --source "${D}/repo" --add 'a:b c,d'`, ctx), true, 'a phrase of words of that class joined by single spaces passes');
});

test('buildTable writes a template per script and mode from the calls the four walks run, and only those', () =>
{
    const fenced = (...lines) => ['```bash', ...lines, '```'].join('\n');
    const init = [
        bodyOf([
            'node "$TMP/repo/scripts/a.js" show --root "<rel>" [--add \'<line>\']... --out "$TMP/o-<n>.json" 2>&1 | tee "$TMP/l"',
            'node "<run dir>/repo/scripts/a.js" show --flag <value> --root . ; node "$TMP/repo/scripts/b.js" . -x',
            'node "$TMP/repo/scripts/c.js" <arg> --y --memory default|docs --scope "<a> <b>" --sel "$TMP/repo/meta/x.json"',
            'node "$TMP/repo/scripts/e.js" answer --file "$TMP/f.json" -- <flag> <value>',
            'node "$TMP/repo/scripts/e.js" answer --file "$TMP/f.json" --hold',
            'node "${CLAUDE_PLUGIN_ROOT}/scripts/p.js" x',
            'cat "$TMP/repo/scripts/d.js"',
        ]),
        'Reads references/walk.md, references/update-history.md and references/outside.md.',
        'An inline `node "$TMP/repo/scripts/g.js" run --one \'<line>\'` span.',
    ].join('\n');
    const bodies = [
        { file: BODY_FILE, text: init },
        { file: 'setup-plugin/references/walk.md', text: fenced('node "$TMP/repo/scripts/h.js" go .') },
        { file: 'setup-plugin/references/update-history.md', text: fenced('node "$TMP/repo/scripts/never-history.js" x') },
        { file: 'setup-plugin/references/not-linked.md', text: fenced('node "$TMP/repo/scripts/never-linked.js" x') },
        { file: 'setup-plugin/commands/uninstall.md', text: fenced('node "$TMP/repo/scripts/never-uninstall.js" x') },
    ];
    const { scripts } = buildTable(bodies);
    assert.deepEqual(Object.keys(scripts), ['scripts/a.js', 'scripts/b.js', 'scripts/c.js', 'scripts/e.js', 'scripts/g.js', 'scripts/h.js']);
    const literal = (value) => ({ kind: 'literal', value });
    const kind = (name) => ({ kind: name });
    assert.deepEqual(scripts['scripts/a.js'].show.flags, { '--add': [kind('phrase')], '--flag': [kind('word')], '--out': [{ kind: 'runDir', suffix: 'o-<n>.json' }], '--root': [kind('cwdPath'), kind('word')] });
    assert.deepEqual(scripts['scripts/a.js'].show.positionals, [[]]);
    assert.deepEqual(scripts['scripts/b.js'][''], { positionals: [[kind('cwdPath')]], flags: { '-x': [true] } });
    assert.deepEqual(scripts['scripts/c.js'][''].positionals, [[kind('word')]]);
    assert.deepEqual(scripts['scripts/c.js'][''].flags, { '--memory': [literal('default'), literal('docs')], '--scope': [kind('phrase')], '--sel': [{ kind: 'runDir', suffix: 'repo/meta/x.json' }], '--y': [true] });
    assert.deepEqual(scripts['scripts/e.js'].answer.flags, { '--': [kind('word')], '--file': [{ kind: 'runDir', suffix: 'f.json' }], '--hold': [true] });
    assert.deepEqual(scripts['scripts/g.js'].run.flags, { '--one': [kind('phrase')] });
    assert.deepEqual(scripts['scripts/h.js'].go.positionals, [[kind('cwdPath')]]);
});

test('the shipped table is what the generator writes now, and every template in it is a known kind', () =>
{
    assert.deepEqual(buildTable(readBodies()).scripts, SHIPPED.scripts);
    const kinds = new Set(['literal', 'word', 'phrase', 'runDir', 'cwdPath']);
    let count = 0;
    for (const [name, modes] of Object.entries(SHIPPED.scripts))
    {
        for (const [mode, shape] of Object.entries(modes))
        {
            const where = `${name} ${mode}`;
            assert.ok(Array.isArray(shape.positionals) && shape.flags && typeof shape.flags === 'object', where);
            for (const sequence of shape.positionals) for (const template of sequence) assert.ok(kinds.has(template.kind), where);
            for (const [flag, entries] of Object.entries(shape.flags))
            {
                assert.match(flag, /^(?:--[a-z][a-z0-9-]*|-[A-Za-z]|--)$/, `${where} ${flag}`);
                for (const entry of entries) { assert.ok(entry === true || kinds.has(entry.kind), `${where} ${flag}`); count++; }
            }
        }
    }
    assert.ok(count > 100, `${count} flag templates`);
    for (const never of ['scripts/never-history.js', 'scripts/gate.js', 'scripts/run-tests.js']) assert.ok(!(never in SHIPPED.scripts));
    assert.ok('update' in SHIPPED.scripts['scripts/install/alfred-code.js'] && 'state' in SHIPPED.scripts['scripts/install/stamp.js']);
    assert.ok(!('--with-sensitive' in SHIPPED.scripts['stack/hooks/guard-secret-value.js']['']));
});

test('approvesForms refuses a write whose folded path lands in the snapshot, on run-session or off plain ASCII segments', () =>
{
    const scan = `node "${D}/repo/scripts/scan-evidence.js"`;
    const forms = [
        `${stamp} x > "${D}/Repo/x"`,
        `${stamp} x > "${D}/REPO/scripts/install/stamp.js"`,
        `${stamp} x > "${D}/Run-Session"`,
        `${stamp} x > "${D}/RUN-SESSION"`,
        `${stamp} x | tee "${D}/RUN-SESSION"`,
        `${stamp} x | tee "${D}/Repo/y"`,
        `${stamp} x > "${D}/é.txt"`,
        `${stamp} x > "${D}/sub/K.txt"`,
        `${stamp} x | tee "${D}/run-sessiön"`,
        `${stamp} x > "${D}/a b.txt"`,
        `${stamp} x > "${D}/REPO"`,
        `${scan} --out "${D}/Repo/x.json"`,
        `${scan} --out "${D}/RUN-SESSION"`,
        `${scan} --out "${D}/é.json"`,
        `(cd ".." && ${alfred} update --source "${D}/repo" --installed-only --print-plan --plan-out "${D}/Repo/p.json")`,
        `(cd ".." && ${alfred} update --source "${D}/repo" --installed-only --print-plan --plan-out "${D}/RUN-SESSION")`,
    ];
    for (const form of forms) assert.equal(approvesForms(form, ctx), false, JSON.stringify(form));
    assert.equal(approvesForms(`${stamp} x > "${D}/Out-1.txt"`, ctx), true, 'a mixed-case file name of plain characters stays a target');
    assert.equal(approvesForms(`${stamp} x | tee "${D}/sub/.a_b-1.log"`, ctx), true);
});

test('approvesForms refuses a target or a read whose path segment ends in a dot or a space, where Windows reads it as the name without it', () =>
{
    const winRun = 'C:\\Temp\\alfred-code.AbC123';
    const win = { ...ctx, runDir: winRun, cwd: 'C:\\p', pluginRoot: 'C:\\plug' };
    const winStamp = `node "${winRun}\\repo\\scripts\\install\\stamp.js"`;
    const refused = [
        `${winStamp} x --out "${winRun}\\run-session."`,
        `${winStamp} x --out "${winRun}\\o.json."`,
        `${winStamp} x > "${winRun}\\repo.\\scripts\\install\\stamp.js"`,
        `${winStamp} x > "/c/Temp/alfred-code.AbC123/repo./x"`,
        `${winStamp} x > "/c/Temp/alfred-code.AbC123/run-session."`,
        `${winStamp} x | tee "${winRun}\\repo.\\x"`,
        `${winStamp} x | tee "${winRun}\\repo \\x"`,
        `${winStamp} x > "${winRun}\\a."`,
        `${winStamp} x > "${winRun}\\sub.\\a"`,
        `cat "${winRun}\\repo \\x"`,
        `cat "${winRun}\\repo.\\scripts\\install\\stamp.js"`,
        `cat "${winRun}\\x."`,
        `head -8 "${winRun}\\repo.\\x"`,
        `grep -E 'x' "${winRun}\\repo \\x"`,
        `${winStamp} x --root ./sub.`,
        `${winStamp} x --root ./sub./dir`,
    ];
    for (const form of refused) assert.equal(approvesForms(form, win), false, JSON.stringify(form));
    const posix = [
        `${stamp} x > "${D}/repo./x"`,
        `${stamp} x > "${D}/o."`,
        `${stamp} x | tee "${D}/sub./a"`,
        `cat "${D}/repo /x"`,
        `cat "${D}/repo./x"`,
        `cat "${D}/x."`,
        `${stamp} x --out "${D}/o."`,
        `${stamp} x --root ./sub.`,
    ];
    for (const form of posix) assert.equal(approvesForms(form, ctx), false, JSON.stringify(form));
    const allowed = [`${stamp} x > "${D}/o.json"`, `${stamp} x | tee "${D}/sub/.a_b-1.log"`, `cat "${D}/repo/scripts/x.js"`, `cat "${D}/.hidden"`, `${stamp} x --root ./sub.d/dir_1`];
    for (const form of allowed) assert.equal(approvesForms(form, ctx), true, form);
});

test('decide allows a dir only on a trusted marker that names it, or with no such marker when it sits in the hook\'s temp dir', () =>
{
    const outside = { ...own, inTemp: false };
    const marker = { path: MARKER, dir: D, session: 's1', owned: true };
    assert.deepEqual(decide({ ...base, dirs: [outside], marker: null }), { decision: null }, 'no marker, not in the temp dir');
    assert.deepEqual(decide({ ...base, dirs: [{ ...outside, inTemp: undefined }], marker: null }), { decision: null }, 'no inTemp at all');
    assert.deepEqual(decide({ ...base, dirs: [own], marker: null }), { decision: 'allow' }, 'no marker, in the temp dir');
    assert.deepEqual(decide({ ...base, dirs: [outside], marker }), { decision: 'allow' }, 'a trusted marker names it');
    assert.deepEqual(decide({ ...base, dirs: [outside], marker: { ...marker, owned: false } }), { decision: null }, 'an unowned marker is no proof');
    assert.deepEqual(decide({ ...base, dirs: [outside], marker: { ...marker, session: 's2' } }), { decision: null }, 'another session\'s marker is no proof');
    assert.deepEqual(decide({ ...base, dirs: [own], marker: { ...marker, session: 's2', dir: foreign.raw } }), { decision: 'allow' }, 'an untrusted marker naming another dir leaves the temp rule');
    assert.deepEqual(decide({ ...base, dirs: [outside], marker: { ...marker, session: 's2', dir: foreign.raw } }), { decision: null });
});

test('decide compares the marker\'s dir and a named dir by real path when it has one', () =>
{
    const marker = { path: MARKER, dir: '/var/t/alfred-code.AaAaAa', realDir: '/private/var/t/alfred-code.AaAaAa', session: 's1', owned: true };
    const spelled = { raw: '/private/var/t/alfred-code.AaAaAa', path: '/private/var/t/alfred-code.AaAaAa', real: '/private/var/t/alfred-code.AaAaAa', inTemp: false, session: 's1', owned: true };
    const form = `node "${spelled.raw}/repo/scripts/install/stamp.js" state .`;
    const spelledCtx = { ...ctx, runDir: spelled.raw };
    assert.deepEqual(decide({ ...base, command: form, dirs: [spelled], marker, ctx: spelledCtx }), { decision: 'allow' });
    assert.equal(decide({ ...base, command: form, dirs: [spelled], marker: { ...marker, realDir: '/private/var/t/alfred-code.Other1' }, ctx: spelledCtx }).decision, 'deny');
    assert.equal(decide({ ...base, command: form, dirs: [spelled], marker: { ...marker, realDir: undefined }, ctx: spelledCtx }).decision, 'deny', 'without a real path the text decides');
});

