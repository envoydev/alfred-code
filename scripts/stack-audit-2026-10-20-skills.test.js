'use strict';
// Stack audit 2026-10-20, the skills track (rulings S1 / S2 / S3 / S9 and the Tier 2 rows). One file for the track's
// prose pins, so the parallel apply branches never collide in a shared test file. The audit's seat reports sit in the
// local audit folder; each block names its row.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SK = path.join(ROOT, 'stack', 'skills');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (s) => String(s).replace(/\s+/g, ' ');
function walk(dir, out = [])
{
    for (const e of fs.readdirSync(dir, { withFileTypes: true }))
    {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (e.name.endsWith('.md')) out.push(p);
    }
    return out;
}
const skillFiles = () => walk(SK).map((p) => ({ rel: path.relative(ROOT, p).split(path.sep).join('/'), text: flat(fs.readFileSync(p, 'utf8')) }));

const CARVE = "(under auto-mode the hook's `AUTO` stamp already stands - leave it)";
const TIMEOUT = "A question the idle timeout closed is no answer";
const NOSTOPS = "A typed 'no stops' or 'run it without asking me' is no waiver in this flow: say in one line that `--auto-mode` as the first word of the command is the unattended run, and never hand-write an `AUTO` line.";

// S1: one 'no stops' request had four behaviours. The hand-written AUTO waiver stays only in the two solve flows, in
// the same words; every other flow names --auto-mode and never hand-writes AUTO.
test('S1: only the two solve flows hand-write an AUTO stamp, and they say it the same way', () =>
{
    const writers = skillFiles().filter((f) => /`AUTO - "<their words, verbatim>"`/.test(f.text)).map((f) => f.rel).sort();
    assert.deepStrictEqual(writers, [
        'stack/skills/task-solve-cross/references/execution-modes.md',
        'stack/skills/task-solve/SKILL.md',
    ]);
    const waiver = (rel) => /\*\*Autonomy waiver \(AUTO\)\.\*\* (.*?AUTO starts after its answer\.)/.exec(flat(read(rel)))[1];
    // task-solve-cross's SKILL.md sits at its 18,000-char cap, so its copy lives in the reference read before the first stop
    assert.strictEqual(waiver('stack/skills/task-solve-cross/references/execution-modes.md'), waiver('stack/skills/task-solve/SKILL.md'));
    const cross = flat(read('stack/skills/task-solve-cross/SKILL.md'));
    assert.doesNotMatch(cross, /'run without plan review', 'no stops'/, 'no stops is the full waiver, not a plan-review-only one');
    assert.match(cross, /or the autonomy waiver in `references\/execution-modes\.md` - and the run then continues with `plan_review: waived`/);
    assert.match(flat(read('stack/skills/task-solve-cross/references/execution-modes.md')), /under the autonomy waiver in `SKILL\.md`/);
    for (const d of ['task-implement', 'task-build-from-scratch', 'task-version-upgrade', 'loop-architecture-quality', 'loop-code-quality', 'loop-test-coverage', 'issue-diagnoser'])
    {
        const t = flat(read(`stack/skills/${d}/SKILL.md`));
        assert.ok(t.includes(NOSTOPS), `${d} points a typed no-stops wish at --auto-mode`);
        assert.doesNotMatch(t, /literal no-stops ask/, `${d} keeps no hand-written AUTO alternative`);
    }
});

// S2: every instruction that writes an APPROVED stamp leaves the hook's AUTO stamp standing under auto-mode.
test('S2: each APPROVED-stamp instruction carries the auto-mode carve-out', () =>
{
    let sites = 0;
    for (const f of skillFiles())
    {
        // a write instruction quotes the stamp's first line in code: `APPROVED <...> - "...` or `APPROVED small-tier - "...`
        const re = /`APPROVED (?:<[^>]+>|small-tier|staged) - "[^`]*"`[^.;]*/g;
        for (const m of f.text.matchAll(re))
        {
            // the resumed small-tier variant rides the same sentence as the fresh one
            if (/resumed round/.test(m[0])) continue;
            sites++;
            assert.ok(m[0].includes(CARVE), `${f.rel}: '${m[0].slice(0, 90)}' has no auto-mode carve-out`);
        }
    }
    assert.ok(sites >= 11, `found ${sites} stamp instructions`);
});

// S3: Claude Code's askUserQuestionTimeout auto-continues an unanswered question; such a close is no answer.
test('S3: every stamp site says an idle-timeout close is no answer', () =>
{
    const stampers = skillFiles().filter((f) => /flow\/APPROVAL/.test(f.text) && /`APPROVED (?:<[^>]+>|small-tier|staged) - "/.test(f.text));
    assert.ok(stampers.length >= 9);
    for (const f of stampers)
    {
        if (/staged-mode\.md$/.test(f.rel)) continue; // the staged mode points at delegated-mode.md for the stamp
        assert.ok(f.text.includes(TIMEOUT), `${f.rel} writes a stamp but never says a timed-out ask is no answer`);
        assert.match(f.text, /opens 'No response after' and says the user may be away from keyboard/);
    }
    // the two solve flows at their size caps point at the reference that carries it
    assert.match(flat(read('stack/skills/task-solve-cross/SKILL.md')), /Build only on the approving answer \(an idle-timeout close is none: `references\/execution-modes\.md`\)/);
    assert.match(flat(read('stack/skills/task-solve/SKILL.md')), /`references\/step-mechanics\.md` holds the rest/);
});

// SKF2-08: an ask auto-mode answered is the go in the same turn - 'ENDS THE TURN' no longer holds the run on a Stop.
test('SKF2-08: task-solve-cross ends the turn at an ask unless auto-mode answered it', () =>
{
    const b = flat(read('stack/skills/task-solve-cross/SKILL.md'));
    assert.match(b, /fires AskUserQuestion and ENDS THE TURN \(an auto-mode answer is the go, same turn\);/);
    assert.match(b, /then END THE TURN \(an auto-mode answer is the go, same turn\):/);
});

// SKF2-09: the resume numbers have one source, the stop-contract hook's per-stop injection; no static range.
test('SKF2-09: the solve flows quote the hook\'s two numbers, never a static recovery range', () =>
{
    for (const d of ['task-solve', 'task-solve-cross'])
    {
        const b = flat(read(`stack/skills/${d}/SKILL.md`));
        assert.doesNotMatch(b, /21\.5-59\.4%/, d);
        assert.match(b, /\(this session's carry per message, a fresh one's cold floor\)/, d);
        assert.doesNotMatch(b, /audit 2026-10-20 C07/, `${d}: the audit breadcrumb lives in evidence.md`);
    }
    assert.match(read('stack/skills/task-solve/references/evidence.md'), /audit 2026-10-20 C07, fabea019/);
});

// Row 4 (DRIFTED): on npm 12 `--ignore-scripts` overrides `allowScripts` and skips the approved scripts too
// (docs.npmjs.com/cli/v12/using-npm/config; measured on npm 12.2.0 in the skill), so the CI reference gates the flag
// on npm 11. The two baseline asks are templates.
test('row 4: npm CI installs take --ignore-scripts on npm 11 only, and the baseline asks are templates', () =>
{
    const ops = read('stack/skills/npm/references/ci-and-operations.md');
    for (const line of ops.split('\n').filter((l) => /--ignore-scripts/.test(l)))
        assert.match(line, /on npm 11 only/, `an unconditional --ignore-scripts: ${line.slice(0, 120)}`);
    const npm = read('stack/skills/npm/SKILL.md');
    assert.strictEqual([...npm.matchAll(/^[ \t]*```ask[ \t]*$/gm)].length, 2);
    assert.match(npm, /'Add the baseline and approve the list \(Recommended\)'/);
    assert.match(npm, /'Add the baseline \(Recommended\)'/);
});

// Row 5 (DRIFTED): on the floor the built-in generator's source generator wires XML comments with no app code
// (learn.microsoft.com aspnet/core/fundamentals/openapi/openapi-comments, aspnetcore-10.0); Swashbuckle needs
// IncludeXmlComments.
test('row 5: dotnet-openapi says GenerateDocumentationFile is enough on the built-in generator', () =>
{
    const t = flat(read('stack/skills/dotnet-openapi/SKILL.md'));
    assert.doesNotMatch(t, /the property alone only writes the XML file/);
    assert.match(t, /On the floor the built-in `Microsoft\.AspNetCore\.OpenApi` generator needs nothing more/);
    assert.match(t, /`AddOpenApi\(documentName\)` gets none/);
    assert.match(t, /Swashbuckle reads the file only through `o\.IncludeXmlComments\(/);
    assert.match(t, /\*\*On \.NET 8 \(below the floor\)\*\* there is no built-in generator/);
});

// Row 6: the floor sentence is registered, every version-gated .NET skill carries it, and no stale '.NET 8+' target
// or 'below the floor (.NET 8)' wording is left.
test('row 6: the .NET floor line is registered and no .NET skill states the old target', () =>
{
    const reg = JSON.parse(read('meta/shared-rules.json')).rules['dotnet-floor-line'];
    const files = [reg.owner.file, ...reg.sites.map((s) => s.file)];
    for (const d of ['csharp-design-patterns', 'dotnet-data-access', 'dotnet-performance', 'dotnet-project-setup', 'dotnet-winforms'])
        assert.ok(files.includes(`stack/skills/${d}/SKILL.md`), `${d} carries the registered floor line`);
    for (const f of skillFiles().filter((x) => /\/(csharp|csharp-design-patterns|dotnet[^/]*)\//.test(x.rel)))
    {
        assert.doesNotMatch(f.text, /targets \.NET 8\+|\.NET 8\+, nullable/, f.rel);
        assert.doesNotMatch(f.text, /[Bb]elow the floor \(\.NET 8\)/, f.rel);
    }
    assert.doesNotMatch(read('stack/skills/dotnet-data-access/SKILL.md'), /\(\.NET 10 floor\)/);
});

// Row 7 (DRIFTED): the Agent tool takes `effort` per invocation from Claude Code 2.1.292
// (code.claude.com/docs/en/sub-agents, 'Choose an effort level'); the tool itself says set it only on an explicit ask.
test('row 7: a per-dispatch effort is possible, and only on the user\'s explicit ask', () =>
{
    const s = flat(read('stack/skills/habits-execution-strategy/SKILL.md'));
    assert.doesNotMatch(s, /the effort cannot/);
    assert.match(s, /the effort too \(Claude Code 2\.1\.292\+\), but only on the user's explicit ask/);
    assert.doesNotMatch(flat(read('stack/skills/task-solve-cross/references/execution-modes.md')), /effort no -/);
});

// Row 8 (DRIFTED): `/code-review` runs as one background subagent at the typed effort; only `ultra` is multi-agent
// (code.claude.com/docs/en/commands, /docs/en/code-review-local).
test('row 8: task-verify-code no longer says /code-review always fans out', () =>
{
    const t = flat(read('stack/skills/task-verify-code/SKILL.md'));
    assert.doesNotMatch(t, /always fans out|parallel-angle/);
    assert.match(t, /runs as its own subagent \(in the background in a terminal session\) and, with `ultra`, as a multi-agent cloud review/);
});
