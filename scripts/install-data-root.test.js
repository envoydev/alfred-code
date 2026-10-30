'use strict';
// THE DATA ROOT, END TO END THROUGH THE SEED - ALFRED_CODE_DATA_PATH (default .alfred) holds the stack's own data: the
// docs, the state and the project's sensitive data. A fresh install lays them there; an update over a 2.0.0 layout moves
// the docs from .claude/docs unasked; a custom root (`--data-path` with `--data-move move`) carries the docs and the
// sensitive data there. No server ships since 2.10.1, so an older release's server data (.serena, .playwright/<engine>,
// .memory-mcp, or their folders under the root) is the user's: it stays where it is, no move is offered or owed for it,
// and a `data-pending:` line an earlier release recorded for its launcher goes. The docs root is always <data root>/docs
// (2.8.0): a leftover ALFRED_CODE_DOCS_PATH is drained unasked - the stack's docs move from the root it names, the
// project's own files there stay, the key goes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { valueHash } = require('./install/stamp.js');

const COPY_ENV = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' };
const SELECTION = 'rule alfred-docs-root\n';
const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const json = (file) => JSON.parse(read(file) || '{}');
const put = (file, text = 'x') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const ignored = (repo, rel) => { try { execFileSync('git', ['check-ignore', '-q', rel], { cwd: repo, stdio: 'ignore' }); return true; } catch { return false; } };
// A snapshot of the tree, taken before the sandbox is removed: every file outside .git with its text.
function snapshot(repo)
{
    const files = new Map();
    const walk = (dir, rel) =>
    {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        {
            if (e.name === '.git' && !rel) continue;
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) { files.set(`${r}/`, null); walk(path.join(dir, e.name), r); }
            else files.set(r, read(path.join(dir, e.name)));
        }
    };
    walk(repo, '');
    return files;
}
const look = (repo) =>
{
    const files = snapshot(repo);
    return {
        env: json(path.join(repo, '.claude', 'settings.json')).env || {},
        local: json(path.join(repo, '.claude', 'settings.local.json')).env || {},
        stamp: read(path.join(repo, '.claude', 'alfred-code.stamp')) || '',
        rule: (/This install's root: `([^`]*)`/.exec(read(path.join(repo, '.claude', 'rules', 'alfred-docs-root.md')) || '') || [])[1],
        ignore: read(path.join(repo, '.alfred', '.gitignore')),
        has: (rel) => files.has(rel) || files.has(`${rel}/`),
        text: (rel) => files.get(rel) ?? null,
        repo,
    };
};
const pendingOf = (stamp) => stamp.split('\n').filter((l) => l.startsWith('data-pending: ')).sort();
const addStampLines = (repo, lines) =>
{
    const stampFile = path.join(repo, '.claude', 'alfred-code.stamp');
    fs.writeFileSync(stampFile, `${read(stampFile).replace(/\n*$/, '')}\n${lines.join('\n')}\n`);
};

// A 2.0.0 install's data, laid over what the current seed just installed: the docs at the old default with the stack's
// own ledger entry for it, no DATA_PATH key, and every server's folder at its 2.0.0 place.
function twoZeroLayout(repo)
{
    const claude = path.join(repo, '.claude');
    const settings = json(path.join(claude, 'settings.json'));
    delete settings.env.ALFRED_CODE_DATA_PATH;
    settings.env.ALFRED_CODE_DOCS_PATH = '.claude/docs';
    // Before 3.0.0 the stack's variables sat in settings.json, ledgered there (workspace roles and variables, D5).
    Object.assign(settings.env, (require('../stack/hooks/layout.js').readDotenv(path.join(repo, '.alfred', '.variables')) || {}).values || {});
    fs.writeFileSync(path.join(claude, 'settings.json'), JSON.stringify(settings, null, 2));
    const stampFile = path.join(claude, 'alfred-code.stamp');
    const stamp = read(stampFile)
        .replace(/settings\.json:ALFRED_CODE_DOCS_PATH=[0-9a-f]{64}/, `settings.json:ALFRED_CODE_DOCS_PATH=${valueHash('.claude/docs')}`)
        .replace(/(^|,)\.variables:/gm, '$1settings.json:')
        .split('\n').filter((l) => !/^data-/.test(l)).join('\n');
    fs.writeFileSync(stampFile, stamp);
    fs.rmSync(path.join(repo, '.alfred'), { recursive: true, force: true });
    put(path.join(repo, '.claude', 'docs', 'architecture', 'ARCHITECTURE.md'), '# arch\n');
    put(path.join(repo, '.serena', 'project.yml'), 'project_name: repo\nlanguage_servers: ["typescript"]\n');
    put(path.join(repo, '.serena', '.gitignore'), '*\n');
    put(path.join(repo, '.playwright', 'chrome', 'Default', 'Cookies'), 'session');
    put(path.join(repo, '.playwright', '.gitignore'), '*\n');
    put(path.join(repo, '.memory-mcp', 'memory.db'), 'PROJ');
    put(path.join(repo, '.memory-mcp', '.gitignore'), '*\n');
    return null;
}
const SERVER_DATA_2_0 = ['.serena/project.yml', '.playwright/chrome/Default/Cookies', '.memory-mcp/memory.db'];
const SERVER_DATA_IN_ROOT = ['serena', 'chrome-control', 'browser', '.alfred-memory'];
const UPDATE = ['--scope', 'project', '--installed-only'];

test('fresh install: the docs, the state and the sensitive data land under .alfred, git keeps the machine state out but the docs in, and no server folder is made', POSIX_ONLY, () =>
{
    const { result: r, out } = seedRun('install', SELECTION, {
        args: ['--scope', 'project'],
        inspect: (repo) => ({ ...look(repo), self: ignored(repo, '.alfred/.gitignore'), state: ignored(repo, '.alfred/state/x.json'), docs: ignored(repo, '.alfred/docs/architecture/ARCHITECTURE.md') }),
    });
    assert.strictEqual(r.env.ALFRED_CODE_DATA_PATH, '.alfred', out);
    assert.strictEqual(r.env.ALFRED_CODE_DOCS_PATH, undefined, 'no run writes the retired key');
    assert.strictEqual(r.local.ALFRED_CODE_MEMORY_DB, undefined, 'no memory database is named - no server ships');
    assert.strictEqual(r.rule, '.alfred/docs');
    assert.match(r.ignore, /^\/\*$/m);
    assert.match(r.ignore, /^!\/docs\/$/m, 'the docs stay visible to git, or the versioning seed reads them as kept out');
    // I1: the root's .gitignore re-includes itself - with `/*` alone it ignored its own file, so it never reached a clone.
    assert.deepStrictEqual([r.self, r.state, r.docs], [false, true, false], r.ignore);
    assert.match(r.text('.alfred/.secrets'), /^# alfred-code: this project's sensitive data/);
    assert.match(r.stamp, /^data-root: \.alfred$/m);
    assert.deepStrictEqual(pendingOf(r.stamp), []);
    for (const made of [...SERVER_DATA_IN_ROOT.map((n) => `.alfred/${n}`), '.serena', '.playwright', '.memory-mcp', '.claude/docs'])
        assert.ok(!r.has(made), `${made} was created`);
});

for (const [label, answer] of [['no answer', []], ['--data-move move', ['--data-move', 'move']]])
{
    test(`update over a 2.0.0 layout, ${label}: the docs move, the servers' data stays where it is with no move offered or owed, and a re-run is quiet`, POSIX_ONLY, () =>
    {
        const { result: r, outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
            args: [['--scope', 'project'], [...UPDATE, ...answer], UPDATE],
            each: (repo, i) => (i === 0 ? twoZeroLayout(repo) : { pending: pendingOf(look(repo).stamp), settings: read(path.join(repo, '.claude', 'settings.json')) }),
            inspect: look,
        });
        assert.match(outs[1], /docs root: moved \.claude\/docs -> \.alfred\/docs/, outs[1]);
        assert.strictEqual(r.env.ALFRED_CODE_DOCS_PATH, undefined, 'the retired key goes once the docs moved');
        assert.strictEqual(r.env.ALFRED_CODE_DATA_PATH, '.alfred');
        assert.strictEqual(r.rule, '.alfred/docs');
        assert.ok(r.has('.alfred/docs/awareness/ARCHITECTURE-AWARENESS.md') && !r.has('.claude/docs'));
        for (const rel of SERVER_DATA_2_0) assert.ok(r.has(rel), `${rel} was moved or removed:\n${outs[1]}`);
        for (const n of SERVER_DATA_IN_ROOT) assert.ok(!r.has(`.alfred/${n}`), `.alfred/${n} was created`);
        assert.deepStrictEqual(pendingOf(r.stamp), []);
        for (const i of [1, 2]) assert.doesNotMatch(outs[i], /offers the move|next start|not moved yet|still holds data/, outs[i]);
        assert.deepStrictEqual(steps[2], steps[1], 'a re-run changed settings.json or the pending lines');
        assert.doesNotMatch(outs[2], /docs root: moved/);
    });
}

// An earlier release recorded each server-data move it owed a launcher (`data-pending: serena .serena -> .alfred/serena`).
// No launcher ships since 2.10.1, so the next update drops the lines and leaves the data where it is.
test('update: a server-data pending line an earlier release recorded goes, and its data stays where it is', POSIX_ONLY, () =>
{
    const { result: r, outs } = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], UPDATE],
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            put(path.join(repo, '.serena', 'project.yml'), 'project_name: repo\n');
            put(path.join(repo, '.playwright', 'chrome', 'Cookies'), 'c');
            addStampLines(repo, [
                'data-pending: serena .serena -> .alfred/serena',
                'data-pending: chrome-control .playwright/chrome -> .alfred/chrome-control',
                'data-pending: memory .memory-mcp -> .alfred/.alfred-memory',
            ]);
            return null;
        },
        inspect: look,
    });
    assert.deepStrictEqual(pendingOf(r.stamp), [], outs[1]);
    assert.ok(r.has('.serena/project.yml') && r.has('.playwright/chrome/Cookies'), outs[1]);
    assert.ok(!r.has('.alfred/serena') && !r.has('.alfred/chrome-control') && !r.has('.alfred/.alfred-memory'));
    assert.doesNotMatch(outs[1], /not moved yet|next start|restart/i, outs[1]);
});

test('update --data-move keep: the docs still move to the data root, the answer is stamped, and no later update offers a move', POSIX_ONLY, () =>
{
    const { result: r, outs } = seedRun(['install', 'update', 'update'], SELECTION, {
        args: [['--scope', 'project'], [...UPDATE, '--data-move', 'keep'], UPDATE],
        each: (repo, i) => (i === 0 ? twoZeroLayout(repo) : null), inspect: look,
    });
    assert.match(r.stamp, /^data-move: kept$/m);
    assert.strictEqual(r.env.ALFRED_CODE_DOCS_PATH, undefined);
    assert.ok(r.has('.serena/project.yml') && r.has('.alfred/docs/awareness/ARCHITECTURE-AWARENESS.md') && !r.has('.claude/docs'));
    assert.doesNotMatch(outs[2], /offers the move/, outs[2]);
});

// 2.1.0-2.3.x kept the browser profiles at <root>/browser/<engine>, and 2.4.0-2.10.0 at <root>/<engine>-control. No engine
// ships since 2.10.1: an update over either moves nothing and owes nothing, and the root's .gitignore still keeps the
// profiles - session cookies - out of git.
test('update over an older release\'s browser profiles under the root: nothing moves, nothing is owed, and git still keeps them out', POSIX_ONLY, () =>
{
    const PROFILES = ['.alfred/browser/chrome/Default/Cookies', '.alfred/firefox-control/Default/Cookies'];
    const { result: r, outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
        args: [['--scope', 'project'], UPDATE, UPDATE],
        each: (repo, i) =>
        {
            if (i === 0) for (const rel of PROFILES) put(path.join(repo, rel), `session ${rel}`);
            return pendingOf(look(repo).stamp);
        },
        inspect: (repo) => ({ ...look(repo), ignored: PROFILES.map((rel) => ignored(repo, rel)) }),
    });
    for (const rel of PROFILES) assert.strictEqual(r.text(rel), `session ${rel}`, outs[1]);
    assert.ok(!r.has('.alfred/chrome-control'), 'the shared folder was relaid out');
    assert.deepStrictEqual(r.ignored, [true, true], 'a profile reached git');
    for (const i of [1, 2]) assert.doesNotMatch(outs[i], /data root: moved|next start|offers the move/, outs[i]);
    assert.deepStrictEqual([steps[1], steps[2]], [[], []]);
});

// A custom root: --data-path with --data-move move carries the stack's own data - the docs and the sensitive data - and
// re-points the docs rule. An older release's server folders under the old root are the user's: they stay, and so do the
// old root and its .gitignore, which still keeps them out of git. A root holding only the stack's data is removed once
// the move empties it. A re-run changes nothing.
test('a custom root: --data-path moves the docs and the sensitive data, leaves a server\'s folder and the ignore beside it, and a re-run changes nothing', POSIX_ONLY, () =>
{
    const { result: r, outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
        args: [['--scope', 'project'], [...UPDATE, '--data-path', '.data', '--data-move', 'move'], UPDATE],
        each: (repo, i) =>
        {
            if (i === 0)
            {
                put(path.join(repo, '.alfred', 'docs', 'architecture', 'ARCHITECTURE.md'), '# a\n');
                put(path.join(repo, '.alfred', 'chrome-control', 'Cookies'), 'c');
                put(path.join(repo, '.alfred', 'serena', 'project.yml'), 'p');
            }
            return { settings: read(path.join(repo, '.claude', 'settings.json')), pending: pendingOf(look(repo).stamp) };
        },
        inspect: (repo) => ({ ...look(repo), cookies: ignored(repo, '.alfred/chrome-control/Cookies') }),
    });
    assert.strictEqual(r.env.ALFRED_CODE_DATA_PATH, '.data', outs[1]);
    assert.strictEqual(r.env.ALFRED_CODE_DOCS_PATH, undefined);
    assert.strictEqual(r.rule, '.data/docs');
    assert.ok(r.has('.data/docs/awareness/ARCHITECTURE-AWARENESS.md') && !r.has('.alfred/docs'), outs[1]);
    assert.ok(r.has('.data/.secrets') && !r.has('.alfred/.secrets'), 'the sensitive data moved with the root');
    assert.strictEqual(r.text('.alfred/chrome-control/Cookies'), 'c', 'a server\'s folder was moved');
    assert.ok(r.has('.alfred/serena/project.yml') && !r.has('.data/serena') && !r.has('.data/chrome-control'));
    assert.strictEqual(r.cookies, true, 'the old root\'s .gitignore went, and the cookies with it into git');
    // One .gitignore for the new root: it carries the docs rules, and the docs root has none of its own.
    assert.match(r.text('.data/.gitignore'), /^# alfred-code: the data root[^\n]*\n\/\*\n!\/\.gitignore\n!\/\.variables\n!\/docs\/\n(?:[^\n]*\n)*\/docs\/flow\/\n/);
    assert.ok(!r.has('.data/docs/.gitignore'), 'the docs root keeps no .gitignore of its own under the data root');
    assert.deepStrictEqual(steps[2], steps[1], 'a re-run rewrote settings.json or the pending lines');

    const empty = seedRun(['install', 'update'], SELECTION, { args: [['--scope', 'project'], [...UPDATE, '--data-path', '.data', '--data-move', 'move']], inspect: look });
    assert.ok(!empty.result.has('.alfred'), `the emptied old root is gone:\n${empty.outs[1]}`);
    assert.ok(empty.result.has('.data/.secrets'));
});

test('--data-path over existing data with no --data-move changes nothing and says what would', POSIX_ONLY, () =>
{
    const { result: r, outs } = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], [...UPDATE, '--data-path', '.data']],
        each: (repo, i) => (i === 0 ? put(path.join(repo, '.alfred', 'docs', 'x.md'), 'x') : null), inspect: look,
    });
    assert.match(outs[1], /--data-path \.data not applied - .* --data-move move/, outs[1]);
    assert.strictEqual(r.env.ALFRED_CODE_DATA_PATH, '.alfred');
    assert.ok(r.has('.alfred/docs/x.md') && !r.has('.data'));
});

test('a docs root the user set, moved on the answer to update\'s ask: the stack\'s docs go to <data root>/docs, the project\'s own files stay, the key goes', POSIX_ONLY, () =>
{
    const { result: r, outs } = seedRun(['install', 'update'], SELECTION, {
        env: COPY_ENV, args: [['--scope', 'project'], [...UPDATE, '--data-move', 'move', '--docs-root-move', 'move']],
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            twoZeroLayout(repo);
            const file = path.join(repo, '.claude', 'settings.json');
            const s = json(file);
            s.env.ALFRED_CODE_DOCS_PATH = 'docs';
            fs.writeFileSync(file, JSON.stringify(s, null, 2));
            put(path.join(repo, 'docs', 'architecture', 'ARCHITECTURE.md'), '# mine\n');
            put(path.join(repo, 'docs', 'README.md'), '# the project\'s own\n');
            return null;
        },
        inspect: look,
    });
    assert.match(outs[1], /docs root: moved docs -> \.alfred\/docs/, outs[1]);
    assert.match(outs[1], /docs root: docs keeps README\.md - not the stack's, left in place/, outs[1]);
    assert.strictEqual(r.env.ALFRED_CODE_DOCS_PATH, undefined);
    assert.strictEqual(r.rule, '.alfred/docs');
    assert.strictEqual(r.text('.alfred/docs/awareness/ARCHITECTURE-AWARENESS.md'), '# mine\n', 'moved, then on to the awareness home');
    assert.ok(r.has('docs/README.md') && !r.has('docs/architecture'), 'the project\'s own file stays, the stack\'s left');
    assert.ok(r.has('.serena/project.yml') && !r.has('.alfred/serena'), 'a server\'s data was moved');
    assert.match(r.ignore, /^!\/docs\/$/m, 'the docs live under the root now');
});

// Final review M8: the language-server check sat inside the docs block, which a hand-set docs root still waiting on
// update's ask skips - so it ran on no run until the ask was answered. It writes into the data root and runs on every run.
test('a docs root still waiting on update\'s ask: the language-server check runs all the same', POSIX_ONLY, () =>
{
    const coverage = '.alfred/state/lsp-coverage.json';
    const { result: r, outs } = seedRun(['install', 'update'], SELECTION, {
        env: COPY_ENV, args: [['--scope', 'project'], UPDATE],
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            twoZeroLayout(repo);
            const file = path.join(repo, '.claude', 'settings.json');
            const s = json(file);
            s.env.ALFRED_CODE_DOCS_PATH = 'docs';
            fs.writeFileSync(file, JSON.stringify(s, null, 2));
            put(path.join(repo, 'docs', 'architecture', 'ARCHITECTURE.md'), '# mine\n');
            fs.rmSync(path.join(repo, ...coverage.split('/')), { force: true });
            return null;
        },
        inspect: look,
    });
    assert.match(outs[1], /docs root: docs was set by hand - nothing moved yet/, outs[1]);
    assert.ok(r.has(coverage), `the update wrote the check's result:\n${outs[1]}`);
});

// M11: the captures bake the LITERAL docs root into their generated pointer rules (the run book, the
// architecture docs, the code style), since a rule cannot resolve a setting at load. A data move that
// carries the docs elsewhere re-stamps each of them with the new root, as it re-stamps alfred-docs-root;
// a rule of the project's own is never touched, and a re-run changes nothing.
const OLD_ARCH_CMD = ['/capture', 'architecture'].join('-');
const POINTERS = {
    'alfred-project-awareness.md': (root) => `---\ndescription: Project run book pointer - generated by /capture-awareness; edit via a re-run.\n---\n\nRun book: \`${root}/project-capabilities/PROJECT-CAPABILITIES.md\` - read it before you build.\n`,
    'alfred-architecture.md': (root) => `---\ndescription: Project architecture docs pointer - generated by ${OLD_ARCH_CMD}; edit via a re-run.\n---\n\nArchitecture docs: \`${root}/architecture/\` - read them before a structural change.\n`,
    'project-code-style.md': (root) => `---\npaths:\n  - "**/*.ts"\n---\n# Project code style (generated)\n\nFull capture: \`${root}/code-style/CODE-STYLE.md\`.\n`,
};
// The skill rename's respell reaches a generated rule too: the old command in the description takes its part's form.
const afterUpdate = (name, text) => (name === 'alfred-architecture.md' ? text.replace(OLD_ARCH_CMD, '/capture-awareness architecture') : text);
const MINE = (root) => `# my rule\n\nOld notes sit in \`${root}/notes/\` - keep them there.\n`;
const writePointers = (repo, root) =>
{
    for (const [name, text] of Object.entries(POINTERS)) put(path.join(repo, '.claude', 'rules', name), text(root));
    put(path.join(repo, '.claude', 'rules', 'my-own-rule.md'), MINE(root));
};
const rulesOf = (repo) => Object.fromEntries([...Object.keys(POINTERS), 'my-own-rule.md'].map((n) => [n, read(path.join(repo, '.claude', 'rules', n))]));

test('M11 a data move re-stamps every generated rule that names the docs root - a custom root, and the 2.0.0 move', POSIX_ONLY, () =>
{
    const custom = seedRun(['install', 'update', 'update'], SELECTION, {
        args: [['--scope', 'project'], [...UPDATE, '--data-path', '.data', '--data-move', 'move'], UPDATE],
        each: (repo, i) =>
        {
            if (i === 0) { put(path.join(repo, '.alfred', 'docs', 'architecture', 'ARCHITECTURE.md'), '# a\n'); writePointers(repo, '.alfred/docs'); }
            return rulesOf(repo);
        },
        inspect: (repo) => ({ ...look(repo), rules: rulesOf(repo) }),
    });
    assert.strictEqual(custom.result.rule, '.data/docs', custom.outs[1]);
    for (const [name, text] of Object.entries(POINTERS))
        assert.strictEqual(custom.result.rules[name], afterUpdate(name, text('.data/docs')), `${name} still names the old root:\n${custom.outs[1]}`);
    assert.strictEqual(custom.result.rules['my-own-rule.md'], MINE('.alfred/docs'), 'a rule of the project\'s own is never rewritten');
    assert.match(custom.outs[1], /generated rule\(s\) re-stamped: .*\.alfred\/docs -> \.data\/docs/, custom.outs[1]);
    assert.deepStrictEqual(custom.steps[2], custom.steps[1], 'a re-run rewrote a rule');
    assert.doesNotMatch(custom.outs[2], /re-stamped/);

    const twoZero = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], [...UPDATE, '--data-move', 'move']],
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            twoZeroLayout(repo);
            const rule = path.join(repo, '.claude', 'rules', 'alfred-docs-root.md');
            fs.writeFileSync(rule, read(rule).split('.alfred/docs').join('.claude/docs'));   // as 2.0.0 stamped it
            writePointers(repo, '.claude/docs');
            return null;
        },
        inspect: (repo) => ({ ...look(repo), rules: rulesOf(repo) }),
    });
    assert.strictEqual(twoZero.result.rule, '.alfred/docs', twoZero.outs[1]);
    for (const [name, text] of Object.entries(POINTERS))
        assert.strictEqual(twoZero.result.rules[name], afterUpdate(name, text('.alfred/docs')), `${name} still names .claude/docs:\n${twoZero.outs[1]}`);
    assert.strictEqual(twoZero.result.rules['my-own-rule.md'], MINE('.claude/docs'));
});

// The orientation doc's pre-folder home, loose at the docs root (a 0.2.x capture, carried to .alfred/docs/ by the
// data move): an update moves it on to awareness/ (through related-projects/, in the same run) and re-points the generated
// rule that names it to that last home.
test('an update moves the loose orientation doc into awareness/ and re-points its rule; a re-run is quiet', POSIX_ONLY, () =>
{
    const RULE = (p) => `---\ndescription: generated\n---\n\nThe evidence lives in the committed \`${p}\`.\n`;
    const files = (repo) => ({
        loose: read(path.join(repo, '.alfred', 'docs', 'PROJECT-RELATED-CONTEXT.md')),
        doc: read(path.join(repo, '.alfred', 'docs', 'awareness', 'RELATED-PROJECTS-AWARENESS.md')),
        watch: read(path.join(repo, '.alfred', 'docs', 'awareness', 'watch.json')),
        passing: fs.existsSync(path.join(repo, '.alfred', 'docs', 'related-projects')),
        rule: read(path.join(repo, '.claude', 'rules', 'alfred-related-context.md')),
    });
    const r = seedRun(['install', 'update', 'update'], SELECTION, {
        args: [['--scope', 'project'], UPDATE, UPDATE],
        each: (repo, i) =>
        {
            if (i === 0)
            {
                put(path.join(repo, '.alfred', 'docs', 'PROJECT-RELATED-CONTEXT.md'), '# Related projects\n');
                put(path.join(repo, '.claude', 'rules', 'alfred-related-context.md'), RULE('.alfred/docs/PROJECT-RELATED-CONTEXT.md'));
            }
            return files(repo);
        },
    });
    assert.deepStrictEqual(r.steps[1], { loose: null, doc: '# Related projects\n', watch: '{\n  "notOwned": [\n    "AGENTS-AWARENESS.md"\n  ]\n}\n', passing: false,
        rule: RULE('.alfred/docs/awareness/RELATED-PROJECTS-AWARENESS.md') }, r.outs[1]);
    assert.match(r.outs[1], /docs migration: \.claude\/rules\/alfred-related-context\.md - 1 path\(s\) re-pointed/);
    assert.deepStrictEqual(r.steps[2], r.steps[1], 'a re-run changed something');
    assert.doesNotMatch(r.outs[2], /docs migration/);
});

// The project's sensitive data (<root>/.secrets, `.sensitive-data` before item 3 - the user's ruling of 2026-10-13) is the user's file, not a server's:
// a root change takes it along inline on EVERY route - no launcher owes it a move - into a root whose .gitignore is
// written first, and every install denies the Read tool on it.
test('sensitive data: a root change moves the store inline on the plugin and the copy route; a re-run is quiet; the Read deny is written', POSIX_ONLY, () =>
{
    for (const [route, env] of [['plugin', {}], ['copy', COPY_ENV]])
    {
        const { result: r, outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
            env, args: [['--scope', 'project'], [...UPDATE, '--data-path', '.data', '--data-move', 'move'], UPDATE],
            each: (repo, i) =>
            {
                if (i === 0) put(path.join(repo, '.alfred', '.secrets'), 'API_TOKEN=tok-abcdef123456\n');
                return { settings: read(path.join(repo, '.claude', 'settings.json')), stamp: pendingOf(read(path.join(repo, '.claude', 'alfred-code.stamp')) || '') };
            },
            inspect: (repo) => ({ ...look(repo), deny: (json(path.join(repo, '.claude', 'settings.json')).permissions || {}).deny || [] }),
        });
        assert.strictEqual(r.env.ALFRED_CODE_DATA_PATH, '.data', `${route}:\n${outs[1]}`);
        assert.strictEqual(r.text('.data/.secrets'), 'API_TOKEN=tok-abcdef123456\n', `${route}: moved as it was`);
        assert.ok(!r.has('.alfred/.secrets'), route);
        assert.match(outs[1], /data root: moved \.alfred\/\.secrets -> \.data\/\.secrets/, route);
        assert.ok(!/data-pending: sensitive/.test(r.stamp), `${route}: no launcher owes it a move`);
        assert.ok(r.deny.includes('Read(.secrets)') && r.deny.includes('Read(.sensitive-data)'), `${route}: ${JSON.stringify(r.deny)}`);
        assert.ok(!outs.join('\n').includes('tok-abcdef123456'), `${route}: a value was printed`);
        assert.deepStrictEqual(steps[2], steps[1], `${route}: a re-run changed settings.json or the pending lines`);
    }
});

test('sensitive data: a store alone holds the root - --data-path without --data-move changes nothing; a store at both places is a clash', POSIX_ONLY, () =>
{
    const alone = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], [...UPDATE, '--data-path', '.data']],
        each: (repo, i) =>
        {
            if (i !== 0) return;
            const root = path.join(repo, '.alfred');
            for (const name of fs.readdirSync(root)) if (name !== '.gitignore') fs.rmSync(path.join(root, name), { recursive: true, force: true });
            put(path.join(root, '.sensitive-data'), 'K=v1234\n');
        },
        inspect: look,
    });
    assert.match(alone.outs[1], /--data-path \.data not applied - \.alfred holds this project's data/, alone.outs[1]);
    assert.strictEqual(alone.result.text('.alfred/.sensitive-data'), 'K=v1234\n');
    const both = seedRun(['install', 'update'], SELECTION, {
        env: COPY_ENV, args: [['--scope', 'project'], [...UPDATE, '--data-path', '.data', '--data-move', 'move']],
        each: (repo, i) => { if (i === 0) { put(path.join(repo, '.alfred', '.secrets'), 'K=old\n'); put(path.join(repo, '.data', '.sensitive-data'), 'K=new\n'); } },
        inspect: look,
    });
    assert.match(both.outs[1], /data root: \.alfred\/\.secrets not moved - \.data\/\.sensitive-data already holds data/, both.outs[1]);
    assert.strictEqual(both.result.text('.alfred/.secrets'), 'K=old\n');
    assert.strictEqual(both.result.text('.data/.sensitive-data'), 'K=new\n', 'neither side touched - a store under either name is a clash');
    assert.ok(!both.result.has('.data/.secrets'));
});

// The run book's credentials file from before 2026-10-13 moves into the store on any run, both routes - keys named,
// values never printed - and the run book names the store; a re-run says nothing; a clash is said and moves nothing.
test('old credentials: an update moves credentials.local.env into the store and re-points the run book; a re-run is quiet', POSIX_ONLY, () =>
{
    const CAP = (repo) => path.join(repo, '.alfred', 'docs', 'project-capabilities');
    const old = (repo) =>
    {
        put(path.join(CAP(repo), 'credentials.local.env'), 'ADMIN_EMAIL=me@x.io\nADMIN_PASSWORD=pa55-w0rd-xyz\n');
        put(path.join(CAP(repo), '.gitignore'), 'credentials.local.env\n');
        put(path.join(CAP(repo), 'PROJECT-CAPABILITIES.md'), '- Credentials live in: `.alfred/docs/project-capabilities/credentials.local.env`, key `ADMIN_PASSWORD`\n');
    };
    for (const [route, env] of [['plugin', {}], ['copy', COPY_ENV]])
    {
        const { steps, outs } = seedRun(['install', 'update', 'update'], SELECTION, {
            env, args: [['--scope', 'project'], UPDATE, UPDATE],
            each: (repo, i) =>
            {
                if (i === 0) old(repo);
                // the update also moves the run book to awareness/, and the credentials line is re-pointed there
                return { store: read(path.join(repo, '.alfred', '.secrets')), cred: fs.existsSync(path.join(CAP(repo), 'credentials.local.env')),
                    book: read(path.join(repo, '.alfred', 'docs', 'awareness', 'RUN-AND-DEBUG-AWARENESS.md')), oldBook: fs.existsSync(path.join(CAP(repo), 'PROJECT-CAPABILITIES.md')) };
            },
        });
        // The install itself already moves a file present before it ran; here the file lands after it, so the first update moves it.
        assert.ok(steps[0].cred, route);
        assert.match(outs[1], /sensitive data: \.alfred\/docs\/project-capabilities\/credentials\.local\.env -> \.alfred\/\.secrets \(ADMIN_EMAIL, ADMIN_PASSWORD added\); the run book names it now/, `${route}:\n${outs[1]}`);
        assert.match(steps[1].store, /^ADMIN_PASSWORD=pa55-w0rd-xyz$/m, route);
        assert.ok(!steps[1].cred, route);
        assert.strictEqual(steps[1].book, '- Credentials live in: `.alfred/.secrets`, key `ADMIN_PASSWORD`\n', route);
        assert.ok(!steps[1].oldBook, `${route}: the run book left project-capabilities/`);
        assert.match(outs[1], /docs migration \(project awareness\): PROJECT-CAPABILITIES\.md -> /, `${route}:\n${outs[1]}`);
        assert.ok(!outs.join('\n').includes('pa55-w0rd-xyz') && !outs.join('\n').includes('me@x.io'), `${route}: a value was printed`);
        assert.doesNotMatch(outs[2], /sensitive data:/, `${route}: the re-run says nothing`);
        assert.deepStrictEqual(steps[2], steps[1], route);
    }
    const clash = seedRun(['install', 'update', 'update'], SELECTION, {
        env: COPY_ENV, args: [['--scope', 'project'], UPDATE, UPDATE],
        each: (repo, i) => { if (i === 0) { old(repo); put(path.join(repo, '.alfred', '.secrets'), 'ADMIN_PASSWORD=another\n'); } return read(path.join(repo, '.alfred', '.secrets')); },
    });
    for (const i of [1, 2]) assert.match(clash.outs[i], /!! sensitive data: \.alfred\/docs\/project-capabilities\/credentials\.local\.env not moved - \.alfred\/\.secrets holds ADMIN_PASSWORD with another value/, clash.outs[i]);
    assert.strictEqual(clash.steps[2], 'ADMIN_PASSWORD=another\n');
});

// Found by the temp-project matrix: a docs root only settings.local.json names is the one a session (and so the capture)
// writes the run book under, while this run's docs root was settings.json's at project scope (R98). Since 2.8.0 that root
// is a hand-set one, kept until update's ask is answered, so the run book is adopted from where it is.
test('old credentials: a run book under a docs root only settings.local.json names is moved too', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'update'], SELECTION, {
        env: COPY_ENV, args: [['--scope', 'project'], UPDATE],
        each: (repo, i) =>
        {
            if (i === 0)
            {
                put(path.join(repo, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'handbook' } }));
                put(path.join(repo, 'handbook', 'project-capabilities', 'credentials.local.env'), 'ADMIN_PASSWORD=pa55-w0rd-xyz\n');
            }
            return read(path.join(repo, '.alfred', '.secrets'));
        },
    });
    assert.match(outs[1], /!! docs root: handbook was set by hand - nothing moved/, outs[1]);
    assert.match(outs[1], /sensitive data: handbook\/project-capabilities\/credentials\.local\.env -> \.alfred\/\.secrets \(ADMIN_PASSWORD added\)/, outs[1]);
    assert.match(steps[1] || '', /^ADMIN_PASSWORD=pa55-w0rd-xyz$/m);
});

// Item 3, the phased rename. A 2.10.1 install laid over what this tree's install wrote: the store under its old name, no
// `secrets:` line.
const oldSecrets = (repo, text = 'K=v\n') =>
{
    fs.rmSync(path.join(repo, '.alfred', '.secrets'), { force: true });
    put(path.join(repo, '.alfred', '.sensitive-data'), text);
    const stampFile = path.join(repo, '.claude', 'alfred-code.stamp');
    fs.writeFileSync(stampFile, read(stampFile).replace(/^secrets: .*\n/m, ''));
};
const setStamper = (repo, by) =>
{
    const stampFile = path.join(repo, '.claude', 'alfred-code.stamp');
    fs.writeFileSync(stampFile, read(stampFile).replace(/^secrets: .*$/m, `secrets: dual ${by}`));
};
const denyRows = (repo) => (json(path.join(repo, '.claude', 'settings.json')).permissions || {}).deny || [];
const NO_SESSION = { CLAUDE_CODE_SESSION_ID: '' };   // the suite may run inside a session: each run here is its own
// M9: on the plugin route the dual line waits for the core read back at this release, so the listing carries it.
const RELEASE = json(path.join(__dirname, '..', 'setup-plugin', '.claude-plugin', 'plugin.json')).version;
const coreAt = (version) => JSON.stringify([{ id: 'alfred-code@envoydev', scope: 'user', enabled: true, ...(version ? { version } : {}) }]);
const CORE_HERE = coreAt(RELEASE);

test('the rename waits one update: dual first, renamed second, nothing third (item 3, Review Focus 2)', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update', 'update'], SELECTION, {
        env: NO_SESSION,
        plugins: CORE_HERE,
        args: [['--scope', 'project'], UPDATE, UPDATE, UPDATE],
        each: (repo, i) => { if (i === 0) oldSecrets(repo); const l = look(repo); return { stamp: l.stamp, oldText: l.text('.alfred/.sensitive-data'), newText: l.text('.alfred/.secrets'), deny: denyRows(repo) }; },
        inspect: look,
    });
    assert.match(steps[1].stamp, /^secrets: dual run-\d+$/m);
    assert.deepStrictEqual([steps[1].oldText, steps[1].newText], ['K=v\n', null], 'phase 1 renames nothing and writes no .secrets');
    assert.match(outs[1], /\.sensitive-data becomes \.secrets at the next update/);
    assert.deepStrictEqual([steps[2].oldText, steps[2].newText], [null, 'K=v\n']);
    assert.match(outs[2], /renamed \.sensitive-data -> \.secrets - restart any session opened before this update/);
    assert.deepStrictEqual(steps[2].deny.filter((d) => /secrets|sensitive-data/.test(d)).sort(), ['Read(.secrets)', 'Read(.sensitive-data)']);
    assert.doesNotMatch(outs[3], /renamed|becomes \.secrets/);
    const strip = (s) => s.replace(/^installed(?:-ms)?: .*$/gm, '');
    assert.strictEqual(strip(steps[3].stamp), strip(steps[2].stamp));
    assert.strictEqual(/^secrets: .*$/m.exec(steps[3].stamp)[0], /^secrets: .*$/m.exec(steps[1].stamp)[0], 'the stamper is kept as first written');
});

test('a second run in the session that wrote the dual stamp renames nothing; another session renames (item 3)', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update', 'update'], SELECTION, {
        env: { CLAUDE_CODE_SESSION_ID: 'S1' },
        plugins: CORE_HERE,
        args: [['--scope', 'project'], UPDATE, UPDATE, UPDATE],
        each: (repo, i) => { if (i === 0) oldSecrets(repo); if (i === 2) setStamper(repo, 'S0'); return { has: look(repo).has }; },
        inspect: look,
    });
    assert.ok(steps[1].has('.alfred/.sensitive-data') && !steps[1].has('.alfred/.secrets'));
    assert.ok(steps[2].has('.alfred/.sensitive-data') && !steps[2].has('.alfred/.secrets'), 'S1 wrote the stamp: its own second run waits');
    assert.doesNotMatch(outs[2], /renamed/);
    assert.ok(steps[3].has('.alfred/.secrets') && !steps[3].has('.alfred/.sensitive-data'), 'a stamp of S0 read by S1 renames');
});

test('a root change moves the store under the name it has; after the dual stamp it is renamed at the prior root first (item 3)', POSIX_ONLY, () =>
{
    const { steps } = seedRun(['install', 'update', 'update'], SELECTION, {
        env: NO_SESSION,
        plugins: CORE_HERE,
        args: [['--scope', 'project'], [...UPDATE, '--data-path', '.data', '--data-move', 'move'], [...UPDATE, '--data-path', '.store', '--data-move', 'move']],
        each: (repo, i) => { if (i === 0) oldSecrets(repo, 'K=v\n'); return { has: look(repo).has }; },
        inspect: look,
    });
    assert.ok(steps[1].has('.data/.sensitive-data') && !steps[1].has('.data/.secrets') && !steps[1].has('.alfred/.sensitive-data'));
    assert.ok(steps[2].has('.store/.secrets') && !steps[2].has('.data/.sensitive-data') && !steps[2].has('.data/.secrets'));
});

// M9 (final review): a first dual line on the plugin route needs the core read back at this release or later - an update
// that left the core behind (a managed row, a failed update, no CLI) must not let the next run rename under an old guard.
test('M9: the dual stamp waits until the core plugin reads back at this release, then the rename runs as before', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update', 'update'], SELECTION, {
        env: NO_SESSION,
        plugins: coreAt('2.10.0'),
        args: [['--scope', 'project'], UPDATE, UPDATE, UPDATE],
        each: (repo, i) =>
        {
            if (i === 0) oldSecrets(repo);
            const l = look(repo);
            if (i === 1) fs.writeFileSync(path.join(path.dirname(repo), 'plugins.json'), CORE_HERE);
            return { stamp: l.stamp, has: l.has };
        },
        inspect: look,
    });
    assert.doesNotMatch(steps[1].stamp, /^secrets:/m, 'a core at 2.10.0 records no dual line');
    assert.ok(steps[1].has('.alfred/.sensitive-data') && !steps[1].has('.alfred/.secrets'));
    assert.match(outs[1], /sensitive: \.sensitive-data stays - the core plugin reads back at 2\.10\.0, not [\d.]+ or later; the rename waits for an update that finds it there/, outs[1]);
    assert.doesNotMatch(outs[1], /becomes \.secrets at the next update/);
    assert.match(steps[2].stamp, /^secrets: dual run-\d+$/m, 'the core at this release records it');
    assert.ok(steps[2].has('.alfred/.sensitive-data') && !steps[2].has('.alfred/.secrets'), 'and still renames nothing that run');
    assert.match(outs[2], /\.sensitive-data becomes \.secrets at the next update/);
    assert.ok(steps[3].has('.alfred/.secrets') && !steps[3].has('.alfred/.sensitive-data'));
});

test('M9: no core row, or one with no version, records no dual line; the copy route needs no read-back', POSIX_ONLY, () =>
{
    for (const [label, plugins] of [['no core row', '[]'], ['no version', coreAt('')]])
    {
        const { outs, result } = seedRun(['install', 'update'], SELECTION, {
            env: NO_SESSION, plugins,
            args: [['--scope', 'project'], UPDATE],
            each: (repo, i) => { if (i === 0) oldSecrets(repo); return null; },
            inspect: look,
        });
        assert.doesNotMatch(result.stamp, /^secrets:/m, label);
        assert.match(outs[1], /\.sensitive-data stays - the core plugin reads back at (nothing|\?), not/, `${label}: ${outs[1]}`);
    }
    const copy = seedRun(['install', 'update'], SELECTION, {
        env: { ...COPY_ENV, ...NO_SESSION },
        args: [['--scope', 'project'], UPDATE],
        each: (repo, i) => { if (i === 0) oldSecrets(repo); return null; },
        inspect: look,
    });
    assert.match(copy.result.stamp, /^secrets: dual run-\d+$/m, 'hooks copied from this snapshot are this release');
    assert.match(copy.outs[1], /\.sensitive-data becomes \.secrets at the next update/);
});

test('a pending move recorded under the old name lands under whichever name the prior root holds (item 3)', POSIX_ONLY, () =>
{
    const { result: r } = seedRun(['install', 'update'], SELECTION, {
        env: NO_SESSION,
        args: [['--scope', 'project'], [...UPDATE, '--data-path', '.data', '--data-move', 'move']],
        each: (repo, i) => { if (i === 0) { oldSecrets(repo); addStampLines(repo, ['secrets: dual S0', 'data-pending: sensitive .alfred/.sensitive-data -> .data/.sensitive-data']); } return null; },
        inspect: look,
    });
    assert.ok(r.has('.data/.secrets') && !r.has('.alfred/.sensitive-data') && !r.has('.alfred/.secrets'));
    assert.deepStrictEqual(pendingOf(r.stamp), []);
});
