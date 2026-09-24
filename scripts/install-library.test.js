'use strict';
// The library copy (install/library.js): every skill and agent outside the core is copied into the
// project per pick, and the stamp keeps the hash of what was written so a hand edit is visible.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { hashItem, hashBuffer, copyLibrary } = require('./install/library.js');

function fixture()
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-'));
    const src = path.join(root, 'src');
    fs.mkdirSync(path.join(src, 'stack/skills/demo/references'), { recursive: true });
    fs.writeFileSync(path.join(src, 'stack/skills/demo/SKILL.md'), '---\nname: demo\ndescription: d\n---\nbody\n');
    fs.writeFileSync(path.join(src, 'stack/skills/demo/references/a.md'), 'a\n');
    fs.mkdirSync(path.join(src, 'stack/agents'), { recursive: true });
    fs.writeFileSync(path.join(src, 'stack/agents/seat.md'), '---\nname: seat\ndescription: s\n---\nbody\n');
    fs.mkdirSync(path.join(src, 'stack/rules'), { recursive: true });
    fs.writeFileSync(path.join(src, 'stack/rules/baseline-git.md'), '# git\n');
    const proj = path.join(root, 'proj/.claude');
    return {
        root, src, skillsDir: path.join(proj, 'skills'), agentsDir: path.join(proj, 'agents'),
        rulesDir: path.join(proj, 'rules'),
    };
}

test('copies picks and returns their hashes', () =>
{
    const f = fixture();
    const logs = [];
    const got = copyLibrary({ sourceDir: f.src, skillsDir: f.skillsDir, agentsDir: f.agentsDir, skills: ['demo'], agents: ['seat'], stamped: null, log: (l) => logs.push(l), note: () => {} });
    assert.equal(got.skills.demo, hashItem(path.join(f.src, 'stack/skills/demo')));
    assert.equal(got.agents.seat, hashItem(path.join(f.src, 'stack/agents/seat.md')));
    assert.ok(fs.existsSync(path.join(f.skillsDir, 'demo/references/a.md')));
    fs.rmSync(f.root, { recursive: true, force: true });
});

test('an identical copy is not rewritten', () =>
{
    const f = fixture();
    const opts = { sourceDir: f.src, skillsDir: f.skillsDir, agentsDir: f.agentsDir, skills: ['demo'], agents: [], stamped: null, log: () => {}, note: () => {} };
    copyLibrary(opts);
    const before = fs.statSync(path.join(f.skillsDir, 'demo/SKILL.md')).mtimeMs;
    const logs = [];
    copyLibrary({ ...opts, log: (l) => logs.push(l) });
    assert.equal(fs.statSync(path.join(f.skillsDir, 'demo/SKILL.md')).mtimeMs, before);
    assert.ok(!logs.some((l) => /skill \[/.test(l)), 'no copy line on an unchanged item');
    fs.rmSync(f.root, { recursive: true, force: true });
});

test('a hand-edited copy is overwritten, and the log says so', () =>
{
    const f = fixture();
    const opts = { sourceDir: f.src, skillsDir: f.skillsDir, agentsDir: f.agentsDir, skills: [], agents: ['seat'], log: () => {}, note: () => {} };
    const first = copyLibrary({ ...opts, stamped: null });
    fs.appendFileSync(path.join(f.agentsDir, 'seat.md'), 'local edit\n');
    const logs = [];
    copyLibrary({ ...opts, stamped: first, log: (l) => logs.push(l) });
    assert.ok(logs.some((l) => l.includes('overwriting a hand-edited copy: agent seat')));
    assert.equal(fs.readFileSync(path.join(f.agentsDir, 'seat.md'), 'utf8'), fs.readFileSync(path.join(f.src, 'stack/agents/seat.md'), 'utf8'));
    fs.rmSync(f.root, { recursive: true, force: true });
});

test('a missing source is reported and the existing copy kept', () =>
{
    const f = fixture();
    const notes = [];
    const got = copyLibrary({ sourceDir: f.src, skillsDir: f.skillsDir, agentsDir: f.agentsDir, skills: ['nope'], agents: [], stamped: null, log: () => {}, note: (n) => notes.push(n) });
    assert.deepEqual(got.skills, {});
    assert.ok(notes.some((n) => n.includes("skill 'nope' not found")));
    fs.rmSync(f.root, { recursive: true, force: true });
});

test('hashItem: a file and a directory hash by content and relative path; an absent path is null', () =>
{
    const f = fixture();
    const dir = path.join(f.src, 'stack/skills/demo');
    const h = hashItem(dir);
    assert.match(h, /^[0-9a-f]{64}$/);
    fs.writeFileSync(path.join(dir, 'references/a.md'), 'b\n');
    assert.notEqual(hashItem(dir), h, 'a content change moves the hash');
    assert.equal(hashItem(path.join(f.root, 'absent')), null);
    fs.rmSync(f.root, { recursive: true, force: true });
});

// Rules are a third kind, same shape as agents (a single .md file per name) - the whole point is
// that the copy, the skip, the hand-edit log and the missing-source report all work identically.
test('rules copy alongside skills and agents, as a third kind', () =>
{
    const f = fixture();
    const logs = [];
    const got = copyLibrary({
        sourceDir: f.src, skillsDir: f.skillsDir, agentsDir: f.agentsDir, rulesDir: f.rulesDir,
        skills: ['demo'], agents: ['seat'], rules: ['baseline-git'], stamped: null,
        log: (l) => logs.push(l), note: () => {},
    });
    assert.equal(got.rules['baseline-git'], hashItem(path.join(f.src, 'stack/rules/baseline-git.md')));
    assert.ok(fs.existsSync(path.join(f.rulesDir, 'baseline-git.md')));
    assert.ok(logs.some((l) => l === 'rule [library]: baseline-git'));
    fs.rmSync(f.root, { recursive: true, force: true });
});

test('a hand-edited rule copy is overwritten, and the log says so', () =>
{
    const f = fixture();
    const opts = { sourceDir: f.src, rulesDir: f.rulesDir, rules: ['baseline-git'], log: () => {}, note: () => {} };
    const first = copyLibrary({ ...opts, stamped: null });
    fs.appendFileSync(path.join(f.rulesDir, 'baseline-git.md'), 'local edit\n');
    const logs = [];
    copyLibrary({ ...opts, stamped: first, log: (l) => logs.push(l) });
    assert.ok(logs.some((l) => l.includes('overwriting a hand-edited copy: rule baseline-git')));
    assert.equal(fs.readFileSync(path.join(f.rulesDir, 'baseline-git.md'), 'utf8'), fs.readFileSync(path.join(f.src, 'stack/rules/baseline-git.md'), 'utf8'));
    fs.rmSync(f.root, { recursive: true, force: true });
});

// hashBuffer is hashItem's single-file formula, applied to content already in memory - the route
// library-check.js needs for a NORMALISED comparison (the docs-root placeholder restored) without
// writing a probe file to disk.
test('hashBuffer matches hashItem for the same name and bytes', () =>
{
    const f = fixture();
    const file = path.join(f.src, 'stack/rules/baseline-git.md');
    const buf = fs.readFileSync(file);
    assert.equal(hashBuffer('baseline-git.md', buf), hashItem(file));
    assert.notEqual(hashBuffer('other.md', buf), hashItem(file), 'the name is part of the hash, like a real path');
    fs.rmSync(f.root, { recursive: true, force: true });
});

// --keep-pins restores a local agent pin AFTER copyLibrary already hashed the refreshed file, so
// the stamp must re-hash what it just restored - end to end, through the real Node seed, because
// the bug lives in the ORDER of two calls inside alfred-code.js's main(), not in either layer alone.
const ROOT = path.join(__dirname, '..');
const SEED = path.join(__dirname, 'install', 'alfred-code.js');

test('--keep-pins: the stamp records the hash AFTER the restore, never the stale pre-restore one', { skip: process.platform === 'win32' && 'a shell stub CLI' }, () =>
{
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-pins-'));
    try
    {
        const repo = path.join(work, 'repo');
        fs.mkdirSync(repo);
        execFileSync('git', ['init', '-q', repo]);
        const bin = path.join(work, 'bin');
        fs.mkdirSync(bin);
        const log = path.join(work, 'claude-calls.log');
        fs.writeFileSync(path.join(work, 'plugins.json'), '[]');
        fs.writeFileSync(path.join(bin, 'claude'), ['#!/bin/sh', 'printf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"',
            'if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then cat "$CLAUDE_STUB_PLUGINS"; fi', 'exit 0', ''].join('\n'), { mode: 0o755 });
        for (const tool of ['uvx', 'npx', 'npm', 'curl']) fs.writeFileSync(path.join(bin, tool), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
        const SELECTION = 'skill markdown-style\nagent related-project-analyzer\nrule markdown-docs\nmcp serena\nmcp context7\nmcp memory\n';
        fs.writeFileSync(path.join(work, 'sel.txt'), SELECTION);
        const env = {
            ...process.env, HOME: work, CLAUDE_CONFIG_DIR: path.join(work, 'acct'), PATH: bin + path.delimiter + process.env.PATH,
            CLAUDE_STUB_LOG: log, CLAUDE_STUB_PLUGINS: path.join(work, 'plugins.json'),
        };
        for (const k of Object.keys(env)) if (k.startsWith('ALFRED_CODE_') || k.startsWith('CLAUDE_STACK_')) delete env[k];
        for (const k of ['SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY']) delete env[k];
        const call = (source, extra = []) => execFileSync(process.execPath,
            [SEED, extra[0], '--selection', path.join(work, 'sel.txt'), '--source', source, ...extra.slice(1)],
            { cwd: repo, env, encoding: 'utf8' });

        call(ROOT, ['install']);
        const agentFile = path.join(repo, '.claude', 'agents', 'related-project-analyzer.md');
        assert.match(fs.readFileSync(agentFile, 'utf8'), /^effort: medium$/m, 'the fresh install carries the catalog pin');

        // The user hand-tunes the pin locally, after the install.
        fs.writeFileSync(agentFile, fs.readFileSync(agentFile, 'utf8').replace(/^effort: medium$/m, 'effort: xhigh'));

        // A second source where the CATALOG pin itself moved - a real upstream change the refresh
        // would otherwise reset the project to, if --keep-pins did not restore the local value.
        const sourceB = path.join(work, 'source-b');
        fs.cpSync(ROOT, sourceB, { recursive: true, filter: (src) => !/(^|[/\\])(\.git|node_modules)([/\\]|$)/.test(src.slice(ROOT.length)) });
        const catalogAgent = path.join(sourceB, 'stack', 'agents', 'related-project-analyzer.md');
        fs.writeFileSync(catalogAgent, fs.readFileSync(catalogAgent, 'utf8').replace(/^effort: medium$/m, 'effort: high'));

        call(sourceB, ['update', '--keep-pins']);
        const after = fs.readFileSync(agentFile, 'utf8');
        assert.match(after, /^effort: xhigh$/m, 'the local override survived --keep-pins over an upstream pin change');

        const stamp = fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8');
        const recorded = (/^library-agents:.*\brelated-project-analyzer=([0-9a-f]+)/m.exec(stamp) || [])[1];
        assert.strictEqual(recorded, hashItem(agentFile), 'the stamp must record the hash of what --keep-pins left on disk, not what copyLibrary wrote before the restore');
    }
    finally { fs.rmSync(work, { recursive: true, force: true }); }
});

// baseline-docs-root.md is rewritten TWICE on a fresh install: copyLibrary copies the pristine
// source (still holding __DOCS_ROOT__), then copy.stampDocsRoot substitutes the resolved path IN
// PLACE. The hash recorded in the stamp must be of the file as it ends up on disk, or every check
// from the very first install reads this rule as drift.
test('a fresh install records baseline-docs-root\'s hash AFTER the placeholder substitution', { skip: process.platform === 'win32' && 'a shell stub CLI' }, () =>
{
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-root-hash-'));
    try
    {
        const repo = path.join(work, 'repo');
        fs.mkdirSync(repo);
        execFileSync('git', ['init', '-q', repo]);
        const bin = path.join(work, 'bin');
        fs.mkdirSync(bin);
        const log = path.join(work, 'claude-calls.log');
        fs.writeFileSync(path.join(work, 'plugins.json'), '[]');
        fs.writeFileSync(path.join(bin, 'claude'), ['#!/bin/sh', 'printf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"',
            'if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then cat "$CLAUDE_STUB_PLUGINS"; fi', 'exit 0', ''].join('\n'), { mode: 0o755 });
        for (const tool of ['uvx', 'npx', 'npm', 'curl']) fs.writeFileSync(path.join(bin, tool), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
        // A bare --selection file is taken literally (applySelection keeps only the names it lists -
        // the locked-rule union only happens on the --installed-only path), so the rule under test is
        // named explicitly, exactly as the walk that writes a real selection file always does.
        fs.writeFileSync(path.join(work, 'sel.txt'), 'skill markdown-style\nrule baseline-docs-root\nmcp serena\nmcp context7\nmcp memory\n');
        const env = {
            ...process.env, HOME: work, CLAUDE_CONFIG_DIR: path.join(work, 'acct'), PATH: bin + path.delimiter + process.env.PATH,
            CLAUDE_STUB_LOG: log, CLAUDE_STUB_PLUGINS: path.join(work, 'plugins.json'),
        };
        for (const k of Object.keys(env)) if (k.startsWith('ALFRED_CODE_') || k.startsWith('CLAUDE_STACK_')) delete env[k];
        for (const k of ['SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY']) delete env[k];
        execFileSync(process.execPath, [SEED, 'install', '--selection', path.join(work, 'sel.txt'), '--source', ROOT], { cwd: repo, env, encoding: 'utf8' });

        const rulePath = path.join(repo, '.claude', 'rules', 'baseline-docs-root.md');
        const content = fs.readFileSync(rulePath, 'utf8');
        assert.ok(!content.includes('__DOCS_ROOT__'), 'the placeholder was substituted');
        const stamp = fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8');
        const recorded = (/^library-rules:.*\bbaseline-docs-root=([0-9a-f]+)/m.exec(stamp) || [])[1];
        assert.strictEqual(recorded, hashItem(rulePath), 'the recorded hash must match the SUBSTITUTED file, not the pristine placeholder copyLibrary first wrote');

        const { check } = require('./library-check.js');
        const row = check({ project: repo, source: ROOT }).rows.find((r) => r.name === 'baseline-docs-root');
        assert.strictEqual(row.state, 'ok', `baseline-docs-root read as ${row.state} right after the install that wrote it`);
    }
    finally { fs.rmSync(work, { recursive: true, force: true }); }
});

// On the FULL copy route (no plugin runs), a registered server answers its BARE tool name, so
// downconvertToolNames re-spells every `mcp__plugin_<n>_<n>__` occurrence in a copied rule's body -
// baseline-memory.md's own ToolSearch line is real, shipped content that does exactly this. The
// rewrite lands AFTER copyLibrary already hashed the rule, so the stamp must be re-hashed too.
test('the copy-route MCP tool-name re-spelling is hashed too - a rewritten rule never reads as drift', { skip: process.platform === 'win32' && 'a shell stub CLI' }, () =>
{
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'downconvert-hash-'));
    try
    {
        const repo = path.join(work, 'repo');
        fs.mkdirSync(repo);
        execFileSync('git', ['init', '-q', repo]);
        const bin = path.join(work, 'bin');
        fs.mkdirSync(bin);
        const log = path.join(work, 'claude-calls.log');
        fs.writeFileSync(path.join(work, 'plugins.json'), '[]');
        fs.writeFileSync(path.join(bin, 'claude'), ['#!/bin/sh', 'printf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"',
            'if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then cat "$CLAUDE_STUB_PLUGINS"; fi', 'exit 0', ''].join('\n'), { mode: 0o755 });
        for (const tool of ['uvx', 'npx', 'npm', 'curl']) fs.writeFileSync(path.join(bin, tool), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
        fs.writeFileSync(path.join(work, 'sel.txt'), 'skill markdown-style\nrule baseline-memory\nmcp memory\n');
        const env = {
            ...process.env, HOME: work, CLAUDE_CONFIG_DIR: path.join(work, 'acct'), PATH: bin + path.delimiter + process.env.PATH,
            CLAUDE_STUB_LOG: log, CLAUDE_STUB_PLUGINS: path.join(work, 'plugins.json'),
        };
        for (const k of Object.keys(env)) if (k.startsWith('ALFRED_CODE_') || k.startsWith('CLAUDE_STACK_')) delete env[k];
        for (const k of ['SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY']) delete env[k];
        // The FULL copy route: no plugin runs, so a registered server answers its bare tool name and
        // downconvertToolNames has real work to do.
        env.ALFRED_CODE_SKILLS_VIA_PLUGIN = 'false';
        env.ALFRED_CODE_HOOKS_VIA_PLUGIN = 'false';
        env.ALFRED_CODE_MCPS_VIA_PLUGIN = 'false';
        execFileSync(process.execPath, [SEED, 'install', '--selection', path.join(work, 'sel.txt'), '--source', ROOT], { cwd: repo, env, encoding: 'utf8' });

        const rulePath = path.join(repo, '.claude', 'rules', 'baseline-memory.md');
        const content = fs.readFileSync(rulePath, 'utf8');
        // Built, never typed literally: lint check 54 bans the bare `mcp__<server>__` spelling
        // anywhere under scripts/, and the down-converter itself builds it the same way.
        const bareTool = (server, tool) => `mcp__${server}__${tool}`;
        assert.ok(content.includes(bareTool('memory', 'memory_store')), 'the bare-registered server name was re-spelled into the rule');
        assert.ok(!content.includes('mcp__plugin_memory_memory__'), 'the plugin spelling did not survive the copy route');
        const stamp = fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8');
        const recorded = (/^library-rules:.*\bbaseline-memory=([0-9a-f]+)/m.exec(stamp) || [])[1];
        assert.strictEqual(recorded, hashItem(rulePath), 'the recorded hash must match the RE-SPELLED file, not what copyLibrary wrote before the downconvert pass');
    }
    finally { fs.rmSync(work, { recursive: true, force: true }); }
});
