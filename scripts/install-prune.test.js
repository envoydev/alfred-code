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

const SELECTION = 'skill markdown-style\nrule markdown-docs\n';
const COPY_ROUTE = { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };

function write(repo, rel, text = 'x\n')
{
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
}

// A 0.2.x copy-route project: the stack's shipped copies, upstream-retired leftovers, and the user's
// own files beside them, with the hooks wired the way 0.2.87 wrote them.
function oldLayout(repo)
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

    test(`seed ${action}: every upstream-retired name is pruned and unwired, on either route`, POSIX_ONLY, () =>
    {
        for (const env of [{}, COPY_ROUTE])
        {
            const { result: r } = seedRun(action, SELECTION, { env, prepare: oldLayout, inspect: after });
            const route = Object.keys(env).length ? 'copy route' : 'plugin route';
            assert.ok(!r.has('.claude/skills/frontend'), `${route}: a retired skill survived`);
            assert.ok(!r.has('.claude/agents/code-analyzer.md'), `${route}: a retired agent survived`);
            assert.ok(!r.has('.claude/rules/house-baseline.md'), `${route}: a retired rule survived - an always-on one costs every session`);
            assert.ok(!r.has('.claude/hooks/require-convention-skill.js'), `${route}: a retired hook file survived`);
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

// The per-stack entries retired in 1.3.0 are read from meta/retired-entries.json by the seed alone -
// the frozen twins cannot copy their picks, so their lists never name them.
test('seed update: an enabled retired per-stack entry is uninstalled; a parked one and one at another scope stay', POSIX_ONLY, () =>
{
    const listing = JSON.stringify([
        { id: 'claude-stack-web-angular@envoydev', version: '1.2.0', scope: 'project', enabled: true },
        { id: 'claude-stack-angular@envoydev', version: '1.2.0', scope: 'project', enabled: false },
        { id: 'claude-stack-aspnet@envoydev', version: '1.2.0', scope: 'user', enabled: true },
    ]);
    const { calls } = seedRun('update', SELECTION, { plugins: listing });
    const uninstalls = calls.filter((c) => /plugin uninstall/.test(c));
    assert.ok(uninstalls.includes('plugin uninstall claude-stack-web-angular@envoydev --scope project -y'), uninstalls.join('\n') || 'no uninstall call');
    assert.ok(!uninstalls.some((c) => /claude-stack-angular@|claude-stack-aspnet@/.test(c)), uninstalls.join('\n'));
});

// One update whose plugin listing could not be read (the CLI failed, or is missing) cannot tell what
// the retired entries still carry - so it must not forget the picks the last stamp recorded, or the
// next update, listing healthy, reads the user's picks as never made and removes their only carrier.
test('seed update: a blind listing read keeps the stamp picks, so the next update still copies them', POSIX_ONLY, () =>
{
    const healthy = JSON.stringify([
        { id: 'alfred-code@envoydev', version: '1.2.0', scope: 'project', enabled: true },
        { id: 'claude-stack-angular@envoydev', version: '1.2.0', scope: 'project', enabled: true },
    ]);
    const prepare = (repo) =>
    {
        fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.claude', 'rules', 'baseline-interaction.md'), 'x\n');
        // A 1.2.0 project: the stamp carries the name that release wrote.
        fs.writeFileSync(path.join(repo, '.claude', 'claude-stack.stamp'), // legacy-name
            'version: 1.2.0\nsha: 0000000\npicked-skills: angular-conventions@claude-stack-angular,angular-testing@claude-stack-angular\npicked-agents: \n');
    };
    const { steps } = seedRun(['update', 'update'], SELECTION, {
        plugins: 'not json', args: ['--installed-only'], prepare,
        each: (repo, i) =>
        {
            if (i === 0) fs.writeFileSync(path.join(path.dirname(repo), 'plugins.json'), healthy);
            const stamp = fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8');
            return {
                picks: (/^picked-skills: (.*)$/m.exec(stamp) || [])[1] || '',
                copied: fs.existsSync(path.join(repo, '.claude', 'skills', 'angular-conventions', 'SKILL.md')),
                oldStamp: fs.existsSync(path.join(repo, '.claude', 'claude-stack.stamp')), // legacy-name
            };
        },
    });
    assert.match(steps[0].picks, /angular-conventions/, 'the blind run forgot the pick');
    assert.equal(steps[0].oldStamp, false, 'the 1.x stamp is left beside the new one');
    assert.ok(steps[1].copied, `the healthy run did not copy the pick (stamp picks: ${steps[1].picks})`);
});

// A retired entry's seat deny keeps the spelling Claude Code matches for as long as that entry is
// installed; only an entry this run uninstalled loses it (the core spelling carries the off-state).
test('seed update: a denied seat of a retired entry that stays installed keeps its own deny spelling', POSIX_ONLY, () =>
{
    const listing = JSON.stringify([
        { id: 'claude-stack-web-angular@envoydev', version: '1.2.0', scope: 'project', enabled: true },
        { id: 'claude-stack-aspnet@envoydev', version: '1.2.0', scope: 'user', enabled: true },
    ]);
    const prepare = (repo) => write(repo, '.claude/settings.json', `${JSON.stringify({ permissions: { deny: [
        'Agent(claude-stack-aspnet:aspnet-verifier)', 'Agent(claude-stack-web-angular:web-angular-verifier)'] } }, null, 2)}\n`);
    const { result } = seedRun('update', SELECTION, { plugins: listing, prepare,
        inspect: (repo) => JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')).permissions.deny });
    assert.ok(result.includes('Agent(claude-stack-aspnet:aspnet-verifier)'), `kept at user scope, so its spelling stays: ${result.join(',')}`);
    assert.ok(result.includes('Agent(alfred-code:aspnet-verifier)'), result.join(','));
    assert.ok(!result.includes('Agent(claude-stack-web-angular:web-angular-verifier)'), `uninstalled here, so only the core spelling: ${result.join(',')}`);
    assert.ok(result.includes('Agent(alfred-code:web-angular-verifier)'), result.join(','));
});
