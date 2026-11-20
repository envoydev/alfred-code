'use strict';
// The run-dir gate's word values: a drive-relative word, the variables.js pair, and the path-valued flags that take no word.
const test = require('node:test');
const assert = require('node:assert/strict');
const { approvesForms } = require('./run-dir-gate/forms.js');
const { D, SHIPPED, shippedCtx, WIN_RUN, winShipped, atWin, tableOf, ctx } = require('./run-dir-gate-fixture.js');

test('a `word` or a word of a `phrase` that starts with a drive letter and a colon refuses on every OS - on Windows `C:..` is the cwd\'s parent', () =>
{
    const forms = (at, run) => [
        `${at('scripts/workspace.js')} join --root C:.. --answer join`,
        `${at('scripts/workspace.js')} role --root C:.. --when update --answer child`,
        `${at('scripts/stamp-docs-root.js')} C:.. --seed-versioning`,
        `${at('scripts/update-preflight.js')} --offers --root C:..`,
        `${at('scripts/workspace.js')} remove-nested --root . --path C:..`,
        `${at('scripts/plugin-settings.js')} --catalog "${run}/repo/meta/plugin-settings.json" --config-dir x --installed C:.claude --apply`,
        `${at('stack/hooks/guard-secret-value.js')} --redacted C:..`,
        `${at('scripts/stack-select.js')} --selection "${run}/raw.json" --dependents C:evil`,
        `${at('scripts/workspace.js')} ignore --root . --add 'C:evil name'`,
        `${at('scripts/workspace.js')} ignore --root . --add 'name D:x'`,
        `${at('scripts/workspace.js')} join --root d: --answer join`,
        `${at('scripts/variables.js')} set --root . --scope C:x KEY=value`,
    ];
    for (const form of forms(atWin, 'C:/Temp/alfred-code.AbC123')) assert.equal(approvesForms(form, winShipped), false, JSON.stringify(form));
    for (const form of forms((script) => `node "${D}/repo/${script}"`, D)) assert.equal(approvesForms(form, shippedCtx), false, JSON.stringify(form));
    const good = [
        `${atWin('scripts/stack-select.js')} --selection "${WIN_RUN}\\raw.json" --dependents skill:name`,
        `${atWin('scripts/install/alfred-code.js')} install --source "${WIN_RUN}\\repo" --scope local --selection "${WIN_RUN}\\selection.txt" --scope-of lsp=global`,
        `${atWin('scripts/workspace.js')} ignore --root . --add 'skills name'`,
    ];
    for (const form of good) assert.equal(approvesForms(form, winShipped), true, form);
});

test('the real variables.js set call passes: the body writes the pair as placeholders, so the table holds a word', () =>
{
    const set = (at) => `${at('scripts/variables.js')} set --root . --scope project ALFRED_CODE_AUTO_COMPACT=1`;
    assert.equal(approvesForms(set((script) => `node "${D}/repo/${script}"`), shippedCtx), true);
    assert.equal(approvesForms(set(atWin), winShipped), true);
    assert.deepEqual(SHIPPED.scripts['scripts/variables.js'].set.positionals, [[{ kind: 'word', repeat: true }]]);
    assert.equal(approvesForms(`${set((script) => `node "${D}/repo/${script}"`)} /etc/x`, shippedCtx), false);
    assert.equal(approvesForms(`node "${D}/repo/scripts/variables.js" set --root . --scope project A=b/c`, shippedCtx), false);
});

test('a path-valued flag the walk fills from a placeholder gets no word template, so a call with one prompts', () =>
{
    const settings = `node "${D}/repo/scripts/plugin-settings.js"`;
    const catalog = `--catalog "${D}/repo/meta/plugin-settings.json"`;
    const forms = [
        `${settings} ${catalog} --config-dir .claude --installed x --apply`,
        `${settings} ${catalog} --config-dir x --installed x --apply`,
        `${settings} ${catalog} --config-dir ./x --apply`,
        `node "${D}/repo/scripts/stack-select.js" --missing --recs evil.json --stacks x`,
        `node "${D}/repo/scripts/stack-select.js" --missing --recs ./recs.json --stacks x`,
    ];
    for (const form of forms) assert.equal(approvesForms(form, shippedCtx), false, form);
    assert.equal(approvesForms(`node "${D}/repo/scripts/stack-select.js" --missing --recs "${D}/repo/meta/recommendations.json" --stacks x`, shippedCtx), true);
    assert.deepEqual(SHIPPED.scripts['scripts/plugin-settings.js'][''].flags['--config-dir'], [{ kind: 'accountDir' }]);
    assert.ok(SHIPPED.scripts['scripts/stack-select.js'][''].flags['--recs'].every((template) => template.kind === 'runDir'));
});


test('a body call that writes a repeat mark after a placeholder takes one word or more, each a plain word', () =>
{
    const set = (...pairs) => `node "${D}/repo/scripts/variables.js" set --root . --scope project ${pairs.join(' ')}`;
    for (const pairs of [['A=1'], ['A=1', 'B=2'], ['A=1', 'B=2', 'C_D=x.y']]) assert.equal(approvesForms(set(...pairs), shippedCtx), true, pairs.join(' '));
    for (const pairs of [[], ['A=1', '/etc/x'], ['A=1', '$(id)'], ['A=1', 'C:x'], ['A=1', '-x'], ['A=1', '"a b"']]) assert.equal(approvesForms(set(...pairs), shippedCtx), false, pairs.join(' '));
    assert.deepEqual(SHIPPED.scripts['scripts/variables.js'].set.positionals, [[{ kind: 'word', repeat: true }]]);
    const own = tableOf(['node "$TMP/repo/scripts/r.js" go <first> <rest> ...', 'node "$TMP/repo/scripts/r.js" go <first> <rest> <more> ...']);
    assert.deepEqual(own.scripts['scripts/r.js'].go.positionals, [[{ kind: 'word' }, { kind: 'word', repeat: true }], [{ kind: 'word' }, { kind: 'word' }, { kind: 'word', repeat: true }]]);
    const call = (...words) => `node "${D}/repo/scripts/r.js" go ${words.join(' ')}`;
    const shaped = { ...ctx, scripts: own.scripts };
    for (const words of [['a', 'b'], ['a', 'b', 'c', 'd'], ['a', 'b', 'c']]) assert.equal(approvesForms(call(...words), shaped), true, words.join(' '));
    for (const words of [['a'], []]) assert.equal(approvesForms(call(...words), shaped), false, words.join(' '));
});

test('a flag every body call of a script and mode writes is required, and an optional [--flag] or a flag only some calls write is not', () =>
{
    const table = tableOf([
        'node "$TMP/repo/scripts/q.js" --need <v> [--maybe <w>] --some',
        'node "$TMP/repo/scripts/q.js" --need <v> [--maybe <w>]',
        'node "$TMP/repo/scripts/q.js" --need <v> --alone',
    ]);
    assert.deepEqual(table.scripts['scripts/q.js'][''].required, ['--need']);
    const shaped = { ...ctx, scripts: table.scripts };
    const q = (tail) => `node "${D}/repo/scripts/q.js" ${tail}`;
    assert.equal(approvesForms(q('--need a'), shaped), true);
    assert.equal(approvesForms(q('--need a --maybe b --some'), shaped), true);
    assert.equal(approvesForms(q('--some'), shaped), false);
    assert.equal(approvesForms(q('--maybe b'), shaped), false);
    const settings = (tail) => `node "${D}/repo/scripts/plugin-settings.js" --catalog "${D}/repo/meta/plugin-settings.json" ${tail}`;
    assert.deepEqual(SHIPPED.scripts['scripts/plugin-settings.js'][''].required, ['--catalog', '--config-dir', '--installed']);
    assert.equal(approvesForms(settings('--installed a --apply'), { ...shippedCtx, accountDir: '/home/u/.claude', accountDirReal: '/home/u/.claude' }), false, 'no --config-dir: the script would write os.homedir()/.claude');
    assert.equal(approvesForms(settings('--config-dir "/home/u/.claude" --installed a --apply'), { ...shippedCtx, accountDir: '/home/u/.claude', accountDirReal: '/home/u/.claude' }), true);
});

test('the child\'s stacks, a csv, pass as one word or a spaced phrase, and a drive-like or dashed csv does not', () =>
{
    const select = (stacks) => `node "${D}/repo/scripts/stack-select.js" --redundant --installed "${D}/parent.json" --found "${D}/found-2.json" --recs "${D}/repo/meta/recommendations.json" --graph "${D}/repo/meta/stack-graph.json" --stacks ${stacks}`;
    for (const stacks of ['"web,node"', '"web, node"', '"typescript,web-angular,aspnet"', 'web,node']) assert.equal(approvesForms(select(stacks), shippedCtx), true, stacks);
    for (const stacks of ['"C:web,node"', '"-x,node"', '"web;node"', '"web,$(id)"']) assert.equal(approvesForms(select(stacks), shippedCtx), false, stacks);
});
