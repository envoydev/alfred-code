'use strict';
// The library copy (install/library.js): every skill and agent outside the core is copied into the
// project per pick, and the stamp keeps the hash of what was written so a hand edit is visible.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hashItem, hashBuffer, copyLibrary } = require('./install/library.js');
const { check } = require('./library-check.js');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');

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
    fs.writeFileSync(path.join(src, 'stack/rules/alfred-git.md'), '# git\n');
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

// M3: with no stamp hash to judge by, a same-named folder the caller cannot claim for the stack (not recorded, a
// name a project uses of its own) is the project's: kept byte for byte, named with the `!!` marker every update
// body surfaces, left out of the returned hashes so the stamp never records it - and a later run keeps it again.
test('M3 a same-named skill the caller cannot claim is kept, named and not recorded', () =>
{
    const f = fixture();
    const mine = '---\nname: demo\ndescription: our own\n---\nours\n';
    fs.mkdirSync(path.join(f.skillsDir, 'demo'), { recursive: true });
    fs.writeFileSync(path.join(f.skillsDir, 'demo', 'SKILL.md'), mine);
    const logs = [];
    const opts = { sourceDir: f.src, skillsDir: f.skillsDir, agentsDir: f.agentsDir, skills: ['demo'], agents: ['seat'], stamped: null, note: () => {} };
    const got = copyLibrary({ ...opts, claims: (kind) => kind !== 'skills', log: (l) => logs.push(l) });
    assert.strictEqual(fs.readFileSync(path.join(f.skillsDir, 'demo', 'SKILL.md'), 'utf8'), mine, 'not overwritten');
    assert.ok(!fs.existsSync(path.join(f.skillsDir, 'demo', 'references')), 'nothing of the stack\'s copy mixed in');
    assert.ok(!Object.hasOwn(got.skills, 'demo'), 'not recorded');
    assert.deepStrictEqual(got.foreign, ['demo']);
    assert.ok(logs.some((l) => /^ {2}!! skill kept: demo - /.test(l)), logs.join('\n'));
    assert.ok(got.agents.seat, 'an agent the caller claims still copies');
    // A caller that claims it (the stamp records it, or only the stack uses the name) overwrites as before.
    copyLibrary({ ...opts, claims: () => true, log: () => {} });
    assert.strictEqual(fs.readFileSync(path.join(f.skillsDir, 'demo', 'SKILL.md'), 'utf8'), fs.readFileSync(path.join(f.src, 'stack/skills/demo/SKILL.md'), 'utf8'));
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
        skills: ['demo'], agents: ['seat'], rules: ['alfred-git'], stamped: null,
        log: (l) => logs.push(l), note: () => {},
    });
    assert.equal(got.rules['alfred-git'], hashItem(path.join(f.src, 'stack/rules/alfred-git.md')));
    assert.ok(fs.existsSync(path.join(f.rulesDir, 'alfred-git.md')));
    assert.ok(logs.some((l) => l === 'rule [library]: alfred-git'));
    fs.rmSync(f.root, { recursive: true, force: true });
});

test('a hand-edited rule copy is overwritten, and the log says so', () =>
{
    const f = fixture();
    const opts = { sourceDir: f.src, rulesDir: f.rulesDir, rules: ['alfred-git'], log: () => {}, note: () => {} };
    const first = copyLibrary({ ...opts, stamped: null });
    fs.appendFileSync(path.join(f.rulesDir, 'alfred-git.md'), 'local edit\n');
    const logs = [];
    copyLibrary({ ...opts, stamped: first, log: (l) => logs.push(l) });
    assert.ok(logs.some((l) => l.includes('overwriting a hand-edited copy: rule alfred-git')));
    assert.equal(fs.readFileSync(path.join(f.rulesDir, 'alfred-git.md'), 'utf8'), fs.readFileSync(path.join(f.src, 'stack/rules/alfred-git.md'), 'utf8'));
    fs.rmSync(f.root, { recursive: true, force: true });
});

// hashBuffer is hashItem's single-file formula, applied to content already in memory - the route
// library-check.js needs for a NORMALISED comparison (the docs-root placeholder restored) without
// writing a probe file to disk.
test('hashBuffer matches hashItem for the same name and bytes', () =>
{
    const f = fixture();
    const file = path.join(f.src, 'stack/rules/alfred-git.md');
    const buf = fs.readFileSync(file);
    assert.equal(hashBuffer('alfred-git.md', buf), hashItem(file));
    assert.notEqual(hashBuffer('other.md', buf), hashItem(file), 'the name is part of the hash, like a real path');
    fs.rmSync(f.root, { recursive: true, force: true });
});

// --keep-pins restores a local agent pin AFTER copyLibrary already hashed the refreshed file, so
// the stamp must re-hash what it just restored - end to end, through the real Node seed, because
// the bug lives in the ORDER of two calls inside alfred-code.js's main(), not in either layer alone.
// All three tests below run through seed-sandbox.js's seedRun - the same throwaway-project,
// recording-`claude`-stub sandbox every other seed-level test file already uses - rather than
// hand-rolling the bin stubs, env and legacy-name scrub again.
const ROOT = path.join(__dirname, '..');

test('--keep-pins: the stamp records the hash AFTER the restore, never the stale pre-restore one', POSIX_ONLY, () =>
{
    // A second source where the CATALOG pin itself moved - a real upstream change the refresh would
    // otherwise reset the project to, if --keep-pins did not restore the local value. Built outside
    // seedRun's own sandbox, since it must exist before the run that reads it as --source.
    const srcWork = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-pins-src-'));
    try
    {
        const sourceB = path.join(srcWork, 'source-b');
        fs.cpSync(ROOT, sourceB, { recursive: true, filter: (src) => !/(^|[/\\])(\.git|node_modules)([/\\]|$)/.test(src.slice(ROOT.length)) });
        const catalogAgent = path.join(sourceB, 'stack', 'agents', 'related-project-analyzer.md');
        fs.writeFileSync(catalogAgent, fs.readFileSync(catalogAgent, 'utf8').replace(/^effort: medium$/m, 'effort: high'));

        // 2.1.0: a seat is a COPY only on the skills copy route (on the plugin route it rides the core), so
        // that is where a local pin lives to be kept; its hash is the ledger's `managed-files` row there.
        const SELECTION = 'skill markdown-style\nagent related-project-analyzer\nrule markdown-docs\nmcp serena\nmcp context7\nmcp memory\n';
        const { result } = seedRun(['install', 'update'], SELECTION, {
            env: { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' },
            source: [ROOT, sourceB],
            args: [[], ['--keep-pins']],
            // The user hand-tunes the pin locally, right after the fresh install and before the update.
            each: (repo, i) =>
            {
                if (i !== 0) return null;
                const agentFile = path.join(repo, '.claude', 'agents', 'related-project-analyzer.md');
                assert.match(fs.readFileSync(agentFile, 'utf8'), /^effort: medium$/m, 'the fresh install carries the catalog pin');
                fs.writeFileSync(agentFile, fs.readFileSync(agentFile, 'utf8').replace(/^effort: medium$/m, 'effort: xhigh'));
                return null;
            },
            inspect: (repo) =>
            {
                const agentFile = path.join(repo, '.claude', 'agents', 'related-project-analyzer.md');
                const stamp = fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8');
                return {
                    agent: fs.readFileSync(agentFile, 'utf8'),
                    recorded: (/^managed-files:.*\bagents\/related-project-analyzer\.md=([0-9a-f]+)/m.exec(stamp) || [])[1],
                    computed: hashItem(agentFile),
                };
            },
        });
        assert.match(result.agent, /^effort: xhigh$/m, 'the local override survived --keep-pins over an upstream pin change');
        assert.strictEqual(result.recorded, result.computed, 'the stamp must record the hash of what --keep-pins left on disk, not what copyLibrary wrote before the restore');
    }
    finally { fs.rmSync(srcWork, { recursive: true, force: true }); }
});

// alfred-docs-root.md is rewritten TWICE on a fresh install: copyLibrary copies the pristine
// source (still holding __DOCS_ROOT__), then copy.stampDocsRoot substitutes the resolved path IN
// PLACE. The hash recorded in the stamp must be of the file as it ends up on disk, or every check
// from the very first install reads this rule as drift.
test('a fresh install records alfred-docs-root\'s hash AFTER the placeholder substitution', POSIX_ONLY, () =>
{
    // A bare --selection file is taken literally (applySelection keeps only the names it lists - the
    // locked-rule union only happens on the --installed-only path), so the rule under test is named
    // explicitly, exactly as the walk that writes a real selection file always does.
    const { result } = seedRun('install', 'skill markdown-style\nrule alfred-docs-root\nmcp serena\nmcp context7\nmcp memory\n', {
        inspect: (repo) =>
        {
            const rulePath = path.join(repo, '.claude', 'rules', 'alfred-docs-root.md');
            const content = fs.readFileSync(rulePath, 'utf8');
            const stamp = fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8');
            const row = check({ project: repo, source: ROOT }).rows.find((r) => r.name === 'alfred-docs-root');
            return {
                hasPlaceholder: content.includes('__DOCS_ROOT__'),
                recorded: (/^library-rules:.*\balfred-docs-root=([0-9a-f]+)/m.exec(stamp) || [])[1],
                computed: hashItem(rulePath),
                state: row && row.state,
            };
        },
    });
    assert.ok(!result.hasPlaceholder, 'the placeholder was substituted');
    assert.strictEqual(result.recorded, result.computed, 'the recorded hash must match the SUBSTITUTED file, not the pristine placeholder copyLibrary first wrote');
    assert.strictEqual(result.state, 'ok', `alfred-docs-root read as ${result.state} right after the install that wrote it`);
});

// On the FULL copy route (no plugin runs), a registered server answers its BARE tool name, so
// downconvertToolNames re-spells every `mcp__plugin_<n>_<n>__` occurrence in a copied rule's body -
// alfred-memory.md's own ToolSearch line is real, shipped content that does exactly this. The
// rewrite lands AFTER copyLibrary already hashed the rule, so the stamp must be re-hashed too.
test('the copy-route MCP tool-name re-spelling is hashed too - a rewritten rule never reads as drift', POSIX_ONLY, () =>
{
    // The FULL copy route: no plugin runs, so a registered server answers its bare tool name and
    // downconvertToolNames has real work to do.
    const { result } = seedRun('install', 'skill markdown-style\nrule alfred-memory\nmcp memory\n', {
        env: { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' },
        inspect: (repo) =>
        {
            const rulePath = path.join(repo, '.claude', 'rules', 'alfred-memory.md');
            const content = fs.readFileSync(rulePath, 'utf8');
            const stamp = fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8');
            return {
                content,
                recorded: (/^library-rules:.*\balfred-memory=([0-9a-f]+)/m.exec(stamp) || [])[1],
                computed: hashItem(rulePath),
            };
        },
    });
    // Built, never typed literally: lint check 54 bans the bare `mcp__<server>__` spelling
    // anywhere under scripts/, and the down-converter itself builds it the same way.
    const bareTool = (server, tool) => `mcp__${server}__${tool}`;
    assert.ok(result.content.includes(bareTool('alfred-memory', 'memory_store')), 'the bare-registered server name was re-spelled into the rule');
    assert.ok(!result.content.includes('mcp__plugin_alfred-memory_alfred-memory__'), 'the plugin spelling did not survive the copy route');
    assert.strictEqual(result.recorded, result.computed, 'the recorded hash must match the RE-SPELLED file, not what copyLibrary wrote before the downconvert pass');
});

// Task 8a concern 7: every update logged alfred-docs-root as rewritten - copyLibrary compared the
// stamped copy with the placeholder source, copied the source back, and the docs-root stamp put the
// same value in again. The rule is rendered before the comparison now, so only a real change (a new
// docs root) is a write, and a log line.
test('alfred-docs-root is logged as rewritten only when its content changed', POSIX_ONLY, () =>
{
    const setDocsPath = (repo) =>
    {
        const file = path.join(repo, '.claude', 'settings.json');
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        data.env.ALFRED_CODE_DOCS_PATH = 'docs-moved';
        fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    };
    const rulePath = (repo) => path.join(repo, '.claude', 'rules', 'alfred-docs-root.md');
    const { outs, steps } = seedRun(['install', 'update', 'update'], 'skill markdown-style\nrule alfred-docs-root\nmcp serena\nmcp context7\nmcp memory\n', {
        each: (repo, i) => { const text = fs.readFileSync(rulePath(repo), 'utf8'); if (i === 1) setDocsPath(repo); return text; },
    });
    const said = (out) => /rule \[library\]: alfred-docs-root|rule stamped: alfred-docs-root/.test(out);
    assert.ok(said(outs[0]), `the first install writes it:\n${outs[0]}`);
    assert.strictEqual(steps[1], steps[0], 'an update with the same docs root leaves the rule as it was');
    assert.ok(!said(outs[1]), `an unchanged rule was logged as rewritten:\n${outs[1].split('\n').filter((l) => /docs-root/.test(l)).join('\n')}`);
    assert.ok(said(outs[2]), 'a new docs root is a rewrite, and says so');
    assert.match(steps[2], /This install's root: `docs-moved`/);
});

// R111 (Task 8a concern a): on the copy route the tool-name re-spelling rewrote each rule carrying a
// plugin tool name AFTER copyLibrary had compared it with its source - so the next run found it
// different, copied the plugin spelling back and re-spelled it again: three rules logged as rewritten
// on every run with nothing changed. The re-spelling is part of the rendered text now, like the docs
// root, so only a real change is a write and a log line.
test('copy route: a rule is logged as rewritten only when its content changed - the tool-name re-spelling alone is none (R111)', POSIX_ONLY, () =>
{
    const env = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
    const rule = (repo) => path.join(repo, '.claude', 'rules', 'alfred-navigation.md');
    const { outs, steps } = seedRun(['install', 'update', 'update'], 'skill markdown-style\nrule alfred-navigation\nrule alfred-quality-gates\nrule alfred-memory\nmcp serena\nmcp context7\nmcp memory\n', {
        env,
        each: (repo, i) => { const text = fs.readFileSync(rule(repo), 'utf8'); if (i === 1) fs.appendFileSync(rule(repo), '\na hand edit\n'); return text; },
    });
    const logged = (out) => out.split('\n').filter((l) => /rule \[library\]: /.test(l)).map((l) => l.replace(/^.*rule \[library\]: /, ''));
    // The bare spelling is BUILT, never typed: lint check 54 bans the literal under scripts/.
    const bareTool = (server, tool) => `mcp__${server}__${tool}`;
    assert.ok(steps[0].includes(bareTool('alfred-navigation', 'find_symbol')), 'the copy route registers serena bare, so the rule names it bare');
    assert.doesNotMatch(steps[0], /mcp__plugin_alfred-navigation_alfred-navigation__/);
    assert.deepStrictEqual(logged(outs[1]), [], 'an update that changes no rule logs none as rewritten');
    assert.strictEqual(steps[1], steps[0], 'and leaves the re-spelled rule as it was');
    assert.deepStrictEqual(logged(outs[2]), ['alfred-navigation'], 'a hand-edited rule is rewritten, and says so - alone');
    assert.match(outs[2], /overwriting a hand-edited copy: rule alfred-navigation/);
    assert.strictEqual(steps[2], steps[0], 'restored to the re-spelled text');
});

// M3 end to end: a project's own `typescript` skill (its own text, no stamp to record it) sits where the pick
// would copy, and its own `npm` skill beside it is no pick at all. The install neither overwrites nor prunes
// either, names the first once per run with the `!!` marker, and records neither as the stack's - so the re-run
// finds them unclaimed again. The same holds on the skills copy route, which copies without hashes.
const OURS = (n) => `---\nname: ${n}\ndescription: our team's ${n} notes\n---\nOurs, not the stack's.\n`;
for (const [label, env] of [['plugin route', {}], ['skills copy route', { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' }]])
{
    test(`M3 install + update (${label}): a same-named project skill is never overwritten, pruned or recorded`, POSIX_ONLY, () =>
    {
        const { steps, outs } = seedRun(['install', 'update'], 'skill typescript\nskill javascript\nrule alfred-docs-root\nmcp navigation\nmcp documentation\nmcp memory\n', {
            env, args: [[], ['--installed-only']],
            prepare: (repo) =>
            {
                for (const n of ['typescript', 'npm'])
                {
                    fs.mkdirSync(path.join(repo, '.claude', 'skills', n), { recursive: true });
                    fs.writeFileSync(path.join(repo, '.claude', 'skills', n, 'SKILL.md'), OURS(n));
                }
            },
            each: (repo) =>
            {
                const stamp = fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8');
                const line = (key) => ((new RegExp(`^${key}: (.*)$`, 'm').exec(stamp) || [])[1] || '');
                return {
                    typescript: fs.readFileSync(path.join(repo, '.claude', 'skills', 'typescript', 'SKILL.md'), 'utf8'),
                    npm: fs.readFileSync(path.join(repo, '.claude', 'skills', 'npm', 'SKILL.md'), 'utf8'),
                    javascript: fs.existsSync(path.join(repo, '.claude', 'skills', 'javascript', 'SKILL.md')),
                    recorded: `${line('picked-skills')},${line('library-skills')}`.split(',').map((e) => e.split(/[@=]/)[0]).filter((n) => n === 'typescript' || n === 'npm'),
                };
            },
        });
        for (const [i, step] of steps.entries())
        {
            assert.strictEqual(step.typescript, OURS('typescript'), `run ${i} overwrote the project's own typescript skill:\n${outs[i]}`);
            assert.strictEqual(step.npm, OURS('npm'), `run ${i} pruned or rewrote the project's own npm skill`);
            assert.ok(step.javascript, 'a pick with no folder in the way still copies');
            assert.deepStrictEqual(step.recorded, [], `run ${i}: the stamp records a skill the stack did not write`);
            assert.doesNotMatch(outs[i], /!! skill kept: npm/, 'a folder nobody picked is no warning');
        }
        // The pick is named once, where it was made; the update's read-back never takes the folder for a pick.
        assert.match(outs[0], /!! skill kept: typescript - .*rename or remove yours, then \/alfred-code:configure adds it/, outs[0]);
        // The plugin route prunes what was not picked, so it says why it leaves the folder; the copy route never
        // prunes a skill and has nothing to say.
        if (!env.ALFRED_CODE_SKILLS_VIA_PLUGIN) assert.match(outs[1], /skill kept \([^)]*the project's own[^)]*\): typescript/, outs[1]);
        assert.doesNotMatch(outs[1], /!! skill kept: typescript/, outs[1]);
    });
}

// F-LIBCHECK (matrix 2.1.6): on the FULL copy route the installed rules hold their MCP tool names
// re-spelled to the registered bare form, so a check hashing the raw source read every one as 'behind'.
// The check compares like with like now: the source is re-spelled the way the copy is before it is hashed.
test('library-check on the full copy route: a fresh install is clean, an edited copy is drift, a newer source is behind', POSIX_ONLY, () =>
{
    const sel = 'skill markdown-style\nrule alfred-navigation\nrule alfred-quality-gates\nrule alfred-memory\nmcp navigation\nmcp documentation\nmcp memory\n';
    const env = { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
    const { result } = seedRun('install', sel, {
        env,
        inspect: (repo) =>
        {
            const states = (source) => Object.fromEntries(check({ project: repo, source }).rows.map((r) => [`${r.kind} ${r.name}`, r.state]));
            const out = { fresh: states(ROOT) };
            // A really newer source: the same tree with one rule's text moved on.
            const newer = path.join(repo, '..', 'newer-src');
            fs.mkdirSync(path.join(newer, 'stack', 'rules'), { recursive: true });
            fs.cpSync(path.join(ROOT, 'stack', 'rules'), path.join(newer, 'stack', 'rules'), { recursive: true });
            fs.cpSync(path.join(ROOT, 'stack', 'skills'), path.join(newer, 'stack', 'skills'), { recursive: true });
            fs.appendFileSync(path.join(newer, 'stack', 'rules', 'alfred-memory.md'), '\n- a line a newer release added.\n');
            out.newer = states(newer);
            // A really edited copy.
            fs.appendFileSync(path.join(repo, '.claude', 'rules', 'alfred-navigation.md'), '\nedited here\n');
            out.edited = states(ROOT);
            return out;
        },
    });
    const bad = (m) => Object.entries(m).filter(([, s]) => s !== 'ok');
    assert.deepStrictEqual(bad(result.fresh), [], 'a fresh full-route install must read clean');
    assert.deepStrictEqual(bad(result.newer), [['rule alfred-memory', 'behind']]);
    assert.deepStrictEqual(bad(result.edited), [['rule alfred-navigation', 'drift']]);
});
