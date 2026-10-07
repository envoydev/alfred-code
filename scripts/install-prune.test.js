'use strict';
// THE SEED'S PRUNES - what a run takes OFF a project, end to end against a recording CLI.
//
// Measured on the 1.0.0 release check, an update over a real 0.2.87 install: the copied hooks were
// unwired but all 13 files stayed; all 43 copied agents stayed, and a project agent outranks the
// plugin's own, so the 0.2.87 seats kept running; and none of the upstream-retired names the twin
// prunes (skills, agents, rules, hooks, the ponytail plugin) was touched, because the seed never read
// those lists. The twin did all three; these cases hold the seed to it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { hashItem } = require('./install/library.js');

const SELECTION = 'skill markdown-style\nrule markdown-docs\n';
const COPY_ROUTE = { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };

function write(repo, rel, text = 'x\n')
{
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
}

// A 0.2.x copy-route project: the stack's shipped copies, upstream-retired leftovers, and the user's
// own files beside them, with the hooks wired the way 0.2.87 wrote them.
function oldLayout(repo, { recorded = false } = {})
{
    for (const rel of [
        '.claude/agents/aspnet-implementer.md', '.claude/agents/code-analyzer.md', '.claude/agents/my-own-seat.md',
        '.claude/hooks/guard-secret-value.js', '.claude/hooks/require-convention-skill.js', '.claude/hooks/my-own-hook.js',
        '.claude/skills/frontend/SKILL.md', '.claude/skills/my-own-skill/SKILL.md',
        '.claude/rules/house-baseline.md', '.claude/rules/my-own-rule.md',
    ]) write(repo, rel);
    const wire = (file) => ({ type: 'command', command: `"$CLAUDE_PROJECT_DIR/.claude/hooks/${file}"` });
    write(repo, '.claude/settings.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Read',
        hooks: [wire('guard-secret-value.js'), wire('require-convention-skill.js'), wire('my-own-hook.js')] }] } }, null, 2));
    // What a stamped install records for the retired copies: the stack's own record is what lets a run prune them (audit F2/F3).
    if (recorded)
    {
        const at = (rel) => hashItem(path.join(repo, rel));
        write(repo, '.claude/alfred-code.stamp', [
            'version: 2.1.5', 'sha: 0000000', 'hooks-route: copy',
            `library-skills: frontend=${at('.claude/skills/frontend')}`, `library-agents: code-analyzer=${at('.claude/agents/code-analyzer.md')}`,
            `library-rules: house-baseline=${at('.claude/rules/house-baseline.md')}`,
            `managed-files: hooks/require-convention-skill.js=${at('.claude/hooks/require-convention-skill.js')}`, '',
        ].join('\n'));
    }
}

// A SNAPSHOT, taken before the sandbox is removed: every path under .claude, and the hook wiring.
function after(repo)
{
    const files = new Set();
    const walk = (dir) =>
    {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        {
            const rel = path.relative(repo, path.join(dir, e.name)).split(path.sep).join('/');
            files.add(rel);
            if (e.isDirectory()) walk(path.join(dir, e.name));
        }
    };
    walk(path.join(repo, '.claude'));
    const wired = JSON.stringify(JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')).hooks || {});
    return { has: (rel) => files.has(rel), wired, hooks: [...files].filter((f) => /^\.claude\/hooks\/[^/]+$/.test(f)).map((f) => f.slice(14)).sort() };
}

for (const action of ['update', 'install'])
{
    test(`seed ${action} on the plugin route: a copy a plugin now carries is pruned, the user's own files are not`, POSIX_ONLY, () =>
    {
        const { result: r } = seedRun(action, SELECTION, { prepare: oldLayout, inspect: after });
        assert.ok(!r.has('.claude/agents/aspnet-implementer.md'), 'a plugin-carried agent copy survived - it shadows the plugin seat');
        assert.ok(!r.has('.claude/hooks/guard-secret-value.js'), 'a plugin-carried hook copy survived');
        assert.ok(!r.wired.includes('guard-secret-value.js'), 'the pruned hook is still wired');
        assert.ok(r.has('.claude/agents/my-own-seat.md') && r.has('.claude/hooks/my-own-hook.js'), "the user's own seat or hook was pruned");
        assert.ok(r.wired.includes('my-own-hook.js'), "the user's own hook was unwired");
        assert.ok(r.has('.claude/skills/my-own-skill/SKILL.md') && r.has('.claude/rules/my-own-rule.md'), "the user's own skill or rule was pruned");
        assert.ok(r.hooks.includes('docs.js') && r.hooks.includes('memory.js'), `the engines must stay: ${r.hooks.join(' ')}`);
    });

    test(`seed ${action}: a retired name the stack's record holds is pruned and unwired, on either route`, POSIX_ONLY, () =>
    {
        for (const env of [{}, COPY_ROUTE])
        {
            const { result: r } = seedRun(action, SELECTION, { env, prepare: (repo) => oldLayout(repo, { recorded: true }), inspect: after });
            const route = Object.keys(env).length ? 'copy route' : 'plugin route';
            assert.ok(!r.has('.claude/skills/frontend'), `${route}: a retired skill survived`);
            assert.ok(!r.has('.claude/agents/code-analyzer.md'), `${route}: a retired agent survived`);
            assert.ok(!r.has('.claude/rules/house-baseline.md'), `${route}: a retired rule survived - an always-on one costs every session`);
            assert.ok(!r.has('.claude/hooks/require-convention-skill.js'), `${route}: a retired hook file survived`);
            assert.ok(!r.wired.includes('require-convention-skill.js'), `${route}: a retired hook is still wired`);
        }
    });

    test(`seed ${action}: a retired name nothing records may be the project's own - kept and named, its wiring still retired`, POSIX_ONLY, () =>
    {
        for (const env of [{}, COPY_ROUTE])
        {
            const { result: r, out } = seedRun(action, SELECTION, { env, prepare: oldLayout, inspect: after });
            const route = Object.keys(env).length ? 'copy route' : 'plugin route';
            for (const rel of ['.claude/skills/frontend', '.claude/agents/code-analyzer.md', '.claude/rules/house-baseline.md', '.claude/hooks/require-convention-skill.js'])
                assert.ok(r.has(rel), `${route}: ${rel} was deleted with nothing to say it is the stack's`);
            for (const line of [/!! skill kept: frontend/, /!! rule kept: house-baseline\.md/, /!! hook kept: require-convention-skill\.js/]) assert.match(out, line, `${route}: ${out}`);
            assert.ok(!r.wired.includes('require-convention-skill.js'), `${route}: a retired hook is still wired`);
        }
    });
}

test('seed update on the copy route: a shipped copy is the delivery, so it is never pruned', POSIX_ONLY, () =>
{
    const { result: r } = seedRun('update', SELECTION, { env: COPY_ROUTE, prepare: oldLayout, inspect: after });
    assert.ok(r.has('.claude/agents/aspnet-implementer.md'), 'the copy route pruned a shipped agent');
    assert.ok(r.has('.claude/hooks/guard-secret-value.js'), 'the copy route pruned a shipped hook');
});

// By its full spec, and only at the run's own scope: a user-scope row serves every project on the
// machine, so a project run keeps it and names the command that removes it.
test('seed update: a retired plugin is uninstalled by its full spec at the run\'s scope; one at another scope is kept and named', POSIX_ONLY, () =>
{
    const here = JSON.stringify([{ id: 'ponytail@ponytail', version: '4.9.0', scope: 'project', enabled: true }]);
    const { calls } = seedRun('update', SELECTION, { plugins: here });
    assert.ok(calls.includes('plugin uninstall ponytail@ponytail --scope project -y'), calls.filter((c) => /uninstall|ponytail/.test(c)).join('\n') || 'no uninstall call');
    const elsewhere = JSON.stringify([{ id: 'ponytail@ponytail', version: '4.9.0', scope: 'user', enabled: true }]);
    const other = seedRun('update', SELECTION, { plugins: elsewhere });
    assert.ok(!other.calls.some((c) => /plugin uninstall ponytail/.test(c)), other.calls.filter((c) => /uninstall/.test(c)).join('\n'));
    assert.match(other.out, /ponytail@ponytail is installed at user scope, not this run's - kept .*claude plugin uninstall ponytail@ponytail --scope user/);
});

// One update whose plugin listing could not be read (the CLI failed, or is missing) cannot tell what
// is installed - so it must not forget the picks the last stamp recorded: they are written back verbatim.
test('seed update: a blind listing read keeps the stamp picks it cannot see', POSIX_ONLY, () =>
{
    const prepare = (repo) =>
    {
        fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.claude', 'rules', 'alfred-interaction.md'), 'x\n');
        fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'),
            'version: 2.1.0\nsha: 0000000\npicked-skills: angular-conventions,angular-testing\npicked-agents: \n');
    };
    const { result: picks } = seedRun('update', SELECTION, {
        plugins: 'not json', args: ['--installed-only'], prepare,
        inspect: (repo) => ((/^picked-skills: (.*)$/m.exec(fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8')) || [])[1] || '').split(','),
    });
    for (const name of ['angular-conventions', 'angular-testing']) assert.ok(picks.includes(name), `the blind run forgot ${name}: ${picks.join(',')}`);
});
