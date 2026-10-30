'use strict';
// capture-awareness - one capture for what a session cannot read off the code: what this install carries
// (AGENTS-AWARENESS.md, the script's), how to build, start, reach, log into and hand-check the app (the run book),
// the sibling repos it is bound to (RELATED-PROJECTS-AWARENESS.md), all under <docs-path>/awareness/ and imported by
// ONE generated rule (the user's ruling of 2026-10-16) - and since 2026-10-29 the architecture map and the code style,
// each a part the router picks by its topic word. Pinned here: the router's shape, the run book's sections and its
// no-secret rule (the doc names WHERE a credential lives, never a value), the rule's copy target, the seats that read
// the run book before running the app, and the docs engine taking the one domain. The script's own cases are
// scripts/awareness-state.test.js and scripts/capabilities-inventory.test.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { repo } = require('./docs-fixture.js');
const { lintAskTemplates } = require('./lint-skills.js');

const ROOT = path.join(__dirname, '..');
const SKILL = 'capture-awareness';
const DIR = path.join(ROOT, 'stack', 'skills', SKILL);
const read = (rel) => fs.readFileSync(path.join(DIR, rel), 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ');
const body = () => read('SKILL.md');
const asksOf = (text) => [...text.matchAll(/^[ \t]*```ask[ \t]*\n([\s\S]*?)^[ \t]*```/gm)].map((m) => m[1]);
const REFS = ['agents.md', 'architecture-doc-shapes.md', 'architecture-evidence.md', 'architecture-hazards.md', 'architecture-report-fields.md',
    'architecture-vocabulary-roles.md', 'architecture.md', 'project-code-style-doc-shape.md', 'project-code-style.md', 'project.md', 'related-projects.md'];
const PARTS = ['project', 'related-projects', 'project-code-style', 'architecture', 'agents'];
const SECTIONS = ['Before you run', 'Build', 'Start', 'Reach and log in', 'Flows to verify', 'Edge cases', 'Debugging', 'Team notes'];
// The run book's skeleton is the first fenced markdown block in the project reference that opens with the stamp.
const skeleton = () =>
{
    const m = read('references/project.md').match(/```markdown\n(Captured: [\s\S]*?)\n```/);
    assert.ok(m, 'references/project.md carries the doc skeleton as a ```markdown block opening with the Captured: stamp');
    return m[1];
};
// The sibling doc's shape sits in a four-backtick fence, since it holds a yaml block of its own.
const relatedShape = () =>
{
    const m = read('references/related-projects.md').match(/````markdown\n([\s\S]*?)\n````/);
    assert.ok(m, 'references/related-projects.md carries the doc shape in a ````markdown block');
    return m[1];
};
// The value check the capture runs over the run book before it reports: a credential key (env or YAML shape, or a
// lower-case password key) followed by anything but an empty value or a <placeholder> is a value in the doc.
const VALUE_RE = /(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|password|passwd)[A-Za-z0-9_]*[:=][ \t]*[^\s<]/;

test('one skill, five parts: the model may load it, and the fresh-session guard lists it as an orchestration run', () =>
{
    const front = body().split('---')[1];
    assert.match(front, /^name: capture-awareness$/m);
    assert.doesNotMatch(front, /disable-model-invocation/, 'a description match loads it (spec 1.5)');
    // the 2026-10-30 billed probe: 'note where our Jira and Sentry live' hand-edited the resources doc and one 'document the
    // module boundaries' answered from the map, neither loading this skill - so both are named triggers
    assert.match(front, /^description: "Use when asked to capture or note project awareness - run book, Jira\/Sentry links, architecture map or module boundaries, code style, sibling repos, installs\."$/m);
    assert.deepStrictEqual(fs.readdirSync(path.join(DIR, 'references')).sort(), REFS, 'the five parts and the moved references');
    const text = body();
    for (const part of PARTS)
        assert.ok(text.includes(`- ${part}: read \`references/${part}.md\` and follow it.`), `SKILL.md sends the ${part} part to its reference`);
    const hook = fs.readFileSync(path.join(ROOT, 'stack', 'hooks', 'guard-fresh-session-start.js'), 'utf8');
    const src = /^const ORCHESTRATION = \/(.*)\/;$/m.exec(hook)[1];
    assert.ok(new RegExp(src).test(SKILL), 'guard-fresh-session-start.js ORCHESTRATION matches the capture');
});

test('the router: the part table, the argument order, the chain and the close - every doc under its folder', () =>
{
    const text = body();
    const steps = [...text.matchAll(/^## (\d)\. (.+)$/gm)].map((m) => `${m[1]} ${m[2]}`);
    assert.deepStrictEqual(steps, ['0 The script - resolve it once', '1 The topic word', '2 One part', '3 The chain', '4 Callers', '5 The close']);
    const rows = [...text.matchAll(/^\| (project|related-projects|project-code-style|architecture|agents) \| /gm)].map((m) => m[1]);
    assert.deepStrictEqual(rows, PARTS, 'the router table in its order, agents last so the inventory follows the seat parts');
    for (const doc of ['AGENTS-AWARENESS.md', 'RUN-AND-DEBUG-AWARENESS.md', 'PROJECT-INFO-AWARENESS.md', 'RESOURCES-AWARENESS.md', 'RELATED-PROJECTS-AWARENESS.md', 'USER-AWARENESS.md'])
        assert.ok(text.includes(`<docs-path>/awareness/${doc}`), `${doc} lives in <docs-path>/awareness/`);
    assert.match(text, /\| `<docs-path>\/awareness\/AGENTS-AWARENESS\.md` \| [^|]+ \| the script, whole \| never - it names this machine's plugins \|/, 'the inventory doc stays out of git');
    assert.match(text, /\| `\.claude\/rules\/alfred-awareness\.md` \| one `@` import per doc \| the script \|/, 'conformance claim A1 keeps its marker');
    assert.match(squash(text), /`caps: absent` means neither home has it: say so and stop - never hand-tally the inventory or hand-write the rule/);
    const flat = squash(text);
    // Spec 1.2 step 3: a typed rest that does not fit the part's column is a NOTE, said on the run's first line.
    assert.ok(flat.includes("'Read as a note: <text>. To run the <part> part, type /capture-awareness <topic>.'"), 'the typed NOTE line');
    assert.ok(flat.includes("A caller's Skill call (section 4) is never re-read as a note: its topic wins and the rest is its argument."), 'a caller keeps its part');
    // Spec 1.2 step 4: the description match decides first, then the typed command's four branches.
    assert.match(flat, /4\. No match - who started the load decides: - On a description match \(the model loaded the skill on a request\), section 3's load rule decides/);
    for (const branch of ['a path that exists or a git URL first: the related part with those siblings;', '`refresh` alone: the chain, with every part\'s run recommended whatever its state;',
        'nothing: the chain;', 'any other text: a NOTE for the project part - never the chain.'])
        assert.ok(flat.includes(branch), branch);
    // Review Focus 4: every example row word for word.
    for (const row of ['| none | the chain |', '| `refresh` | the chain, every part recommended |', '| `Agents` | the agents part |',
        '| `architecture` | the architecture part, whole repo |', '| `architecture src/api` | the architecture part, target `src/api` (it exists) |',
        '| `architecture DELEGATED src/api` | the architecture part through its seats, no run gate or mode ask, target `src/api` |',
        "| `architecture is hexagonal` | a NOTE, 'architecture is hexagonal' (the rest is no path) |", "| `project uses pnpm 9` | the project part, NOTE 'uses pnpm 9' |",
        '| `code-style` | the code-style part |', '| `style guide lives in Confluence` | a NOTE (`style` is no topic word) |',
        '| `../backend provides-to` | the related part, sibling `../backend` |', '| `related ../backend` | the related part, sibling `../backend` |',
        '| `the API needs a VPN` | a NOTE for the project part |',
        "| (model-loaded) 'document the architecture of src/api' | the architecture part, target `src/api` - never the related part, never a NOTE |"])
        assert.ok(text.includes(row), `example row: ${row}`);
    // Spec 1.3: the chain reads the state script, never compares stamps by hand.
    assert.ok(flat.includes('1. Run `node "<caps>" --state`.'), 'the chain runs the state script');
});

test('the close: one RULE call after the last part, on one part and on the chain; a lone code-style run takes none', () =>
{
    const text = body();
    const flat = squash(text);
    assert.ok(text.indexOf('## 2. One part') < text.indexOf('Then the close (section 5).'), 'one part goes on to the close');
    assert.ok(flat.includes('5. The close (section 5), with one `Skipped:` line naming the parts not run.'), 'the chain goes on to the close');
    assert.ok(flat.includes('After the last part of any run but a lone code-style one, `node "<caps>" --rule` composes'), 'the RULE call follows the last part');
    for (const field of ['Landed:', 'Rule:', 'Skipped:'])
        assert.match(text, new RegExp(`^${field} +<`, 'm'), `the router's close carries ${field}`);
    assert.match(text, /^Live from: +next session - the rule is read at session start/m);
    // Each part's own field template lives in its reference (spec 1.3 step 5).
    for (const [ref, fields] of [['agents.md', ['Agents:', 'Inventory:', 'Flags:']], ['project.md', ['Project:', 'From repo:', 'Asked:', 'Unknown:', 'Credentials:', 'Value check:', 'Watch:']],
        ['related-projects.md', ['Related:']], ['project-code-style.md', ['Doc:', 'Verify:', 'Landed:']]])
        for (const field of fields) assert.match(read(`references/${ref}`), new RegExp(`^${field} +<`, 'm'), `${ref} carries ${field}`);
});

test('the callers: the architecture loop hands the part its mode word, and the architecture reference writes no rule', () =>
{
    const loop = fs.readFileSync(path.join(ROOT, 'stack', 'skills', 'loop-architecture-quality', 'SKILL.md'), 'utf8');
    assert.ok(loop.includes('first `capture-awareness` with `architecture <DELEGATED|INLINE> <target>` - the run\'s mode, then the target'), 'the map capture inherits the loop\'s mode');
    assert.ok(loop.includes('run `capture-awareness` with `architecture <mode> <target>` (its UPDATE path'), 'the reconcile hands the mode too');
    const arch = squash(read('references/architecture.md'));
    assert.ok(arch.includes('node .claude/hooks/docs.js lint awareness --map'), 'the map lints its own part');
    assert.ok(arch.includes("Another part's row"), 'another part\'s row is named, never fixed');
    assert.ok(!/alfred-architecture\.md/.test(arch) && !/### \d\. RULE/.test(read('references/architecture.md')), 'no step writes the retired rule');
    assert.ok(arch.includes("`Rule:` (the router close's `--rule` verdict"), 'the receipt reads the router close');
    const shapes = squash(read('references/architecture-doc-shapes.md'));
    assert.ok(shapes.includes("node .claude/hooks/docs.js watch-merge awareness --kinds 'architecture: ' --seed"), 'the map merges its watch entries');
    assert.ok(shapes.includes('--own sourceRoots --own newModule'), 'its two keys refresh every capture');
    assert.ok(!shapes.includes('alfred-architecture.md'), 'the retired rule\'s template is gone');
});

test('the run book: the eight sections in reading order, each addressable by a stable id', () =>
{
    const doc = skeleton();
    const heads = [...doc.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    assert.deepStrictEqual(heads, SECTIONS);
    for (const h of SECTIONS)
    {
        const at = doc.indexOf(`## ${h}\n`);
        assert.match(doc.slice(at).split('\n')[1], /^<!-- id: [a-z-]+ -->$/, `${h} carries its id on the line under the heading`);
    }
});

test('credentials: never asked for in chat, never in the doc - the doc names where one lives', () =>
{
    const ref = read('references/project.md');
    const skill = squash(ref);
    assert.ok(skill.includes('Never ask for a credential\'s VALUE'), 'the reference forbids asking for a value');
    assert.ok(skill.includes('the doc never holds one'), 'the reference forbids a value in the doc');
    assert.match(skill, /WHERE it lives - an environment variable, a key in a gitignored local file \(the project's sensitive data, `<data root>\/\.secrets`, first\), a vault item/);
    // A pasted value is stopped, redacted and never written - the security baseline's rotation ask follows.
    assert.match(skill, /A value the user pastes anyway is never written anywhere: redact it as `<redacted>`/);
    // The deterministic check before the report, over the doc - never the sensitive data, which holds values by design.
    assert.ok(skill.includes("grep -HnE '(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|password|passwd)[A-Za-z0-9_]*[:=][[:space:]]*[^[:space:]<]'"), 'the value check is a command, not a reminder');
    assert.match(squash(ref), /Never type a password here/, 'the login ask itself says so');

    const doc = skeleton();
    const login = doc.slice(doc.indexOf('## Reach and log in'), doc.indexOf('## Flows to verify'));
    assert.match(login, /Credentials live in/, 'the login section records where the credentials live');
    assert.ok(!VALUE_RE.test(doc), 'the skeleton itself holds no credential value');

    // The keys the user fills by hand: empty, in the project's sensitive data, which the data root's .gitignore covers.
    const tpl = ref.match(/```dotenv\n([\s\S]*?)\n```/);
    assert.ok(tpl, 'the keys are spelled in references/project.md');
    assert.ok(!VALUE_RE.test(tpl[1]), 'every template key is empty');
    assert.match(tpl[1], /^[A-Z_]*PASSWORD=$/m, 'a password key, empty');
    assert.match(ref, /`<data root>\/\.secrets`, key `<NAME>`/, 'the doc names the store and the key');
    assert.match(skill, /after proving it is ignored: `git check-ignore -q <data root>\/\.secrets` exits 0/, 'the ignore is proven before the write, not assumed');
    assert.match(skill, /never read, rewritten or appended to/, 'a store that exists is the user\'s');
    // One credential home: the old file is named only as what the next install moves into the store.
    assert.doesNotMatch(body(), /credentials\.local\.env/);
    assert.deepStrictEqual(skill.match(/[^.]*credentials\.local\.env[^.]*/g).map((s) => /is moved into the store by the next install or update/.test(s)), [true]);
});

// M14: the value check is the reference's own command, run as written over a doc holding every shape a credential
// arrives in - an env line, a YAML key copied from a compose file, a lower-case config key - beside the shapes that
// are no value (an empty template key, a placeholder, a prose mention). A hit names the file, the line and the key;
// no value ever reaches the screen.
test('M14 the value check catches env, YAML and lower-case password keys, and never prints a value', () =>
{
    const { spawnSync } = require('node:child_process');
    // -H: one file is grepped, and a hit still names it.
    const block = read('references/project.md').match(/```bash\n(grep -HnE [^\n]*)\n/);
    assert.ok(block, 'references/project.md carries the value check as a bash grep line');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbook-values-'));
    try
    {
        const cap = path.join(dir, 'awareness');
        fs.mkdirSync(cap);
        const values = ['envpass1', 'yamlpass2', 'lowerpass3', 'tokval4', 'apikey5'];
        fs.writeFileSync(path.join(cap, 'RUN-AND-DEBUG-AWARENESS.md'), [
            'Captured: main@abc1234, 2026-09-29',
            `DB_PASSWORD=${values[0]}`,
            `    POSTGRES_PASSWORD: ${values[1]}`,
            `  password: ${values[2]}`,
            `GITHUB_TOKEN=${values[3]}`,
            `STRIPE_API_KEY: ${values[4]}`,
            'ADMIN_PASSWORD=',
            'SMTP_PASSWORD: <in the vault>',
            '- Credentials live in: `.alfred/.secrets`, key `ADMIN_PASSWORD` - checked for presence',
        ].join('\n') + '\n');
        const cmd = block[1].split('<docs-path>').join(dir);
        const r = spawnSync('bash', ['-c', cmd], { encoding: 'utf8' });
        const hits = r.stdout.split('\n').filter(Boolean);
        for (const v of values) assert.ok(!r.stdout.includes(v), `the value '${v}' reached the screen:\n${r.stdout}`);
        const keys = hits.map((h) => h.replace(/^.*RUN-AND-DEBUG-AWARENESS\.md:(\d+):\s*/, '$1 '));
        assert.deepStrictEqual(keys, ['2 DB_PASSWORD', '3 POSTGRES_PASSWORD', '4 password', '5 GITHUB_TOKEN', '6 STRIPE_API_KEY'], r.stdout + r.stderr);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the asks: every template marks one recommended option first; each run-book gap can stay unknown, and the sibling ask takes typed text', () =>
{
    const text = body();
    const project = read('references/project.md');
    const related = read('references/related-projects.md');
    assert.deepStrictEqual(lintAskTemplates([{ file: 'SKILL.md', text }, { file: 'references/project.md', text: project }, { file: 'references/related-projects.md', text: related }]), []);
    const router = asksOf(text);
    assert.strictEqual(router.length, 3, 'the part pick, the chain ask and the mode ask');
    for (const ask of router) assert.match(ask.split('\n').find((l) => /^\s*- /.test(l)), /\(Recommended\)' - /, 'each router ask marks its first option');
    assert.match(router[0], /^\s*Which awareness part should run\?/);
    assert.match(router[1], /^\s*Run the awareness capture\? <n> of the five parts need it/);
    assert.match(router[2], /^\s*Run the seat parts through their analyzer seats or in this session\?/);
    const asks = asksOf(project);
    assert.strictEqual(asks.length, 8, 'the refresh gate, the four gap asks, the anything-else ask, the project-info and resources asks');
    assert.match(asks[0], /^\s*The project docs exist/);
    for (const ask of asks.slice(1, 5)) assert.match(ask, /- 'Unknown for now' - /, 'a gap ask lets the answer be unknown - the unattended rule lands there');
    assert.match(asks[6], /^\s*What is this project, who uses it, and where does it run\?/);
    assert.match(asks[7], /^\s*Where are this project's tracker, wiki, error monitor and CI\?/);
    const siblings = asksOf(related);
    assert.match(siblings[0], /^\s*Does this project depend on sibling repos the capture should map\? Type local paths or git URLs via Other/);
    assert.match(siblings[0], /- 'None - a standalone repo \(Recommended\)' - the doc records the answer with no entry/, 'an unattended run records a standalone repo, never invents siblings');
    assert.match(squash(related), /never options scraped from a filesystem scan/);
    // Spec 1.4: two calls - the gap call holds at most four, the second at most three, 'Anything else?' rides call 1
    // only while it holds three or fewer.
    const flat = squash(project);
    assert.ok(flat.includes("1. The run book's gap call below, with 'Anything else?' riding it while it holds three questions or fewer."));
    assert.ok(flat.includes('2. ONE more call, at most three questions, each asked only when DISCOVER left its gap'));
    assert.ok(flat.includes('one question per gap (at most four)'));
});

test('the rule: a pathless copy target the script fills with one import per doc, stamped with the literal docs root, inside its budget', () =>
{
    const text = body();
    const target = /COPY TARGET[^\n]*\n\n```markdown\n([\s\S]*?)\n```/.exec(text);
    assert.ok(target, 'SKILL.md carries the rule\'s copy target');
    const front = target[1].split('---')[1];
    assert.match(front, /^description: Project awareness - generated by \/capture-awareness; /m);
    assert.ok(!/^paths:/m.test(front), 'pathless - loads in every session and every subagent');
    assert.match(target[1], /follow it before you build, start, log into or hand-check the app/, 'the rule keeps build');
    const { composeAwarenessRule } = require(path.join(DIR, 'scripts', 'awareness-state.js'));
    for (const root of ['.alfred/docs', 'docs/generated/by-alfred'])
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awareness-rule-'));
        try
        {
            const aware = path.join(dir, root, 'awareness');
            fs.mkdirSync(aware, { recursive: true });
            fs.writeFileSync(path.join(aware, 'AGENTS-AWARENESS.md'), 'x\n');
            fs.writeFileSync(path.join(aware, 'PROJECT-AWARENESS.md'), 'x\n');
            fs.writeFileSync(path.join(aware, 'RELATED-PROJECTS-AWARENESS.md'), 'x\n\n## acme\n');
            const out = composeAwarenessRule({ projectRoot: dir, docs: root });
            assert.strictEqual(out.error, null);
            assert.ok(out.text.includes(`from \`${root}/awareness/\``));
            assert.deepStrictEqual(out.text.split('\n').filter((l) => l.startsWith('@')),
                ['AGENTS-AWARENESS.md', 'PROJECT-AWARENESS.md', 'RELATED-PROJECTS-AWARENESS.md'].map((n) => `@../../${root}/awareness/${n}`));
            // The docs it imports are the project's own size, and their import lines grow with the split (2026-10-29: up
            // to six, then the map's line); the rule's own text is the stack's fixed cost - 522 bytes measured 2026-10-30.
            const fixed = out.text.split('\n').filter((l) => !l.startsWith('@') && !l.startsWith('Architecture map:')).join('\n');
            assert.ok(Buffer.byteLength(fixed) <= 560, `${root}: ${Buffer.byteLength(fixed)} bytes of fixed text, over the 560-byte budget`);
        }
        finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }
    // The rule step names the rules it supersedes, and the script removes each only while it is the capture's own.
    assert.match(squash(text), /removes the rules it supersedes \(`alfred-agent-awareness\.md`, `alfred-project-awareness\.md`, `alfred-related-context\.md`, the 1\.x `baseline-project-capabilities\.md`, and the legacy architecture marker once the map's line is written\)/);
    assert.match(squash(text), /A `RULE: FAIL` line is a stack defect: report it as it stands, never hand-write the rule/);
});

test('the seats that run the app read the run book first', () =>
{
    const agents = fs.readdirSync(path.join(ROOT, 'stack', 'agents')).map((f) => f.replace(/\.md$/, ''));
    const seats = [...agents.filter((a) => a.endsWith('-verifier')), 'issue-diagnoser-runtime', 'evidence-gatherer', 'integration-reviewer'];
    assert.strictEqual(seats.length, 13);
    // 2.1.5 M60: the seat line leaves 'build' to the generated rule - the resolvers and implementers build
    // too and carry no seat line, so a seat trigger naming it reached only some of the seats that build.
    for (const seat of seats)
    {
        const text = squash(fs.readFileSync(path.join(ROOT, 'stack', 'agents', `${seat}.md`), 'utf8'));
        // 2026-10-08 agents audit F14: the condition leads, so the line no longer reads as 'log in before you start'.
        assert.ok(text.includes('When the run book `<docs-path>/awareness/RUN-AND-DEBUG-AWARENESS.md` exists - `PROJECT-AWARENESS.md`, its legacy name, in an install not yet updated - follow it before you start, log into or hand-check the app; the generated awareness rule imports it at session start, so Read it only when its text is not in your context; its commands, login steps and flows beat a guess, and `node .claude/hooks/docs.js show RUN-AND-DEBUG-AWARENESS#<id>` (or `PROJECT-AWARENESS#<id>`) reads one section'), `${seat} follows the run book first`);
        assert.ok(!/before you build/i.test(text), `${seat}: build commands are the generated rule's`);
    }
});

test('the docs engine: one awareness domain - the run book sectioned and watched, the sibling doc linted, the inventory not owned', () =>
{
    // Since 2026-10-27 the reference spells the run book's entries `docs.js watch-merge` takes, each kind prefixed
    // `run book: `; the `notOwned` row that keeps the script's doc out of the engine is the script's own.
    const block = read('references/project.md').match(/```json\n([\s\S]*?)\n```/);
    assert.ok(block, 'references/project.md spells the run book\'s watch entries');
    const entries = JSON.parse(block[1]);
    assert.ok(entries.length && entries.every((e) => e.kind.startsWith('run book: ') && e.sections.every((s) => s.startsWith('RUN-AND-DEBUG-AWARENESS#'))), 'every entry is a run book entry');
    assert.match(squash(read('references/project.md')), /The `notOwned` entry for `AGENTS-AWARENESS\.md` is the script's/, 'the shape keeps the script\'s doc out of the engine');
    // Spec 1.4: the two new docs merge their own entries beside the run book's, each under its own kind prefix.
    for (const call of ["watch-merge awareness --kinds 'project info: ' --doc PROJECT-INFO-AWARENESS", "watch-merge awareness --kinds 'resources: ' --doc RESOURCES-AWARENESS"])
        assert.ok(read('references/project.md').includes(`node .claude/hooks/docs.js ${call} <<'EOF'`), call);
    const watch = [null, `${JSON.stringify({ notOwned: ['AGENTS-AWARENESS.md'], watch: entries }, null, 2)}\n`];
    // Filled the way a run fills it: the stamp, and each covers line with the files DISCOVER read -
    // package.json under Build, the compose file under the others that declare one.
    let heading = '';
    const doc = skeleton()
        .replace('Captured: <branch>@<short-sha>, <date>', 'Captured: develop@abc1234, 2026-09-29')
        .split('\n').map((l) =>
        {
            if (l.startsWith('## ')) heading = l;
            return /^<!-- covers: /.test(l) ? `<!-- covers: ${heading === '## Build' ? '**package.json' : '**docker-compose*.yml'} -->` : l;
        }).join('\n');
    const related = relatedShape().replace('Captured: <branch>@<short-sha>, <date>', 'Captured: develop@abc1234, 2026-09-29');
    const r = repo({ tracked: true, docsPath: '.alfred/docs', files: {
        'package.json': '{ "scripts": { "start": "ng serve" } }\n',
        '.alfred/docs/awareness/RUN-AND-DEBUG-AWARENESS.md': doc,
        '.alfred/docs/awareness/RELATED-PROJECTS-AWARENESS.md': related,
        // The script's doc: no section ids, no covers - it is not the engine's to lint.
        '.alfred/docs/awareness/AGENTS-AWARENESS.md': '# Agents awareness - this project\'s capabilities\n\nCaptured: 2026-10-16 from 2.5.0@abc1234\n\n## Usage policy\n- x\n',
        '.alfred/docs/awareness/watch.json': watch[1],
    } });
    try
    {
        const lint = r.cli(['lint']);
        assert.doesNotMatch(lint.stdout, /PROBLEM/, lint.stdout);
        assert.doesNotMatch(lint.stdout, /AGENTS-AWARENESS/, `the not-owned doc is not linted:\n${lint.stdout}`);
        const where = r.cli(['where', 'package.json']);
        assert.match(where.stdout, /RUN-AND-DEBUG-AWARENESS#build - Build/, where.stdout);
        const show = r.cli(['show', 'RUN-AND-DEBUG-AWARENESS#reach-and-log-in']);
        assert.match(show.stdout, /## Reach and log in/, show.stdout);
        assert.match(r.cli(['show', 'RELATED-PROJECTS-AWARENESS#acme-billing-api']).stdout, /relation: {3}provides-to/);
        const hit = r.cli(['watch', 'package.json']);
        assert.match(hit.stdout, /RUN-AND-DEBUG-AWARENESS#build/, hit.stdout);
    }
    finally { r.rm(); }
});

// 2026-10-21, the user's ask: past the four preset question tabs, the user can hand the run book anything else it
// needs. One more question (in the gap call while it has room, else right after it) offers it; the answer lands in its
// own section, dated, kept across a refresh - and a NOTE argument that fits no section lands there too.
test('team notes: one ask beyond the preset tabs, its own dated section, kept by a refresh', () =>
{
    const text = read('references/project.md');
    const asks = asksOf(text);
    assert.match(asks[5], /^\s*Anything else the run book should hold that the questions above did not cover\?/);
    assert.match(asks[5], /- 'Nothing to add \(Recommended\)' - /, 'an unattended run adds nothing');
    assert.match(asks[5], /- 'Add my own notes' - I ask for them next, in plain text/, 'the typed route is a plain-text follow-up, never type-into-Other');
    assert.match(asks[5], /- 'I will write it myself' - nothing is written; your own notes go in <docs-path>\/awareness\/USER-AWARENESS\.md, which only you edit/, 'the user\'s own file is offered');
    const flat = squash(text);
    assert.match(flat, /rides the gap call while it holds three questions or fewer, else it is the next call/, 'four gaps fill the call; the tool caps it at four');
    assert.match(flat, /a fact that fits no section lands in Team notes/, 'a NOTE argument with no section has a home');
    const ref = flat;
    assert.match(ref, /each the user's own words ending `\(the team's answer, <date>\)`/);
    assert.match(ref, /a refresh keeps every Team notes line/);
    const doc = skeleton();
    assert.match(doc.slice(doc.indexOf('## Team notes')), /^## Team notes\n<!-- id: team-notes -->\n- <a fact the user added/m);
});

// final review M2/M3 (re-graded Important): the release note describes the chain as SKILL.md runs it - ONE ask - and
// never advises re-keying an account override to the umbrella, which would switch all five parts off where the user
// meant one; it says what the installer's own !! line says.
test('update-history: the merge note says one ask and no per-part switch', () =>
{
    const whole = fs.readFileSync(path.join(ROOT, 'setup-plugin', 'references', 'update-history.md'), 'utf8');
    // this merge's paragraph alone - capture-quality's note above it does ask one question per part
    const at = whole.indexOf('| `/capture-architecture` | `/capture-awareness` |'); // legacy: the note's own table row
    const note = whole.slice(at, whole.indexOf('The architecture docs move into the awareness domain', at)).replace(/\s+/g, ' ');
    assert.ok(at > -1 && note.length > 100, 'the merge paragraph is found');
    assert.match(note, /`\/capture-awareness` alone runs the chain of all five parts behind one ask\./);
    assert.doesNotMatch(note, /one question per part/);
    assert.doesNotMatch(note, /re-key it to `capture-awareness` by hand/);
    assert.match(note, /`capture-awareness` has no per-part switch/);
});
