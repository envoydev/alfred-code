'use strict';
// The run-dir gate's word values: a drive-relative word, the variables.js pair, and the path-valued flags that take no word.
const test = require('node:test');
const assert = require('node:assert/strict');
const { approvesForms } = require('./run-dir-gate/forms.js');
const { D, SHIPPED, shippedCtx, WIN_RUN, winShipped, atWin } = require('./run-dir-gate-fixture.js');

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
        `${atWin('scripts/install/alfred-code.js')} install --source "${WIN_RUN}\\repo" --scope local --scope-of lsp=global`,
        `${atWin('scripts/workspace.js')} ignore --root . --add 'skills name'`,
    ];
    for (const form of good) assert.equal(approvesForms(form, winShipped), true, form);
});

test('the real variables.js set call passes: the body writes the pair as placeholders, so the table holds a word', () =>
{
    const set = (at) => `${at('scripts/variables.js')} set --root . --scope project ALFRED_CODE_AUTO_COMPACT=1`;
    assert.equal(approvesForms(set((script) => `node "${D}/repo/${script}"`), shippedCtx), true);
    assert.equal(approvesForms(set(atWin), winShipped), true);
    assert.deepEqual(SHIPPED.scripts['scripts/variables.js'].set.positionals, [[{ kind: 'word' }]]);
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

