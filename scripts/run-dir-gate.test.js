'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { findRunDirs, mapRunDir } = require('./run-dir-gate/dirs.js');
const { gitBlobSha1, markerName } = require('./run-dir-gate/marker.js');
const { buildTable, isResolve, fenceBlocks, withoutComments, normalize } = require('./run-dir-gate/table.js');
const { approvesForms, approvesPluginRead } = require('./run-dir-gate/forms.js');
const { decide, hookOutput } = require('./run-dir-gate/verdict.js');
const { RESOLVE_LINE, OFF_SWITCH, REASON } = require('./run-dir-gate/constants.js');

const { ROOT, D, MARKER, readBodies, SHAPES, ctx, stamp, alfred, own, foreign, BODY_FILE } = require('./run-dir-gate-fixture.js');

const PROTOCOL = fs.readFileSync(path.join(ROOT, 'setup-plugin/references/source-protocol.md'), 'utf8');
const resolveBlock = fenceBlocks(PROTOCOL).find((block) => block.lang === 'bash' && block.body.includes(RESOLVE_LINE)).body;

test('findRunDirs finds a run dir in each spelling and nothing in the shipped resolve block', () =>
{
    assert.deepEqual(findRunDirs('ls "/var/folders/x/T/alfred-code.AbC123/repo"'), ['/var/folders/x/T/alfred-code.AbC123']);
    assert.deepEqual(findRunDirs('cat "C:\\Users\\u\\AppData\\Local\\Temp\\alfred-code.AbC123\\a.txt"'), ['C:\\Users\\u\\AppData\\Local\\Temp\\alfred-code.AbC123']);
    assert.deepEqual(findRunDirs('cat "C:/Users/u/Temp/alfred-code.AbC123/a.txt"'), ['C:/Users/u/Temp/alfred-code.AbC123']);
    assert.deepEqual(findRunDirs('cat "/c/Users/u/Temp/alfred-code.AbC123/a.txt"'), ['/c/Users/u/Temp/alfred-code.AbC123']);
    assert.deepEqual(findRunDirs('cat /t/alfred-code.AbC123/a /t/alfred-code.Zzz999/b /t/alfred-code.AbC123/c'), ['/t/alfred-code.AbC123', '/t/alfred-code.Zzz999']);
    assert.deepEqual(findRunDirs(resolveBlock), []);
    assert.deepEqual(findRunDirs('mktemp -d "$TD/alfred-code.XXXXXX"'), []);
    assert.deepEqual(findRunDirs('curl https://x.test/releases/latest/download/alfred-code.tar.gz -o /a/download/alfred-code.tar.gz'), []);
    assert.deepEqual(findRunDirs('tar -xzf "$TMP/alfred-code.tar.gz"'), []);
    assert.deepEqual(findRunDirs('cat /t/alfred-code.AbC1234/x'), []);
});

test('mapRunDir keeps a POSIX path, rewrites an MSYS drive path and gives up when cygpath cannot map', () =>
{
    const none = () => null;
    assert.equal(mapRunDir('/var/T/alfred-code.AbC123', 'darwin', none), '/var/T/alfred-code.AbC123');
    assert.equal(mapRunDir('/c/x/alfred-code.AbC123', 'win32', none), 'C:\\x\\alfred-code.AbC123');
    assert.equal(mapRunDir('C:\\x\\alfred-code.AbC123', 'win32', none), 'C:\\x\\alfred-code.AbC123');
    assert.equal(mapRunDir('C:/x/alfred-code.AbC123', 'win32', none), 'C:/x/alfred-code.AbC123');
    assert.equal(mapRunDir('/tmp/alfred-code.AbC123', 'win32', none), null);
    assert.equal(mapRunDir('/tmp/alfred-code.AbC123', 'win32', (p) => `C:\\msys64${p.replace(/\//g, '\\')}`), 'C:\\msys64\\tmp\\alfred-code.AbC123');
});

test('gitBlobSha1 equals git hash-object and markerName equals the resolve block\'s own shell output', (t) =>
{
    const probe = spawnSync('bash', ['-c', 'git --version'], { encoding: 'utf8' });
    if (probe.status !== 0) { t.skip('bash or git is missing'); return; }
    const markLine = resolveBlock.split('\n').find((line) => line.startsWith('MARK='));
    assert.ok(markLine, 'the resolve block has a MARK= line');
    const roots = ['/srv/some one/My Project', `/${'very-long-directory-name/'.repeat(4)}end`, '/plain/root'];
    for (const root of roots)
    {
        const script = `RUN_ROOT="$1"; TD=/x; ${markLine}; printf '%s' "$MARK"`;
        const run = spawnSync('bash', ['-c', script, 'bash', root], { encoding: 'utf8' });
        assert.equal(run.status, 0, run.stderr);
        assert.equal(`/x/${markerName(root)}`, run.stdout, root);
        const hash = spawnSync('bash', ['-c', "printf '%s' \"$1\" | git hash-object --stdin", 'bash', root], { encoding: 'utf8' });
        assert.equal(gitBlobSha1(root), hash.stdout.trim());
    }
});

test('buildTable lists the resolve block spellings and the scripts the bodies run; isResolve judges a command against it', () =>
{
    const table = buildTable(readBodies());
    assert.equal(table.resolves.length, 2);
    assert.ok('scripts/install/alfred-code.js' in table.scripts);
    assert.ok('scripts/install/stamp.js' in table.scripts);
    assert.ok(!('scripts/gate.js' in table.scripts));
    assert.ok(!('scripts/run-tests.js' in table.scripts));
    const bare = withoutComments(normalize(resolveBlock));
    assert.notEqual(bare, normalize(resolveBlock));
    assert.equal(isResolve(resolveBlock, table), true);
    assert.equal(isResolve(bare, table), true);
    assert.equal(isResolve(`${resolveBlock}\n`, table), true);
    assert.equal(isResolve(resolveBlock.replace('\n', '\r'), table), false);
    assert.equal(isResolve(`${resolveBlock}\0`, table), false);
    assert.equal(isResolve(`${resolveBlock}\necho added`, table), false);
    assert.equal(isResolve('', table), false);
    assert.equal(isResolve(resolveBlock, null), false);
});

test('buildTable takes scripts from fenced shell blocks and inline code spans, never from prose', () =>
{
    const block = `\`\`\`bash\n${RESOLVE_LINE}\n\`\`\``;
    const text = [block, 'Prose names "$TMP/repo/scripts/prose.js" in plain words.', 'An inline `node "$TMP/repo/scripts/inline.js" x` span.',
        '```bash', 'node "<run dir>/repo/scripts/fenced.js" <arg>', '```', '```powershell', 'node "$TMP/repo/scripts/other-shell.js"', '```'].join('\n');
    const table = buildTable([{ file: BODY_FILE, text }]);
    assert.deepEqual(Object.keys(table.scripts), ['scripts/fenced.js', 'scripts/inline.js']);
    assert.ok(!('scripts/x.js' in buildTable(readBodies()).scripts), 'the protocol\'s prose example is no allowlisted script');
});

test('buildTable refuses bodies with no resolve block or two', () =>
{
    const block = `\`\`\`bash\n${RESOLVE_LINE}\n\`\`\``;
    assert.throws(() => buildTable([{ file: 'a.md', text: 'none' }]), /exactly one resolve block/);
    assert.throws(() => buildTable([{ file: 'a.md', text: `${block}\n${block.replace('printf', 'echo x; printf')}` }]), /exactly one resolve block/);
});

test('approvesForms passes each of the walk\'s forms', () =>
{
    const forms = [
        `${stamp} state .`,
        `cat "${D}/a.txt" "${D}/b.json"`,
        `grep -E 'x|y' "${D}/install.log"`,
        `grep -F 'x' "${D}/install.log"`,
        `head -8 "${D}/repo/stack/hooks/a.js"`,
        `set -o pipefail; ${stamp} scope . 2>&1 | tee "${D}/install.log"; echo "install exit: $?"`,
        `(cd "./child" && ${stamp} scope .)`,
        `(${stamp} scope .)`,
        `${stamp} x > "${D}/o.txt" 2>&1; cat "${D}/o.txt"`,
        `${stamp} x | grep -qE 'a' && cat "${D}/o.txt"`,
        `${stamp} x --root ./sub/dir --out "${D}/o.json" --root ./sub`,
        `${stamp} x || ${stamp} y .`,
        `rm -rf "${D}" "${MARKER}"`,
        `${stamp} state .\n`,
    ];
    for (const form of forms) assert.equal(approvesForms(form, ctx), true, form);
});

test('approvesForms refuses an injected command, an escape from the roots, a script off the list and a second run dir', () =>
{
    const other = '/t/alfred-code.Zzz999';
    const forms = [
        `node "${D}/repo/scripts/gate.js" x`,
        `node "${D}/repo/scripts/install/stamp.js/../../gate.js" x`,
        `node "${D}/scripts/install/stamp.js" x`,
        `node ./scripts/install/stamp.js x`,
        `${stamp} x; rm -rf ~`,
        `${stamp} x $(id)`,
        `${stamp} x \`id\``,
        `${stamp} x "$(id)"`,
        `${stamp} x "$HOME"`,
        `${stamp} x & id`,
        `${stamp} x < /etc/passwd`,
        `${stamp} x > "${D}/../../etc/x"`,
        `${stamp} x > "${D}/repo/x.js"`,
        `${stamp} x > "${D}/run-session"`,
        `${stamp} x > "/etc/x"`,
        `${stamp} x --root ../other`,
        `${stamp} x --root=../other`,
        `${stamp} x --root /etc`,
        `${stamp} x ~/y`,
        `${stamp} x "${other}/f"`,
        `${stamp} x 'a b' "x: $?"`,
        `cd "../x"`,
        `(cd -P && ${alfred} --root .)`,
        `(cd - && ${alfred} --root .)`,
        `(cd -L && ${alfred} --root .)`,
        `(cd -- && ${alfred} --root .)`,
        `(cd "./child" && ${alfred} --root .) ; (cd - && ${alfred} --root .)`,
        `(cd child && ${stamp} x)`,
        `(cd "child" && ${stamp} x)`,
        `(cd 'child' && ${stamp} x)`,
        `(cd "-P" && ${stamp} x)`,
        `(cd "./../x" && ${stamp} x)`,
        `${stamp} -r/etc`,
        `${stamp} x -o/tmp/x`,
        `${stamp} x -rf`,
        `cd "child" && ${stamp} x`,
        `(cd "../x" && ${stamp} x)`,
        `(cd "/abs" && ${stamp} x)`,
        `(cd "child")`,
        `((${stamp} x))`,
        `cat /etc/passwd`,
        `cat -n "${D}/a"`,
        `cat "${D}"`,
        `cat "${other}/x"`,
        `head -8 /etc/passwd`,
        `head -n 8 "${D}/a"`,
        `grep -E -f '/etc/passwd' "${D}/a"`,
        `grep -E '-x' "${D}/a"`,
        `grep -r 'x' "${D}/a"`,
        `rm -rf "${D}/.."`,
        `rm -rf "${D}"`,
        `rm -rf "${D}" "${MARKER}" /etc`,
        `rm -rf "${other}" "${MARKER}"`,
        `rm -rf "${D}" "/m/other.path"`,
        `rm -f "${D}" "${MARKER}"`,
        `${stamp} x | tee /etc/x`,
        `${stamp} x | sh`,
        `${stamp} x | grep -E 'a'`,
        `${stamp} x > "${D}/o" | tee "${D}/p"`,
        `${stamp} x\nrm -rf /`,
        `${stamp} x\r`,
        `echo "x: $?"`,
        `${stamp} x; echo "x: $?"; ${stamp} y`,
        `${stamp} x; cat "x: $?"`,
        `set -o pipefail; echo "x: $?"`,
        `bash -c 'id'`,
        `ls "${D}"`,
        `FOO=1 ${stamp} x`,
        `${stamp} x;`,
        '',
    ];
    for (const form of forms) assert.equal(approvesForms(form, ctx), false, JSON.stringify(form));
    assert.equal(approvesForms(`rm -rf "${D}" "${MARKER}"`, { ...ctx, markerPath: null }), false);
    assert.equal(approvesForms(`${stamp} x`, { ...ctx, scripts: {} }), false);
    assert.equal(approvesForms(`${stamp} x`, { ...ctx, scripts: ['scripts/install/stamp.js'] }), false);
});

// A child's read of its parent: the folder above, reached by a `..`-only cd, read-only forms only.
const ancestorCtx = ctx;
const readOnly = `--source "${D}/repo" --scope local --installed-only --print-plan --plan-out "${D}/parent.json" > "${D}/parent.out" 2>&1`;
const parentRead = (target) => `(cd "${target}" && ${alfred} update ${readOnly}) && node "${D}/repo/scripts/stack-select.js" --inherited-check "${D}/parent.json" ; echo "parent-read: $?"`;

test('approvesForms passes a child flow\'s read-only parent reads through a `..`-only cd', () =>
{
    const forms = [
        `(cd ".." && ${stamp} scope .)`,
        `(cd "../.." && ${stamp} scope .)`,
        `(cd "../" && ${stamp} scope .)`,
        `(cd "../../" && ${stamp} scope .)`,
        `(cd ".." && ${alfred} update ${readOnly})`,
        `(cd ".." && ${alfred} update --installed-only --print-plan --source "${D}/repo" --plan-out "${D}/parent.json")`,
        parentRead('..'),
        parentRead('../..'),
        `(cd ".." && ${alfred} update ${readOnly}) ; cat "${D}/parent.out"`,
    ];
    for (const form of forms) assert.equal(approvesForms(form, ancestorCtx), true, form);
});

test('approvesForms refuses everything a `..`-only cd must not carry', () =>
{
    const source = `--source "${D}/repo"`;
    const all = `--installed-only --print-plan --plan-out "${D}/parent.json"`;
    const forms = [
        `(cd ".." && ${alfred} update ${source} --installed-only --plan-out "${D}/parent.json")`,
        `(cd ".." && ${alfred} update ${source} --print-plan --plan-out "${D}/parent.json")`,
        `(cd ".." && ${alfred} install ${source} ${all})`,
        `(cd ".." && ${alfred} uninstall ${source} ${all})`,
        `(cd ".." && ${alfred} ${source} ${all})`,
        `(cd ".." && ${alfred} update ${source} --installed-only --print-plan --plan-out "/etc/parent.json")`,
        `(cd ".." && ${alfred} update ${source} --installed-only --print-plan --plan-out "${D}/repo/x.json")`,
        `(cd ".." && ${alfred} update ${source} --installed-only --print-plan --plan-out "${D}/run-session")`,
        `(cd ".." && ${alfred} update ${source} --installed-only --print-plan --plan-out="${D}/parent.json")`,
        `(cd ".." && ${alfred} update ${source} ${all} --plan-out "${D}/repo/y.json")`,
        `(cd ".." && ${alfred} update ${source} --installed-only --print-plan)`,
        `(cd ".." && ${alfred} update ${source} ${all} > "${D}/repo/out.txt" 2>&1)`,
        `(cd ".." && ${alfred} update ${source} ${all} > "out.txt" 2>&1)`,
        `(cd ".." && ${alfred} update --source "/etc" ${all})`,
        `(cd ".." && ${alfred} update --source "${D}/other" ${all})`,
        `(cd ".." && ${alfred} update ${source} ${all} --root ../x)`,
        `(cd ".." && ${alfred} update ${source} ${all} --root /etc)`,
        `(cd ".." && ${alfred} update ${source} ${all} | tee "${D}/o")`,
        `(cd ".." && ${stamp} scope ..)`,
        `(cd ".." && ${stamp} scope /etc)`,
        `(cd ".." && ${stamp} state .)`,
        `(cd ".." && ${stamp} scope . > "${D}/o")`,
        `(cd ".." && node "${D}/repo/scripts/gate.js" scope .)`,
        `(cd ".." && node "${D}/repo/scripts/stack-select.js" --inherited-check "${D}/parent.json")`,
        `(cd ".." && cat "${D}/a")`,
        `(cd ".." && ${stamp} scope . && ${stamp} scope .)`,
        `(cd ".." && ${stamp} scope .) ; (cd "." && ${stamp} scope .)`,
        `(cd "../x" && ${stamp} scope .)`,
        `(cd "../.." && cd "x" && ${stamp} scope .)`,
        `(cd "-" && ${stamp} scope .)`,
        `(cd "../-" && ${stamp} scope .)`,
        `(cd ".../.." && ${stamp} scope .)`,
        `(cd "..\\.." && ${stamp} scope .)`,
        `(cd ".." ; ${stamp} scope .)`,
        `(cd ".." || ${stamp} scope .)`,
        `(cd ".." && ${stamp} scope .) ; rm -rf "${D}"`,
        `cd ".." ; ${stamp} scope .`,
        `cd ".." && ${stamp} scope .`,
        `cd ".." ; rm -rf "${D}" "${MARKER}"`,
        `(cd ".." && rm -rf "${D}" "${MARKER}")`,
        `(cd ".." ; ${stamp} scope .) ; rm -rf /x`,
        `(cd '..' && ${stamp} scope .)`,
        `(cd .. && ${stamp} scope .)`,
        `(cd "../$HOME" && ${stamp} scope .)`,
    ];
    for (const form of forms) assert.equal(approvesForms(form, ancestorCtx), false, JSON.stringify(form));
    assert.equal(approvesForms(`(cd ".." && ${alfred} update ${readOnly})`, { ...ancestorCtx, scripts: {} }), false, 'a script off the list');
});

test('approvesForms pins every installer form\'s --source to this run dir\'s snapshot', () =>
{
    const pinned = `--source "${D}/repo"`;
    const good = [
        `${alfred} update ${pinned} --scope local`,
        `${alfred} install --scope local ${pinned} --selection "${D}/selection.txt"`,
        `(cd "./child" && ${alfred} update ${pinned} --installed-only)`,
        `(cd ".." && ${alfred} update ${pinned} --installed-only --print-plan --plan-out "${D}/parent.json")`,
    ];
    for (const form of good) assert.equal(approvesForms(form, ancestorCtx), true, form);
    const probes = [
        `--source=/p/child ${pinned}`,
        `${pinned} --source=/p/child`,
        `${pinned} --source=${D}/repo`,
        `${pinned} --source "${D}/other"`,
        `--source "${D}/other" ${pinned}`,
        `${pinned} --source "/p/child"`,
        `--source "${D}/other"`,
        `--source=${D}/repo`,
        `${pinned} --scope=local`,
        `${pinned} --root=/p`,
        '--scope local',
    ];
    for (const probe of probes)
    {
        assert.equal(approvesForms(`${alfred} update ${probe}`, ancestorCtx), false, `plain: ${probe}`);
        assert.equal(approvesForms(`(cd "./child" && ${alfred} update ${probe})`, ancestorCtx), false, `child: ${probe}`);
        assert.equal(approvesForms(`(cd ".." && ${alfred} update ${probe} --installed-only --print-plan --plan-out "${D}/parent.json")`, ancestorCtx), false, `ancestor: ${probe}`);
    }
    assert.equal(approvesForms(`${stamp} x --root ./sub`, ancestorCtx), true, 'a flag with a value stays fine on another script');
    assert.equal(approvesForms(`${stamp} x --root=sub`, ancestorCtx), false, 'no --flag=value spelling passes');
});

test('approvesForms reads a `..`-only cd in Windows spellings and keeps the child form as it was', () =>
{
    const win = { runDir: 'C:\\Temp\\alfred-code.AbC123', cwd: 'C:\\p\\child', pluginRoot: 'C:\\plug', scripts: SHAPES, markerPath: 'C:\\Temp\\m.path' };
    assert.equal(approvesForms('(cd ".." && node "C:\\Temp\\alfred-code.AbC123\\repo\\scripts\\install\\stamp.js" scope .)', win), true);
    assert.equal(approvesForms('(cd "../.." && node "/c/Temp/alfred-code.AbC123/repo/scripts/install/stamp.js" scope .)', win), true);
    assert.equal(approvesForms('(cd "./sub" && node "C:\\Temp\\alfred-code.AbC123\\repo\\scripts\\install\\stamp.js" scope .)', win), true);
    assert.equal(approvesForms('(cd "..\\x" && node "C:\\Temp\\alfred-code.AbC123\\repo\\scripts\\install\\stamp.js" scope .)', win), false);
});

test('approvesPluginRead passes a cat of double-quoted .md files under the plugin\'s setup-plugin folder and nothing else', () =>
{
    const root = ctx.pluginRoot;
    const good = [
        `cat "${root}/setup-plugin/references/walk.md"`,
        `cat "${root}/setup-plugin/references/init-install.md" "${root}/setup-plugin/commands/init.md"`,
        `cat "${root}/setup-plugin/a.md"\n`,
    ];
    for (const form of good) assert.equal(approvesPluginRead(form, ctx), true, form);
    const bad = [
        'cat "/etc/passwd"',
        `cat "${root}"`,
        `cat "${root}/.claude/settings.local.json"`,
        `cat "${root}/scripts/x.js"`,
        `cat "${root}/a.md"`,
        `cat "${root}/setup-plugin/references/x.txt"`,
        `cat "${root}/setup-plugin/hooks/protocol-blocks.json"`,
        `cat "${root}/setup-plugin"`,
        `cat "${root}/setup-plugin/../.claude/settings.local.json"`,
        `cat "${root}/setup-plugin/a/../../x.md"`,
        `cat "${root}/../etc/passwd"`,
        `cat "${root}x/setup-plugin/a.md"`,
        `cat "${root}/setup-plugin/a.md" "/etc/passwd"`,
        `cat "${root}/setup-plugin/a.md" > "${root}/setup-plugin/b.md"`,
        `cat "${root}/setup-plugin/a.md" 2>&1`,
        `cat "${root}/setup-plugin/a.md" ; ls`,
        `cat "${root}/setup-plugin/a.md" && cat "${root}/setup-plugin/b.md"`,
        `cat "${root}/setup-plugin/a.md" | sh`,
        `cat ${root}/setup-plugin/a.md`,
        `cat '${root}/setup-plugin/a.md'`,
        `cat -n "${root}/setup-plugin/a.md"`,
        `cat "$HOME/x" "${root}/setup-plugin/a.md"`,
        `cat "${root}/setup-plugin/$(id).md"`,
        `cat "~/a.md"`,
        'cat',
        `head -8 "${root}/setup-plugin/a.md"`,
        `(cat "${root}/setup-plugin/a.md")`,
        `cat "${root}/setup-plugin/a.md"\nls`,
        '',
    ];
    for (const form of bad) assert.equal(approvesPluginRead(form, ctx), false, JSON.stringify(form));
    assert.equal(approvesPluginRead(`cat "${root}/setup-plugin/a.md"`, { ...ctx, pluginRoot: '' }), false);
    assert.equal(approvesPluginRead(`cat "${root}/setup-plugin/a.md"`, undefined), false);
    const win = { ...ctx, pluginRoot: 'C:\\plug' };
    assert.equal(approvesPluginRead('cat "C:\\plug\\setup-plugin\\a.md" "/c/plug/setup-plugin/b.md"', win), true);
    assert.equal(approvesPluginRead('cat "C:\\plug\\a.md"', win), false);
    assert.equal(approvesPluginRead('cat "C:\\other\\setup-plugin\\a.md"', win), false);
});

test('decide allows a plugin-root cat with no run dir named, and only that', () =>
{
    const root = ctx.pluginRoot;
    const none = { ...base, dirs: [], sessionId: '' };
    assert.deepEqual(decide({ ...none, command: `cat "${root}/setup-plugin/references/walk.md"` }), { decision: 'allow' });
    assert.deepEqual(decide({ ...none, command: `cat "${root}/setup-plugin/a.md" "${root}/setup-plugin/b.md"` }), { decision: 'allow' });
    for (const command of ['cat "/etc/passwd"', `cat "${root}/.claude/settings.local.json"`, `cat "${root}/setup-plugin/../x"`, `cat "${root}/setup-plugin/a.md" > "${root}/b"`, `cat "${root}/setup-plugin/a.md" ; ls`, `cat "${root}/setup-plugin/a.md"\0`])
        assert.deepEqual(decide({ ...none, command }), { decision: null }, command);
});

test('approvesForms reads Windows spellings of one run dir and the same dir in MSYS form', () =>
{
    const win = { runDir: 'C:\\Temp\\alfred-code.AbC123', cwd: 'C:\\p', pluginRoot: 'C:\\plug', scripts: SHAPES, markerPath: 'C:\\Temp\\m.path' };
    assert.equal(approvesForms('node "C:\\Temp\\alfred-code.AbC123\\repo\\scripts\\install\\stamp.js" x --root ./sub', win), true);
    assert.equal(approvesForms('node "/c/Temp/alfred-code.AbC123/repo/scripts/install/stamp.js" x', win), true);
    assert.equal(approvesForms('node "/c/Temp/alfred-code.AbC123/repo/scripts/gate.js" x', win), false);
    assert.equal(approvesForms('node "C:\\Temp\\alfred-code.AbC123\\repo\\scripts\\install\\stamp.js" x "/tmp/x"', win), false);
    assert.equal(approvesForms('cat "C:\\Temp\\alfred-code.AbC123\\..\\x"', win), false);
    const stampWin = 'node "C:\\Temp\\alfred-code.AbC123\\repo\\scripts\\install\\stamp.js" x';
    assert.equal(approvesForms(`${stampWin} > "C:\\Temp\\alfred-code.AbC123\\o.txt"`, win), true);
    assert.equal(approvesForms(`${stampWin} > "C:\\TEMP\\ALFRED-CODE.ABC123\\REPO\\x"`, win), false);
    assert.equal(approvesForms(`${stampWin} > "/c/Temp/alfred-code.AbC123/Run-Session"`, win), false);
});

const table = { resolves: [], scripts: [] };
const resolveTable = buildTable([{ file: 'a.md', text: `\`\`\`bash\n${RESOLVE_LINE}\n\`\`\`` }]);
const resolveTable2 = buildTable([{ file: 'a.md', text: `\`\`\`bash\n${resolveBlock}\n\`\`\`` }]);
const form = `${stamp} state .`;
const base = { command: form, table, sessionId: 's1', dirs: [own], marker: null, ctx };

test('decide allows the resolve block and this session\'s forms and stays silent otherwise', () =>
{
    assert.deepEqual(decide({ ...base, dirs: [], command: 'ls' }), { decision: null });
    assert.deepEqual(decide({ ...base, table: resolveTable, dirs: [], command: RESOLVE_LINE }), { decision: 'allow' });
    assert.deepEqual(decide(base), { decision: 'allow' });
    assert.deepEqual(decide({ ...base, command: `rm -rf "${D}" "${MARKER}"` }), { decision: 'allow' });
    assert.deepEqual(decide({ ...base, command: `${form}; rm -rf ~` }), { decision: null });
    assert.deepEqual(decide({ ...base, command: `${form}\0` }), { decision: null });
    const crlf = resolveBlock.replace(/\n/g, '\r\n');
    assert.equal(isResolve(crlf, resolveTable2), false);
    assert.deepEqual(decide({ ...base, table: resolveTable2, dirs: [], command: crlf }), { decision: null });
    assert.deepEqual(decide({ ...base, table: resolveTable2, dirs: [], command: resolveBlock }), { decision: 'allow' });
    assert.deepEqual(decide({ ...base, dirs: [{ ...own, owned: false }] }), { decision: null });
    assert.deepEqual(decide({ ...base, sessionId: '' }), { decision: null });
});

test('decide denies a dir of another session only on a trusted marker', () =>
{
    const marker = { path: MARKER, dir: D, session: 's1', owned: true };
    const wrong = { ...base, command: `cat "${foreign.raw}/a"`, dirs: [foreign], marker };
    const verdict = decide(wrong);
    assert.equal(verdict.decision, 'deny');
    assert.ok(verdict.reason.includes(D));
    assert.ok(verdict.reason.includes('ALFRED_CODE_HOOKS_OFF=run-dir-gate'));
    assert.equal(verdict.reason, REASON.wrongDir(D));
    assert.ok(verdict.reason.includes(OFF_SWITCH));
    assert.deepEqual(decide({ ...wrong, marker: null }), { decision: null });
    assert.deepEqual(decide({ ...wrong, marker: { ...marker, session: 's2', owned: true } }), { decision: null });
    assert.deepEqual(decide({ ...wrong, marker: { ...marker, session: '' } }), { decision: null });
    assert.deepEqual(decide({ ...wrong, dirs: [{ ...foreign, session: '' }] }), { decision: null });
    assert.deepEqual(decide({ ...wrong, dirs: [{ ...foreign, path: null }] }), { decision: null });
    assert.deepEqual(decide({ ...wrong, dirs: [foreign, { ...own, path: null }] }), { decision: null });
});

test('decide never denies on a marker this user does not own', () =>
{
    const marker = { path: MARKER, dir: D, session: 's1', owned: false };
    const wrong = { ...base, command: `cat "${foreign.raw}/a"`, dirs: [foreign], marker };
    assert.deepEqual(decide(wrong), { decision: null });
    assert.deepEqual(decide({ ...wrong, marker: { ...marker, owned: undefined } }), { decision: null });
    assert.equal(decide({ ...wrong, marker: { ...marker, owned: true } }).decision, 'deny');
});

test('hookOutput builds a fresh answer for each verdict and never touches the shared ones', () =>
{
    const allow = hookOutput(decide(base));
    assert.deepEqual([allow.hookSpecificOutput.hookEventName, allow.hookSpecificOutput.permissionDecision], ['PreToolUse', 'allow']);
    allow.hookSpecificOutput.permissionDecision = 'changed';
    assert.equal(hookOutput(decide(base)).hookSpecificOutput.permissionDecision, 'allow');
    assert.equal(hookOutput({ decision: null }), null);
    assert.equal(hookOutput(undefined), null);
    const deny = hookOutput({ decision: 'deny', reason: 'r' });
    assert.deepEqual([deny.hookSpecificOutput.permissionDecision, deny.hookSpecificOutput.permissionDecisionReason], ['deny', 'r']);
});

test('decide denies this session\'s older dir while the marker names a newer one, and allows the marker\'s dir', () =>
{
    const newer = '/t/alfred-code.Newer1';
    const marker = { path: MARKER, dir: newer, session: 's1', owned: true };
    assert.equal(decide({ ...base, marker }).decision, 'deny');
    assert.equal(decide({ ...base, marker: { ...marker, dir: `${D}/` } }).decision, 'allow');
});

test('decide never denies two sessions of one project and allows this one\'s forms', () =>
{
    const marker = { path: MARKER, dir: foreign.raw, session: 's2', owned: true };
    assert.deepEqual(decide({ ...base, marker }), { decision: 'allow' });
    assert.deepEqual(decide({ ...base, marker, command: `cat "${foreign.raw}/a"`, dirs: [foreign] }), { decision: null });
});

test('the logic files touch no file system, process, environment or clock', () =>
{
    const banned = /require\(['"]node:(fs|child_process|os)['"]\)|process\.(env|platform|cwd)|Date\.now|new Date/;
    for (const name of ['constants', 'dirs', 'marker', 'paths', 'shell', 'forms', 'table', 'verdict', 'call-words', 'calls', 'templates', 'values', 'state', 'args'])
        assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'run-dir-gate', `${name}.js`), 'utf8'), banned, name);
});
