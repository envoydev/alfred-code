'use strict';
// alfred-capture-project-capabilities - the project's run book for a manual check: how to build, start,
// reach and log in to the app, the flows to exercise, the edge cases and the debug entry points. Pinned
// here: the doc's sections, the no-secret rule (the doc names WHERE a credential lives, never a value),
// the generated pointer rule's template, the seats that read the run book before running the app, and
// the docs engine finding a doc written to the shape.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { repo } = require('./docs-fixture.js');
const { lintAskTemplates } = require('./lint-skills.js');

const ROOT = path.join(__dirname, '..');
const SKILL = 'alfred-capture-project-capabilities';
const DIR = path.join(ROOT, 'stack', 'skills', SKILL);
const read = (rel) => fs.readFileSync(path.join(DIR, rel), 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ');
const body = () => read('SKILL.md');
const SECTIONS = ['Before you run', 'Build', 'Start', 'Reach and log in', 'Flows to verify', 'Edge cases', 'Debugging'];
// The doc skeleton is the first fenced markdown block in the doc-shape reference that opens with the stamp.
const skeleton = () =>
{
    const m = read('references/doc-shape.md').match(/```markdown\n(Captured: [\s\S]*?)\n```/);
    assert.ok(m, 'references/doc-shape.md carries the doc skeleton as a ```markdown block opening with the Captured: stamp');
    return m[1];
};
// The value check the skill runs over the doc and the credentials template before it reports: an
// credential key (env or YAML shape, or a lower-case password key) followed by anything but an empty
// value or a <placeholder> is a value in the doc.
const VALUE_RE = /(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|password|passwd)[A-Za-z0-9_]*[:=][ \t]*[^\s<]/;

test('deliberate-only: the user types it, and the fresh-session guard lists it as an orchestration run', () =>
{
    const front = body().split('---')[1];
    assert.match(front, /^name: alfred-capture-project-capabilities$/m);
    assert.match(front, /^disable-model-invocation: true$/m);
    const hook = fs.readFileSync(path.join(ROOT, 'stack', 'hooks', 'guard-fresh-session-start.js'), 'utf8');
    const src = /^const ORCHESTRATION = \/(.*)\/;$/m.exec(hook)[1];
    assert.ok(new RegExp(src).test(SKILL), 'guard-fresh-session-start.js ORCHESTRATION matches the new capture');
});

test('the doc: the seven sections in reading order, each addressable by a stable id', () =>
{
    const doc = skeleton();
    const heads = [...doc.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    assert.deepStrictEqual(heads, SECTIONS);
    for (const h of SECTIONS)
    {
        const at = doc.indexOf(`## ${h}\n`);
        assert.match(doc.slice(at).split('\n')[1], /^<!-- id: [a-z-]+ -->$/, `${h} carries its id on the line under the heading`);
    }
    // The skill writes the doc where the rule and the seats point.
    assert.ok(body().includes('<docs-path>/project-capabilities/PROJECT-CAPABILITIES.md'));
});

test('credentials: never asked for in chat, never in the doc - the doc names where one lives', () =>
{
    const skill = squash(body());
    assert.ok(skill.includes('Never ask for a credential\'s VALUE'), 'the skill forbids asking for a value');
    assert.ok(skill.includes('the doc never holds one'), 'the skill forbids a value in the doc');
    assert.match(skill, /WHERE it lives - an environment variable, a key in a gitignored local file, a vault item/);
    // A pasted value is stopped, redacted and never written - the security baseline's rotation ask follows.
    assert.match(skill, /A value the user pastes anyway is never written anywhere: redact it as `<redacted>`/);
    // The deterministic check before the report, over the doc AND the template file.
    assert.ok(skill.includes("grep -nE '(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|password|passwd)[A-Za-z0-9_]*[:=][[:space:]]*[^[:space:]<]'"), 'the value check is a command, not a reminder');

    const doc = skeleton();
    const login = doc.slice(doc.indexOf('## Reach and log in'), doc.indexOf('## Flows to verify'));
    assert.match(login, /Credentials live in/, 'the login section records where the credentials live');
    assert.ok(!VALUE_RE.test(doc), 'the skeleton itself holds no credential value');

    // The template the user fills by hand: empty keys, gitignored inside its own folder.
    const shape = read('references/doc-shape.md');
    const tpl = shape.match(/```dotenv\n([\s\S]*?)\n```/);
    assert.ok(tpl, 'the credentials template is spelled in doc-shape.md');
    assert.ok(!VALUE_RE.test(tpl[1]), 'every template key is empty');
    assert.match(tpl[1], /^[A-Z_]*PASSWORD=$/m, 'a password key, empty, so the secret guard judges the filled file');
    assert.match(shape, /`credentials\.local\.env` in its own `\.gitignore`/);
    assert.match(skill, /git check-ignore -q/, 'the ignore is proven, not assumed');
});

// M14: the value check is the skill's own command, run as written over a doc holding every shape a
// credential arrives in - an env line, a YAML key copied from a compose file, a lower-case config key -
// beside the shapes that are no value (an empty template key, a placeholder, a prose mention). A hit
// names the file, the line and the key; no value ever reaches the screen.
test('M14 the value check catches env, YAML and lower-case password keys, and never prints a value', () =>
{
    const os = require('node:os');
    const { spawnSync } = require('node:child_process');
    const block = body().match(/```bash\n(grep -nE [^\n]*)\n/);
    assert.ok(block, 'SKILL.md carries the value check as a bash grep line');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbook-values-'));
    try
    {
        const cap = path.join(dir, 'project-capabilities');
        fs.mkdirSync(cap);
        const values = ['envpass1', 'yamlpass2', 'lowerpass3', 'tokval4', 'apikey5'];
        fs.writeFileSync(path.join(cap, 'PROJECT-CAPABILITIES.md'), [
            'Captured: main@abc1234, 2026-09-29',
            `DB_PASSWORD=${values[0]}`,
            `    POSTGRES_PASSWORD: ${values[1]}`,
            `  password: ${values[2]}`,
            `GITHUB_TOKEN=${values[3]}`,
            `STRIPE_API_KEY: ${values[4]}`,
            'ADMIN_PASSWORD=',
            'SMTP_PASSWORD: <in the vault>',
            '- Credentials live in: `credentials.local.env`, key `ADMIN_PASSWORD` - checked for presence',
        ].join('\n') + '\n');
        fs.writeFileSync(path.join(cap, 'credentials.local.env'), 'ADMIN_EMAIL=\nADMIN_PASSWORD=\n');
        const cmd = block[1].split('<docs-path>').join(dir);
        const r = spawnSync('bash', ['-c', cmd], { encoding: 'utf8' });
        const hits = r.stdout.split('\n').filter(Boolean);
        for (const v of values) assert.ok(!r.stdout.includes(v), `the value '${v}' reached the screen:\n${r.stdout}`);
        const keys = hits.map((h) => h.replace(/^.*PROJECT-CAPABILITIES\.md:(\d+):\s*/, '$1 '));
        assert.deepStrictEqual(keys, ['2 DB_PASSWORD', '3 POSTGRES_PASSWORD', '4 password', '5 GITHUB_TOKEN', '6 STRIPE_API_KEY'], r.stdout + r.stderr);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the asks: every template marks one recommended option first, and each gap can stay unknown', () =>
{
    const text = body();
    assert.deepStrictEqual(lintAskTemplates([{ file: 'SKILL.md', text }]), []);
    const asks = [...text.matchAll(/^[ \t]*```ask[ \t]*\n([\s\S]*?)^[ \t]*```/gm)].map((m) => m[1]);
    assert.ok(asks.length >= 4, `the write gate plus the gap asks, found ${asks.length}`);
    for (const ask of asks.slice(1)) assert.match(ask, /- 'Unknown for now' - /, 'a gap ask lets the answer be unknown - the unattended rule lands there');
});

test('the generated rule: a pathless pointer to the run book, stamped with the literal docs root, inside its budget', () =>
{
    const tpl = read('references/run-book-rule.template.md');
    const front = tpl.split('---')[1];
    assert.match(front, /^description: /m);
    assert.ok(!/^paths:/m.test(front), 'pathless - loads in every session and every subagent');
    assert.ok(tpl.includes('`__DOC_PATH__/project-capabilities/PROJECT-CAPABILITIES.md`'), 'the doc path is the one placeholder');
    assert.deepStrictEqual(tpl.match(/__[A-Z_]+__/g), ['__DOC_PATH__']);
    for (const root of ['.alfred/docs', 'docs/generated/by-alfred'])
    {
        const out = tpl.split('__DOC_PATH__').join(root);
        assert.ok(out.includes(`\`${root}/project-capabilities/PROJECT-CAPABILITIES.md\``));
        assert.ok(Buffer.byteLength(out) <= 300, `${root}: ${Buffer.byteLength(out)} bytes, over the 300-byte budget`);
    }
    // The skill's RULE step bakes it and checks both facts.
    const skill = squash(body());
    assert.ok(skill.includes('.claude/rules/baseline-project-run-book.md'));
    assert.match(skill, /`__DOC_PATH__` replaced by the LITERAL docs root/);
    assert.match(skill, /`grep -c __DOC_PATH__` prints 0 and `wc -c` stays at or under 300/);
});

test('the seats that run the app read the run book first', () =>
{
    const agents = fs.readdirSync(path.join(ROOT, 'stack', 'agents')).map((f) => f.replace(/\.md$/, ''));
    const seats = [...agents.filter((a) => a.endsWith('-verifier')), 'alfred-issue-diagnoser-runtime', 'evidence-gatherer', 'integration-reviewer'];
    assert.strictEqual(seats.length, 13);
    for (const seat of seats)
        assert.ok(squash(fs.readFileSync(path.join(ROOT, 'stack', 'agents', `${seat}.md`), 'utf8'))
            .includes('Before you build, start, log into or hand-check the app, read the run book `<docs-path>/project-capabilities/PROJECT-CAPABILITIES.md` when it exists'), `${seat} reads the run book first`);
});

test('the docs engine: the watch.json shape lints clean, and a doc written to the shape is found by where and show', () =>
{
    const shape = read('references/doc-shape.md');
    const watch = shape.match(/```json\n([\s\S]*?)\n```/);
    assert.ok(watch, 'doc-shape.md spells the watch.json');
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
    const r = repo({ tracked: true, docsPath: '.alfred/docs', files: {
        'package.json': '{ "scripts": { "start": "ng serve" } }\n',
        '.alfred/docs/project-capabilities/PROJECT-CAPABILITIES.md': doc,
        '.alfred/docs/project-capabilities/watch.json': watch[1],
    } });
    try
    {
        const lint = r.cli(['lint']);
        assert.doesNotMatch(lint.stdout, /PROBLEM/, lint.stdout);
        const where = r.cli(['where', 'package.json']);
        assert.match(where.stdout, /PROJECT-CAPABILITIES#build - Build/, where.stdout);
        const show = r.cli(['show', 'PROJECT-CAPABILITIES#reach-and-log-in']);
        assert.match(show.stdout, /## Reach and log in/, show.stdout);
        const hit = r.cli(['watch', 'package.json']);
        assert.match(hit.stdout, /PROJECT-CAPABILITIES#build/, hit.stdout);
    }
    finally { r.rm(); }
});
