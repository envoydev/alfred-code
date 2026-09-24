'use strict';
// scripts/install-scope.test.js - T16, R29: the installer supports all three Claude Code plugin
// scopes (project|user|local, 'global' an alias of user for a 1.x command body) while every
// project's OWN files - library copies, rules, hook engines, settings and the stamp - stay in the
// project's `.claude/` whatever scope was asked for. Only the plugins (and claude-hud, pinned to
// user regardless) follow the scope. Driven end to end through the Node seed with a recording
// `claude` stub - scripts/matrix-smoke.test.js is the sibling proving the two delivery ROUTES; this
// file is the sibling proving the three SCOPES.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');

// A library skill (not part of the core's own closure) plus a rule, so BOTH kinds of project copy
// actually land on the default plugin route - csharp is never core-carried, so it always copies.
const SELECTION = 'skill csharp\nrule markdown-docs\n';

const json = (repo, rel) => JSON.parse(fs.readFileSync(path.join(repo, rel), 'utf8'));
const exists = (repo, ...rel) => fs.existsSync(path.join(repo, ...rel));

for (const [scope, wantCliScope] of [['project', 'project'], ['user', 'user'], ['local', 'local'], ['global', 'user']])
{
    test(`install-scope: --scope ${scope} lands the library copy, the rule, the settings and the stamp in the PROJECT, and the plugin calls carry --scope ${wantCliScope}`, POSIX_ONLY, () =>
    {
        const { calls, result } = seedRun('install', SELECTION, {
            args: ['--scope', scope],
            inspect: (repo) => ({
                skill: exists(repo, '.claude', 'skills', 'csharp', 'SKILL.md'),
                rule: exists(repo, '.claude', 'rules', 'markdown-docs.md'),
                stamp: exists(repo, '.claude', 'alfred-code.stamp'),
                settingsFile: exists(repo, '.claude', 'settings.json') ? 'settings.json' : exists(repo, '.claude', 'settings.local.json') ? 'settings.local.json' : null,
                stampText: fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8'),
            }),
        });
        assert.ok(result.skill, 'the library skill did not land in the project');
        assert.ok(result.rule, 'the rule did not land in the project');
        assert.ok(result.stamp, 'the stamp did not land in the project');
        assert.match(result.stampText, new RegExp(`^scope: ${wantCliScope}$`, 'm'));
        assert.ok(calls.includes(`plugin install alfred-code@envoydev --scope ${wantCliScope} -y`), calls.join('\n'));
        assert.ok(calls.includes(`plugin install alfred-code-hooks@envoydev --scope ${wantCliScope} -y`), calls.join('\n'));
    });
}

test('install-scope: at local scope the stack\'s own settings writes go to settings.local.json, never settings.json', POSIX_ONLY, () =>
{
    const { result } = seedRun('install', SELECTION, {
        args: ['--scope', 'local'],
        inspect: (repo) => ({
            hasShared: exists(repo, '.claude', 'settings.json'),
            hasLocal: exists(repo, '.claude', 'settings.local.json'),
            local: exists(repo, '.claude', 'settings.local.json') ? json(repo, path.join('.claude', 'settings.local.json')) : null,
        }),
    });
    assert.strictEqual(result.hasShared, false, 'a local-scope install must not write the shared settings.json');
    assert.strictEqual(result.hasLocal, true, 'a local-scope install must write settings.local.json');
    assert.strictEqual(result.local.env.ALFRED_CODE_DOCS_PATH, '.claude/docs', 'the env seed landed in the local file');
});

test('install-scope: --scope project and --scope user both write the shared settings.json, never settings.local.json', POSIX_ONLY, () =>
{
    for (const scope of ['project', 'user'])
    {
        const { result } = seedRun('install', SELECTION, {
            args: ['--scope', scope],
            inspect: (repo) => ({
                hasShared: exists(repo, '.claude', 'settings.json'),
                hasLocal: exists(repo, '.claude', 'settings.local.json'),
            }),
        });
        assert.strictEqual(result.hasShared, true, `--scope ${scope} did not write settings.json`);
        assert.strictEqual(result.hasLocal, false, `--scope ${scope} wrote settings.local.json - it must not`);
    }
});

// R29: a 1.x GLOBAL install's stamp and skills sat in the account dir (CLAUDE_CONFIG_DIR). The
// first 2.x `update` reads them once and copies both into the project; the account copies stay in
// place, for other projects on the same machine that may still read them.
test('install-scope: a 1.x global install\'s account-dir stamp and skills are moved into the project on update', POSIX_ONLY, () =>
{
    const { result, out } = seedRun('update', SELECTION, {
        prepare: (repo, work) =>
        {
            const acct = path.join(work, 'acct');
            fs.mkdirSync(path.join(acct, 'skills', 'demo'), { recursive: true });
            fs.writeFileSync(path.join(acct, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: d\n---\nbody\n');
            fs.writeFileSync(path.join(acct, 'claude-stack.stamp'), 'sha: abc\nversion: 1.3.0\npicked-skills: demo\n');
        },
        inspect: (repo) =>
        {
            const acctSkills = path.join(path.dirname(repo), 'acct', 'skills', 'demo', 'SKILL.md');
            const acctStamp = path.join(path.dirname(repo), 'acct', 'claude-stack.stamp');
            return {
                migratedSkill: exists(repo, '.claude', 'skills', 'demo', 'SKILL.md'),
                acctSkillStillThere: fs.existsSync(acctSkills),
                acctStampStillThere: fs.existsSync(acctStamp),
                newStamp: exists(repo, '.claude', 'alfred-code.stamp'),
            };
        },
    });
    assert.match(out, /1 skill\(s\) were moved from .*acct.* into the project/, out);
    assert.ok(result.migratedSkill, 'the account skill was not copied into the project');
    assert.ok(result.acctSkillStillThere, 'the account skill copy was deleted - it must stay for other projects');
    assert.ok(result.acctStampStillThere, 'the account stamp was deleted - it must stay for other projects');
    assert.ok(result.newStamp, 'the run did not finish writing its own 2.x stamp');
});

test('install-scope: a 1.x account-dir stamp is left alone by a plain install - only update migrates it', POSIX_ONLY, () =>
{
    const { out } = seedRun('install', SELECTION, {
        prepare: (repo, work) =>
        {
            const acct = path.join(work, 'acct');
            fs.mkdirSync(acct, { recursive: true });
            fs.writeFileSync(path.join(acct, 'claude-stack.stamp'), 'sha: abc\nversion: 1.3.0\n');
        },
    });
    assert.doesNotMatch(out, /were moved from/, 'a bare install must not migrate a 1.x account install');
});

// R29: the memory db path is resolved PER PROJECT by the launcher, never baked into the
// registration - `--memory-level project` must ride every scope without refusal.
test('install-scope: --memory-level project rides --scope user without refusal', POSIX_ONLY, () =>
{
    const { out } = seedRun('install', SELECTION, { args: ['--scope', 'user', '--memory-level', 'project'] });
    assert.match(out, /memory=project \(/, out);
});

// I1 (R47, fix round 1): a local-scope import whose GATE actually opens (memory + baseline-memory
// picked, so the gate's mcps/rules checks pass; the sandbox's uvx stub is enough - `which` only
// checks presence, and the importer's own 'nothing to import' exit is success without a real
// server) writes the switch-off to settings.local.json, never the shared settings.json.
test('install-scope: at local scope a memory import that actually runs lands autoMemoryEnabled in settings.local.json, never settings.json', POSIX_ONLY, () =>
{
    const SEL = 'skill csharp\nrule markdown-docs\nrule baseline-memory\nmcp memory\n';
    const { out, result } = seedRun('install', SEL, {
        args: ['--scope', 'local'],
        inspect: (repo) => ({
            hasShared: exists(repo, '.claude', 'settings.json'),
            local: exists(repo, '.claude', 'settings.local.json') ? json(repo, path.join('.claude', 'settings.local.json')) : null,
        }),
    });
    assert.match(out, /settings\.local\.json: autoMemoryEnabled set to false/, out);
    assert.strictEqual(result.hasShared, false, 'the switch-off must not create the shared settings.json');
    assert.strictEqual(result.local.autoMemoryEnabled, false);
});

// I2 (R47, fix round 1): --installed-only's read-back now goes through readJson (fail-soft) against
// the scope's OWN settings file, never the old readSettings-based merge - a settings.json that does
// not parse must never abort the whole run (before this fix it threw and the run exited 1).
test('install-scope: a settings.json that does not parse never aborts update --installed-only (I2)', POSIX_ONLY, () =>
{
    const { outs } = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], ['--installed-only']],
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            const f = path.join(repo, '.claude', 'settings.json');
            fs.writeFileSync(f, `${fs.readFileSync(f, 'utf8')}{garbage`);
            return null;
        },
    });
    assert.match(outs[1], /action: update/, 'a malformed settings.json must not abort the run');
});

// I2 (R47, fix round 1): the read-back reads the raw file, never a filtered/derived view - a
// hand-added permissions.allow/ask survives a project-scope update --installed-only untouched.
test('install-scope: permissions.allow and permissions.ask survive update --installed-only (I2)', POSIX_ONLY, () =>
{
    const { result } = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], ['--installed-only']],
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            const f = path.join(repo, '.claude', 'settings.json');
            const s = JSON.parse(fs.readFileSync(f, 'utf8'));
            s.permissions.allow = ['Bash(ls:*)'];
            s.permissions.ask = ['Bash(rm:*)'];
            fs.writeFileSync(f, JSON.stringify(s, null, 2));
            return null;
        },
        inspect: (repo) => json(repo, path.join('.claude', 'settings.json')),
    });
    assert.deepStrictEqual(result.permissions.allow, ['Bash(ls:*)']);
    assert.deepStrictEqual(result.permissions.ask, ['Bash(rm:*)']);
});

// I3 (R47, fix round 1): args.js leaves --scope '' when not given; a bare `update` with no --scope
// takes the scope from the PROJECT stamp's own `scope:` line, so a local (or user) install is never
// silently dropped back to project on the next update.
test('install-scope: --scope local, then a bare update with no --scope flag, keeps settings.json absent (I3)', POSIX_ONLY, () =>
{
    const { outs, result } = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'local'], []],
        inspect: (repo) => ({
            hasShared: exists(repo, '.claude', 'settings.json'),
            hasLocal: exists(repo, '.claude', 'settings.local.json'),
            stampText: fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8'),
        }),
    });
    assert.match(outs[1], /action: update \[scope=local,/, outs[1]);
    assert.strictEqual(result.hasShared, false, 'a bare update after a local-scope install must not create settings.json');
    assert.strictEqual(result.hasLocal, true);
    assert.match(result.stampText, /^scope: local$/m);
});

// I4 (R47, fix round 1): `--installed-only --print-plan` is read-only - configure.md and
// validate.md call it as a run that writes nothing. Over an unmigrated 1.x global project it must
// read the legacy account stamp and skills IN PLACE (the library-check.js fallback pattern) rather
// than either failing 'nothing installed' or migrating them into the project.
test('install-scope: update --installed-only --print-plan reads a 1.x account stamp in place and never migrates it', POSIX_ONLY, () =>
{
    const { out, result } = seedRun('update', SELECTION, {
        args: ['--installed-only', '--print-plan'],
        prepare: (repo, work) =>
        {
            const acct = path.join(work, 'acct');
            fs.mkdirSync(path.join(acct, 'skills', 'csharp'), { recursive: true });
            fs.writeFileSync(path.join(acct, 'skills', 'csharp', 'SKILL.md'), '---\nname: csharp\ndescription: d\n---\nbody\n');
            fs.writeFileSync(path.join(acct, 'claude-stack.stamp'), 'sha: abc\nversion: 1.3.0\npicked-skills: csharp\n');
        },
        inspect: (repo) => ({
            migratedSkill: exists(repo, '.claude', 'skills', 'csharp', 'SKILL.md'),
            projectStamp: exists(repo, '.claude', 'alfred-code.stamp'),
        }),
    });
    assert.match(out, /^plan skills: csharp$/m, out);
    assert.doesNotMatch(out, /were moved from/, 'a --print-plan read must never migrate');
    assert.strictEqual(result.migratedSkill, false, 'the account skill must not be copied into the project by a read-only run');
    assert.strictEqual(result.projectStamp, false, 'a --print-plan run must never write the project its own stamp');
});

// I5 (R47, fix round 1): the MCP COPY route bakes one path into a user-scope `claude mcp add -s
// user`, so `--memory-level project` there would open every project of the account onto this one's
// db - refused on that route and scope only.
test('install-scope: --memory-level project at --scope user is refused on the MCP copy route (I5)', POSIX_ONLY, () =>
{
    assert.throws(
        () => seedRun('install', SELECTION, {
            args: ['--scope', 'user', '--memory-level', 'project'],
            env: { ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' },
        }),
        (e) => /--memory-level project is refused at --scope user on the MCP copy route/.test(e.stderr || e.message),
    );
});

test('install-scope: --memory-level project at --scope project is never refused on the MCP copy route (I5)', POSIX_ONLY, () =>
{
    const { out } = seedRun('install', SELECTION, {
        args: ['--scope', 'project', '--memory-level', 'project'],
        env: { ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' },
    });
    assert.match(out, /memory=project \(/, out);
});
