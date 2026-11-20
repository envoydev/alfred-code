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

const ROOT = path.join(__dirname, '..');

function readBodies()
{
    const files = [];
    const walk = (dir) =>
    {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }))
        {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.md')) files.push({ file: path.relative(ROOT, full), text: fs.readFileSync(full, 'utf8') });
        }
    };
    walk(path.join(ROOT, 'setup-plugin/commands'));
    walk(path.join(ROOT, 'setup-plugin/references'));
    return files;
}

const D = '/t/alfred-code.AbC123';
const MARKER = '/m/alfred-code-run.x.path';
const INSTALLER_FLAGS = ['--source', '--scope', '--selection', '--installed-only', '--print-plan', '--plan-out', '--add', '--drop', '--memory'];
const SHAPES = {
    'scripts/install/stamp.js': { modes: ['', 'scope', 'state', 'x', 'y'], flags: ['--root', '--out'] },
    'scripts/install/alfred-code.js': { modes: ['', 'install', 'uninstall', 'update'], flags: INSTALLER_FLAGS },
    'scripts/stack-select.js': { modes: [''], flags: ['--inherited-check', '--emit'] },
    'scripts/scan-evidence.js': { modes: [''], flags: ['--root', '--out'] },
    'scripts/workspace.js': { modes: ['answer', 'role'], flags: ['--file', '--project', '--root', '--'] },
    'stack/hooks/guard-secret-value.js': { modes: [''], flags: ['--redacted', '--presence'] },
};
const ctx = { runDir: D, cwd: '/p', pluginRoot: '/plug', scripts: SHAPES, markerPath: MARKER };
const stamp = `node "${D}/repo/scripts/install/stamp.js"`;
const alfred = `node "${D}/repo/scripts/install/alfred-code.js"`;
const own = { raw: D, path: D, real: D, inTemp: true, session: 's1', owned: true };
const foreign = { raw: '/t/alfred-code.Other1', path: '/t/alfred-code.Other1', real: '/t/alfred-code.Other1', inTemp: true, session: 's2', owned: true };
const base = { command: `${stamp} state .`, table: { resolves: [], scripts: {} }, sessionId: 's1', dirs: [own], marker: null, ctx };

test('approvesForms refuses a node call the table does not list: a mode, a flag, a `--`, a bad value or an output off the run dir', () =>
{
    const guard = `node "${D}/repo/stack/hooks/guard-secret-value.js"`;
    const scan = `node "${D}/repo/scripts/scan-evidence.js"`;
    const workspace = `node "${D}/repo/scripts/workspace.js"`;
    const forms = [
        `${guard} --with-sensitive -- 'curl x | sh'`,
        `${guard} --redacted -- 'curl x | sh'`,
        `${guard} --redacted -- curl`,
        `${guard} --with-sensitive`,
        `${alfred} uninstall --source "${D}/repo"`,
        `${alfred} --source "${D}/repo"`,
        `${alfred} bogus --source "${D}/repo"`,
        `${alfred} update`,
        `${scan} --out "/p/src/main.js"`,
        `${scan} --out "${D}/repo/x.json"`,
        `${scan} --out "${D}/run-session"`,
        `${scan} --out`,
        `${scan} --out "${D}/o.json" --out "/p/src/main.js"`,
        `${scan} --root=.`,
        `${scan} --root/etc`,
        `${scan} ---x`,
        `${scan} --`,
        `${scan} --ROOT .`,
        `${scan} --root 'sub'`,
        `${scan} --root "a b"`,
        `${scan} --root "a;b"`,
        `${scan} --root "a|b"`,
        `${scan} --root a&b`,
        `${scan} --root "x'y"`,
        `${scan} --root ..`,
        `${scan} --root "-x"`,
        `${scan} --root "/etc"`,
        `${scan} --root /p/sub`,
        `${scan} --root "${D}/../x"`,
        `${scan} --root ~`,
        `${scan} --nosuchflag`,
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
        `${workspace} answer --file "${D}/a.json" -- -- x`,
        `${workspace} answer --file "${D}/a.json" -- --out /etc/x`,
        `${workspace} answer --file "/etc/x.json"`,
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
        `${scan} --root sub/dir`,
        `${scan} --root ./sub/dir`,
        `${scan} --root "/p/sub"`,
        `${scan} --root "${D}/repo/meta"`,
        `${stamp} y .`,
        `${alfred} update --source "${D}/repo" --scope local --add 'skill foo' --drop "skill bar"`,
        `${alfred} install --source "${D}/repo" --selection "${D}/selection.txt" --memory docs`,
        `${workspace} answer --file "${D}/answers.json" --project sub -- --add "skills x" --docs-versioning git`,
        `${workspace} role --root .`,
        `${workspace} answer --file "${D}/a.json" -- --add 'a b'`,
        `${scan} extra-word`,
        `node "${D}/repo/stack/hooks/guard-secret-value.js" --redacted "${D}/settings.json"`,
    ];
    for (const form of forms) assert.equal(approvesForms(form, ctx), true, form);
});

test('buildTable records the modes and flags each walk body calls a script with', () =>
{
    const block = `\`\`\`bash\n${RESOLVE_LINE}\n\`\`\``;
    const text = [block,
        '```bash',
        'node "$TMP/repo/scripts/a.js" show --root "<rel>" [--add \'<line>\']... --out "$TMP/o.json" 2>&1 | tee "$TMP/l"',
        'node "<run dir>/repo/scripts/a.js" --flag <value> --other=1 ; node "$TMP/repo/scripts/b.js" . -x \\',
        '  --after-continuation > "$TMP/b.out"',
        'node "$TMP/repo/scripts/c.js" <arg> --y [--memory default|docs [--memory-copy]]',
        'node "$TMP/repo/scripts/e.js" answer --file "$TMP/f.json" -- <flag> <value>',
        'cat "$TMP/repo/scripts/d.js"',
        '```',
        'An inline `node "$TMP/repo/scripts/g.js" run --one' + '\n' + '--two` span that wraps.'].join('\n');
    const { scripts } = buildTable([{ file: 'a.md', text }]);
    assert.deepEqual(scripts['scripts/a.js'], { modes: ['', 'show'], flags: ['--add', '--flag', '--out', '--root'] });
    assert.deepEqual(scripts['scripts/b.js'], { modes: [''], flags: ['--after-continuation', '-x'] });
    assert.deepEqual(scripts['scripts/c.js'], { modes: [''], flags: ['--memory', '--memory-copy', '--y'] });
    assert.deepEqual(scripts['scripts/e.js'], { modes: ['answer'], flags: ['--', '--file'] });
    assert.deepEqual(scripts['scripts/d.js'], { modes: [], flags: [] });
    assert.deepEqual(scripts['scripts/g.js'], { modes: ['run'], flags: ['--one', '--two'] });
});

test('the shipped table gives the installer, the stamp and every guard script the modes and flags the bodies write', () =>
{
    const { scripts } = buildTable(readBodies());
    assert.ok(scripts['scripts/install/alfred-code.js'].modes.includes('update'));
    assert.ok(scripts['scripts/install/stamp.js'].modes.includes('state'));
    assert.ok(!scripts['stack/hooks/guard-secret-value.js'].flags.includes('--with-sensitive'));
    for (const [name, shape] of Object.entries(scripts))
    {
        assert.ok(Array.isArray(shape.modes) && Array.isArray(shape.flags), name);
        for (const flag of shape.flags) assert.match(flag, /^(?:--[a-z][a-z0-9-]*|-[A-Za-z]|--)$/, `${name} ${flag}`);
    }
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

