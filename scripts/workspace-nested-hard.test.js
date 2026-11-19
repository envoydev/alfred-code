'use strict';
// REMOVE-NESTED, THE GUARD'S SECOND ROUND (2026-11-19 re-review) - a hard link realpaths to itself, so a settings file, a
// `.mcp.json` or an ignore file hard-linked to the root's was rewritten in place; a link swapped in AFTER the checks was
// opened by the settings pass; and a run that skipped a path still removed the stamp. Also pins the docs-root read order.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { POSIX_ONLY } = require('./seed-sandbox.js');
const { SOURCE, EXIT_REFUSED, treeHash, sandboxEnv, withNested } = require('./nested-sandbox.js');
const { hashItem } = require('./install/library.js');
const { entryHash } = require('./install/stamp.js');
const { MARK, END } = require('./install/tool-ignores.js');

const REPO = path.join(__dirname, '..');
const stampOf = (pkg) => path.join(pkg, '.claude', 'alfred-code.stamp');
const addStamp = (pkg, line, drop) =>
{
    const kept = fs.readFileSync(stampOf(pkg), 'utf8').split('\n').filter((l) => l && !drop.test(l));
    fs.writeFileSync(stampOf(pkg), [...kept, line, ''].join('\n'));
};
const hardLink = (from, to) => { fs.rmSync(to, { force: true }); fs.linkSync(from, to); };
const outsideOf = (repo) => (at) => at === path.join(repo, 'pkg') || at === path.join(repo, '.git');

// Each shape makes one of the folder's files share its data with the root's.
const HARD = {
    '.claude/settings.local.json': (repo, pkg) =>
    {
        const [rootFile, pkgFile] = ['repo', 'pkg'].map((b) => path.join(b === 'repo' ? repo : pkg, '.claude', 'settings.local.json'));
        const merged = { ...JSON.parse(fs.readFileSync(rootFile, 'utf8')), ...JSON.parse(fs.readFileSync(pkgFile, 'utf8')), myOwn: 1 };
        fs.writeFileSync(pkgFile, JSON.stringify(merged, null, 2));
        hardLink(pkgFile, rootFile);
    },
    '.mcp.json': (repo, pkg) =>
    {
        const ours = { command: 'x' };
        fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { srv: ours, rootOwn: { command: 'y' } } }));
        hardLink(path.join(repo, '.mcp.json'), path.join(pkg, '.mcp.json'));
        addStamp(pkg, `managed-mcp: srv=${entryHash(ours)}`, /^managed-mcp:/);
    },
    '.prettierignore': (repo, pkg) =>
    {
        fs.writeFileSync(path.join(repo, '.prettierignore'), `rootOwn\n${MARK}\n/.alfred/\n/.claude/\n${END}\n`);
        hardLink(path.join(repo, '.prettierignore'), path.join(pkg, '.prettierignore'));
        addStamp(pkg, 'tool-ignores: .prettierignore=appended', /^tool-ignores:/);
    },
};
for (const [shape, mutate] of Object.entries(HARD))
    test(`remove-nested refuses a hard-linked ${shape}: exit 2, one !! line naming it, no root file changes`, POSIX_ONLY, () =>
    {
        const got = withNested((repo, run) =>
        {
            const pkg = path.join(repo, 'pkg');
            mutate(repo, pkg);
            const before = JSON.stringify(treeHash(repo, repo, outsideOf(repo)));
            const ran = run(['remove-nested', '--root', '.', '--path', 'pkg']);
            return { ran, same: JSON.stringify(treeHash(repo, repo, outsideOf(repo))) === before, stamp: fs.existsSync(stampOf(pkg)) };
        });
        const bang = got.ran.out.split('\n').filter((l) => l.startsWith('!!'));
        assert.strictEqual(got.ran.code, EXIT_REFUSED);
        assert.strictEqual(bang.length, 1);
        assert.ok(bang[0].includes(`pkg/${shape} shares its data with another file (a hard link) - nothing is removed through it`), 'the line names the path and the cause');
        assert.ok(got.same, 'no file outside the folder changed');
        assert.ok(got.stamp, 'the stamp stays');
    });

// A link put in place AFTER `check` passed (the race the second layer is for): `removeNested` runs in a child process whose
// working folder is the sandbox, as the verb does.
const RACE_SCRIPT = `
const [repo, shape] = process.argv.slice(1);
const fs = require('node:fs'); const path = require('node:path');
const nested = require(${JSON.stringify(path.join(REPO, 'scripts', 'install', 'nested.js'))});
const checked = nested.check({ root: repo, rel: 'pkg' });
if (checked.why) { console.log(JSON.stringify({ why: checked.why })); process.exit(0); }
const pkg = path.join(repo, 'pkg');
const swap = (sub, to) => { const at = path.join(pkg, sub); fs.rmSync(at, { recursive: true, force: true }); fs.symlinkSync(to, at); };
if (shape === 'skills') swap('.claude/skills', '../../.claude/skills');
if (shape === 'alfred') swap('.alfred', '../.alfred');
if (shape === 'rules') swap('.claude/rules', '../../.claude/rules');
if (shape === 'hooks') swap('.claude/hooks', '../../.claude/hooks');
if (shape === 'settings') swap('.claude/settings.local.json', '../../.claude/settings.local.json');
const lines = [];
const code = nested.removeNested({ ...checked, sourceDir: ${JSON.stringify(SOURCE)}, shippedDeny: require(${JSON.stringify(path.join(REPO, 'scripts', 'install', 'alfred-code.js'))}).SHIPPED_DENY, out: (l) => lines.push(l) });
console.log(JSON.stringify({ code, lines }));
`;
function race(shape, prepare = () => {})
{
    return withNested((repo, run, work) =>
    {
        const pkg = path.join(repo, 'pkg');
        prepare(repo, pkg);
        const before = JSON.stringify(treeHash(repo, repo, outsideOf(repo)));
        const got = spawnSync(process.execPath, ['-e', RACE_SCRIPT, repo, shape], { cwd: repo, env: sandboxEnv(work), encoding: 'utf8' });
        return { ...JSON.parse(got.stdout.trim().split('\n').pop()), same: JSON.stringify(treeHash(repo, repo, outsideOf(repo))) === before, stamp: fs.existsSync(stampOf(pkg)) };
    });
}
const settingsRace = (repo, pkg) =>
{
    const ours = { command: 'x' };
    fs.writeFileSync(path.join(pkg, '.mcp.json'), JSON.stringify({ mcpServers: { srv: ours, mine: { command: 'y' } } }));
    addStamp(pkg, `managed-mcp: srv=${entryHash(ours)}`, /^managed-mcp:/);
    const rootFile = path.join(repo, '.claude', 'settings.local.json');
    fs.writeFileSync(rootFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(rootFile, 'utf8')), enabledMcpjsonServers: ['srv', 'rootOwn'] }, null, 2));
};
// The root holds a generated awareness rule that reads as the folder's own unedited one: through a linked rules folder it would be taken.
const rulesRace = (repo, pkg) =>
{
    fs.mkdirSync(path.join(pkg, '.alfred', 'docs', 'awareness'), { recursive: true });
    fs.writeFileSync(path.join(pkg, '.alfred', 'docs', 'awareness', 'AGENTS-AWARENESS.md'), '# x\nbody\n');
    const { composeAwarenessRule } = require(path.join(SOURCE, 'stack', 'skills', 'capture-awareness', 'scripts', 'awareness-state.js'));
    fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'rules', 'alfred-awareness.md'), composeAwarenessRule({ projectRoot: pkg, docs: '.alfred/docs' }).text);
};
// The root's hooks folder holds only the CommonJS marker: through a linked hooks folder it would read as empty of the user's files and go.
const hooksRace = (repo) =>
{
    fs.mkdirSync(path.join(repo, '.claude', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'hooks', 'package.json'), '{"type":"commonjs"}\n');
};
for (const [shape, prepare] of [['skills'], ['alfred'], ['settings', settingsRace], ['rules', rulesRace], ['hooks', hooksRace]])
    test(`a ${shape} link swapped in after the checks: nothing outside the folder changes, the stamp stays, the run ends not done with exit 1`, POSIX_ONLY, () =>
    {
        const got = race(shape, prepare);
        assert.strictEqual(got.code, 1);
        assert.ok(got.same, 'no file outside the folder changed');
        assert.ok(got.stamp, 'the stamp stays so a re-run finds the skipped paths');
        assert.match(got.lines[got.lines.length - 1], /^remove-nested: not done pkg - \d+ path\(s\) outside this folder were left; the stamp stays so a re-run finds them$/);
        assert.ok(!got.lines.some((l) => /^remove-nested: done pkg$/.test(l)), 'no done line');
    });

test('the generated awareness rule of a custom docs root goes: the docs root is read before the rule that names it is removed', POSIX_ONLY, () =>
{
    const got = withNested((repo, run) =>
    {
        const pkg = path.join(repo, 'pkg');
        const rules = ['.alfred/stack/rules', '.claude/rules'].map((d) => path.join(pkg, d, 'alfred-docs-root.md')).find((f) => fs.existsSync(f));
        const text = fs.readFileSync(rules, 'utf8');
        fs.writeFileSync(rules, text.replace(/This install's root: `[^`]*`/g, 'This install\'s root: `docs/custom`'));
        const stamp = fs.readFileSync(stampOf(pkg), 'utf8').replace(/(alfred-docs-root=)[0-9a-f]{64}/, `$1${hashItem(rules)}`);
        fs.writeFileSync(stampOf(pkg), stamp);
        for (const docs of ['docs/custom', '.alfred/docs'])
        {
            fs.mkdirSync(path.join(pkg, docs, 'awareness'), { recursive: true });
            fs.writeFileSync(path.join(pkg, docs, 'awareness', 'AGENTS-AWARENESS.md'), '# x\nbody\n');
        }
        const { composeAwarenessRule } = require(path.join(SOURCE, 'stack', 'skills', 'capture-awareness', 'scripts', 'awareness-state.js'));
        const generated = path.join(pkg, '.claude', 'rules', 'alfred-awareness.md');
        fs.mkdirSync(path.dirname(generated), { recursive: true });
        fs.writeFileSync(generated, composeAwarenessRule({ projectRoot: pkg, docs: 'docs/custom' }).text);
        const ran = run(['remove-nested', '--root', '.', '--path', 'pkg']);
        return { ran, generatedGone: !fs.existsSync(generated), docsRuleGone: !fs.existsSync(rules) };
    });
    assert.strictEqual(got.ran.code, 0);
    assert.ok(got.docsRuleGone, 'the docs-root rule (an unedited stack copy) is removed');
    assert.ok(got.generatedGone, 'the unedited generated awareness rule goes, as the custom root it was written with');
});
