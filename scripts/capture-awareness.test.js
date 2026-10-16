'use strict';
// capture-awareness - one capture for the three things a session cannot read off the code: what this install carries
// (AGENTS-AWARENESS.md, the script's), how to build, start, reach, log into and hand-check the app (the run book,
// PROJECT-AWARENESS.md) and the sibling repos it is bound to (RELATED-PROJECTS-AWARENESS.md), all under
// <docs-path>/awareness/, imported by ONE generated rule (the user's ruling of 2026-10-16). Pinned here: the skill's
// shape, the run book's sections and its no-secret rule (the doc names WHERE a credential lives, never a value), the
// rule's copy target, the seats that read the run book before running the app, and the docs engine taking the one
// domain. The inventory script's own cases are scripts/capabilities-inventory.test.js.
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
const SECTIONS = ['Before you run', 'Build', 'Start', 'Reach and log in', 'Flows to verify', 'Edge cases', 'Debugging'];
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

test('one skill, three references: the user types it, and the fresh-session guard lists it as an orchestration run', () =>
{
    const front = body().split('---')[1];
    assert.match(front, /^name: capture-awareness$/m);
    assert.match(front, /^disable-model-invocation: true$/m);
    assert.deepStrictEqual(fs.readdirSync(path.join(DIR, 'references')).sort(), ['agents.md', 'project.md', 'related-projects.md'], 'one reference per area');
    const text = body();
    for (const ref of ['agents', 'project', 'related-projects'])
        assert.ok(text.includes(`Read \`references/${ref}.md\``), `SKILL.md sends the run to references/${ref}.md at its step`);
    const hook = fs.readFileSync(path.join(ROOT, 'stack', 'hooks', 'guard-fresh-session-start.js'), 'utf8');
    const src = /^const ORCHESTRATION = \/(.*)\/;$/m.exec(hook)[1];
    assert.ok(new RegExp(src).test(SKILL), 'guard-fresh-session-start.js ORCHESTRATION matches the capture');
});

test('the run: inventory, run book, siblings, then the rule - and every doc under the one awareness folder', () =>
{
    const text = body();
    const steps = [...text.matchAll(/^### (\d)\. (\w+)/gm)].map((m) => `${m[1]} ${m[2]}`);
    assert.deepStrictEqual(steps, ['0 The', '1 AGENTS', '2 PROJECT', '3 RELATED', '4 RULE', '5 REPORT']);
    for (const doc of ['AGENTS-AWARENESS.md', 'PROJECT-AWARENESS.md', 'RELATED-PROJECTS-AWARENESS.md'])
        assert.ok(text.includes(`<docs-path>/awareness/${doc}`), `${doc} lives in <docs-path>/awareness/`);
    assert.match(text, /\| `<docs-path>\/awareness\/AGENTS-AWARENESS\.md` \| [^|]+ \| the script, whole \| never - it names this machine's plugins \|/, 'the inventory doc stays out of git');
    assert.match(squash(text), /`caps: absent` means neither home has it: say so and stop - never hand-tally the inventory or hand-write the rule/);
});

test('the run book: the seven sections in reading order, each addressable by a stable id', () =>
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
    assert.match(skill, /WHERE it lives - an environment variable, a key in a gitignored local file \(the project's sensitive data, `<data root>\/\.sensitive-data`, first\), a vault item/);
    // A pasted value is stopped, redacted and never written - the security baseline's rotation ask follows.
    assert.match(skill, /A value the user pastes anyway is never written anywhere: redact it as `<redacted>`/);
    // The deterministic check before the report, over the doc - never the sensitive data, which holds values by design.
    assert.ok(skill.includes("grep -HnE '(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|password|passwd)[A-Za-z0-9_]*[:=][[:space:]]*[^[:space:]<]'"), 'the value check is a command, not a reminder');
    assert.match(squash(body()), /Never type a password here/, 'the login ask itself says so');

    const doc = skeleton();
    const login = doc.slice(doc.indexOf('## Reach and log in'), doc.indexOf('## Flows to verify'));
    assert.match(login, /Credentials live in/, 'the login section records where the credentials live');
    assert.ok(!VALUE_RE.test(doc), 'the skeleton itself holds no credential value');

    // The keys the user fills by hand: empty, in the project's sensitive data, which the data root's .gitignore covers.
    const tpl = ref.match(/```dotenv\n([\s\S]*?)\n```/);
    assert.ok(tpl, 'the keys are spelled in references/project.md');
    assert.ok(!VALUE_RE.test(tpl[1]), 'every template key is empty');
    assert.match(tpl[1], /^[A-Z_]*PASSWORD=$/m, 'a password key, empty');
    assert.match(ref, /`<data root>\/\.sensitive-data`, key `<NAME>`/, 'the doc names the store and the key');
    assert.match(skill, /after proving it is ignored: `git check-ignore -q <data root>\/\.sensitive-data` exits 0/, 'the ignore is proven before the write, not assumed');
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
        fs.writeFileSync(path.join(cap, 'PROJECT-AWARENESS.md'), [
            'Captured: main@abc1234, 2026-09-29',
            `DB_PASSWORD=${values[0]}`,
            `    POSTGRES_PASSWORD: ${values[1]}`,
            `  password: ${values[2]}`,
            `GITHUB_TOKEN=${values[3]}`,
            `STRIPE_API_KEY: ${values[4]}`,
            'ADMIN_PASSWORD=',
            'SMTP_PASSWORD: <in the vault>',
            '- Credentials live in: `.alfred/.sensitive-data`, key `ADMIN_PASSWORD` - checked for presence',
        ].join('\n') + '\n');
        const cmd = block[1].split('<docs-path>').join(dir);
        const r = spawnSync('bash', ['-c', cmd], { encoding: 'utf8' });
        const hits = r.stdout.split('\n').filter(Boolean);
        for (const v of values) assert.ok(!r.stdout.includes(v), `the value '${v}' reached the screen:\n${r.stdout}`);
        const keys = hits.map((h) => h.replace(/^.*PROJECT-AWARENESS\.md:(\d+):\s*/, '$1 '));
        assert.deepStrictEqual(keys, ['2 DB_PASSWORD', '3 POSTGRES_PASSWORD', '4 password', '5 GITHUB_TOKEN', '6 STRIPE_API_KEY'], r.stdout + r.stderr);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the asks: every template marks one recommended option first; each run-book gap can stay unknown, and the sibling ask takes typed text', () =>
{
    const text = body();
    assert.deepStrictEqual(lintAskTemplates([{ file: 'SKILL.md', text }]), []);
    const asks = [...text.matchAll(/^[ \t]*```ask[ \t]*\n([\s\S]*?)^[ \t]*```/gm)].map((m) => m[1]);
    assert.strictEqual(asks.length, 6, 'the refresh gate, the four gap asks and the siblings ask');
    assert.match(asks[0], /^\s*The run book exists/);
    for (const ask of asks.slice(1, 5)) assert.match(ask, /- 'Unknown for now' - /, 'a gap ask lets the answer be unknown - the unattended rule lands there');
    assert.match(asks[5], /^\s*Does this project depend on sibling repos the capture should map\? Type local paths or git URLs via Other/);
    assert.match(asks[5], /- 'None - a standalone repo \(Recommended\)' - the doc records the answer with no entry/, 'an unattended run records a standalone repo, never invents siblings');
    assert.match(squash(text), /never options scraped from a filesystem scan/);
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
    const { composeAwarenessRule } = require(path.join(DIR, 'scripts', 'capabilities-inventory.js'));
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
            // The three docs it imports are the project's own size; the rule's own text is the stack's fixed cost.
            assert.ok(Buffer.byteLength(out.text) <= 650, `${root}: ${Buffer.byteLength(out.text)} bytes, over the 650-byte budget`);
        }
        finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }
    // The rule step names the rules it supersedes, and the script removes each only while it is the capture's own.
    assert.match(squash(text), /removes the rules it supersedes \(`alfred-agent-awareness\.md`, `alfred-project-awareness\.md`, `alfred-related-context\.md`, the 1\.x `baseline-project-capabilities\.md`\)/);
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
        assert.ok(text.includes('When the run book `<docs-path>/awareness/PROJECT-AWARENESS.md` exists, follow it before you start, log into or hand-check the app - the generated awareness rule imports it at session start, so Read it only when its text is not in your context'), `${seat} follows the run book first`);
        assert.ok(!/before you build/i.test(text), `${seat}: build commands are the generated rule's`);
    }
});

test('the docs engine: one awareness domain - the run book sectioned and watched, the sibling doc linted, the inventory not owned', () =>
{
    const watch = read('references/project.md').match(/```json\n([\s\S]*?)\n```/);
    assert.ok(watch, 'references/project.md spells the watch.json');
    assert.deepStrictEqual(JSON.parse(watch[1]).notOwned, ['AGENTS-AWARENESS.md'], 'the shape keeps the script\'s doc out of the engine');
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
        '.alfred/docs/awareness/PROJECT-AWARENESS.md': doc,
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
        assert.match(where.stdout, /PROJECT-AWARENESS#build - Build/, where.stdout);
        const show = r.cli(['show', 'PROJECT-AWARENESS#reach-and-log-in']);
        assert.match(show.stdout, /## Reach and log in/, show.stdout);
        assert.match(r.cli(['show', 'RELATED-PROJECTS-AWARENESS#acme-billing-api']).stdout, /relation: {3}provides-to/);
        const hit = r.cli(['watch', 'package.json']);
        assert.match(hit.stdout, /PROJECT-AWARENESS#build/, hit.stdout);
    }
    finally { r.rm(); }
});
