// Content assertions for the stack-skill rows of the 2026-10-08 skill audit (skills.md, 'Proposed fixes, ranked').
// Each case pins the wrong teaching absent and the corrected one present, so a later edit that restores it goes red
// here instead of shipping to every seat that preloads the skill. Moves to references/ are pinned the M106 way: the
// phrase lives in the reference, not the body, and the body cites the reference.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'stack', 'skills');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const skill = (name, file = 'SKILL.md') => read(`stack/skills/${name}/${file}`);
const squash = (s) => s.replace(/\s+/g, ' ');

// Every .md file of one skill, as [relative path, text].
function skillDocs(name)
{
    const out = [];
    const walk = (dir) =>
    {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.md')) out.push([path.relative(ROOT, p), fs.readFileSync(p, 'utf8')]);
        }
    };
    walk(path.join(SKILLS, name));
    return out;
}

// The text of one heading's section, up to the next heading of the same or higher level.
function section(text, heading)
{
    const lines = text.split('\n');
    const start = lines.findIndex((l) => /^#+ /.test(l) && l.replace(/^#+\s*/, '') === heading);
    assert.ok(start >= 0, `section '${heading}' not found`);
    const level = /^#+/.exec(lines[start])[0].length;
    let end = lines.findIndex((l, i) => i > start && /^#+ /.test(l) && /^#+/.exec(l)[0].length <= level);
    if (end < 0) end = lines.length;
    return lines.slice(start, end).join('\n');
}

const description = (name) => (/^description:\s*"(.*)"\s*$/m.exec(skill(name)) || [])[1] || '';

// BLOCKER 4: the pre-commit checkpoint runs its own scoped review of the diff; `/security-review` is the unbounded
// route it reaches for only when the whole branch is the scope. No stack skill may say the checkpoint runs it.
test('B4: dotnet-security no longer says the pre-commit checkpoint runs /security-review', () =>
{
    for (const [rel, text] of skillDocs('dotnet-security'))
        assert.doesNotMatch(squash(text), /`\/security-review`, which the pre-commit checkpoint runs/, `${rel} says the checkpoint runs /security-review`);
    assert.match(squash(skill('dotnet-security')), /pairs with the pre-commit security review of the live diff/);
});

// BLOCKER 7: .NET 10 obsoletes Form.OnClosing / OnClosed and their events (WFDEV004); under warnings-as-errors the
// old advice is a build break. https://learn.microsoft.com/en-us/dotnet/desktop/winforms/wfdev-diagnostics/wfdev004
test('B7: dotnet-winforms detaches in OnFormClosed, never the obsolete OnClosed', () =>
{
    let named = 0;
    for (const [rel, text] of skillDocs('dotnet-winforms'))
    {
        const flat = squash(text);
        for (const m of flat.matchAll(/`OnClosed`[^.]*\./g))
            assert.match(m[0], /obsolete|WFDEV004/, `${rel} names OnClosed outside its obsolete note: ${m[0]}`);
        if (/detach in `OnFormClosed` \(a Form\) or `Dispose`/.test(flat)) named++;
    }
    assert.strictEqual(named, 2, 'the body and the disposal reference both detach in OnFormClosed');
});

// MATERIAL csharp:116 - the async baseline is stated in the preloaded body, not two reference hops away.
test('M csharp: the body states the never-block / no-async-void rule itself', () =>
{
    const text = squash(section(skill('csharp'), 'Async, disposal, and JSON'));
    assert.match(text, /Never block on async code \(`\.Result`, `\.Wait\(\)`, `\.GetAwaiter\(\)\.GetResult\(\)`\)/);
    assert.match(text, /no `async void` outside event handlers/);
});

// MATERIAL dotnet-architecture:3 - the listing separates choosing an architecture from documenting or judging one.
test('M dotnet-architecture: the description names its near-miss boundary', () =>
{
    assert.match(description('dotnet-architecture'), /Not for documenting or judging one\./);
});

// MATERIAL dotnet-code-quality:88-94 - the reward-hack scan is a numbered step of the gate's proof.
test('M dotnet-code-quality: the gate proof includes the reward-hack scan', () =>
{
    const gate = squash(section(skill('dotnet-code-quality'), 'The gate is `dotnet build`'));
    assert.match(gate, /4\. Check the diff against `references\/reward-hacking\.md` row by row - report `Reward-hack scan: clean` or the rows hit\./);
});

// MATERIAL dotnet-diagnostics microbenchmarking.md:90-94 - a void benchmark is dead-code-eliminable (the file's own
// table says return a value); the comparison example returns its result.
test('M dotnet-diagnostics: the comparison benchmark returns its result', () =>
{
    const ref = skill('dotnet-diagnostics', 'references/microbenchmarking.md');
    const compare = section(ref, 'Comparing two implementations');
    assert.doesNotMatch(compare, /\[Benchmark[^\]]*\]\s*\n\s*public void /, 'a void [Benchmark] in the comparison sample');
    assert.match(compare, /public int\[\] Bubble\(\)/);
    assert.match(compare, /Ratio understates the gap/);
});

// MATERIAL dotnet-project-setup:43 - the CPM add/remove rule lives in the body, not only behind a pointer.
test('M dotnet-project-setup: adding a package under CPM goes through the CLI, stated in the body', () =>
{
    const text = squash(skill('dotnet-project-setup'));
    assert.match(text, /Add or remove a package with `dotnet add package <name>` \/ `dotnet remove package <name>`/);
    assert.match(text, /under central management it writes both files in sync/);
});

// MATERIAL dotnet-testing:71 - the done word carries the run's summary line, and a fix's red run first.
test('M dotnet-testing: the done word quotes dotnet test and the red run', () =>
{
    assert.match(squash(skill('dotnet-testing')), /Before any done word: run `dotnet test -v minimal` and quote its summary line; for a fix, quote the red run on the unfixed code first\./);
    const notTest = squash(section(skill('dotnet-testing'), 'What NOT to test'));
    assert.match(notTest, /Everything in §Standard exclusions/);
});

// MATERIAL dotnet-winforms:17 and :154-155 - the designer-file rule is in the body the *.Designer.cs glob loads, and
// the leak check is a numbered proof with a fallback when no desktop session can run it.
test('M dotnet-winforms: designer rule in the body, numbered leak proof with a user fallback', () =>
{
    const text = squash(skill('dotnet-winforms'));
    assert.match(text, /A `\*\.Designer\.cs` belongs to the designer/);
    assert.match(text, /initialization that touches controls goes after `InitializeComponent\(\)`/);
    assert.match(text, /1\. `dotnet build` - quote the summary line\. 2\. Open and close the affected form twenty times/);
    assert.match(text, /put the twenty-cycle check to the user through AskUserQuestion and mark it UNVERIFIED until answered/);
});

// MATERIAL dotnet-hosted-services:8 - the preamble names the boundary once and leaves the routes to When to use.
test('M dotnet-hosted-services: one-line ownership preamble, lifecycle hooks in the reference', () =>
{
    const intro = squash(skill('dotnet-hosted-services').split('## When to use')[0]);
    assert.doesNotMatch(intro, /broker-messaging skill's/);
    assert.match(intro, /stops at the host boundary \(what lies past it: When to use\)/);
});

// Situational detail moved out of a preloaded or rule-forced body into a reference the body cites.
const MOVED = [
    ['dotnet-code-quality', 'references/legacy-backlog.md', 'Never `CS8019`, a hidden diagnostic'],
    ['dotnet-hosted-services', 'references/deployment-and-observability.md', 'StartingAsync -> StartAsync -> StartedAsync'],
    ['dotnet-mvc-controllers', 'references/api-behavior-options.md', 'Leave it off; the mapping is what gives every 4xx/5xx'],
    ['dotnet-mvc-controllers', 'references/filter-pipeline.md', 'a lower `Order` runs its before-code earlier'],
    ['dotnet-testing', 'references/coverage-collection.md', 'ReportGenerator'],
    ['dotnet-web-backend', 'references/resilience.md', 'new ResiliencePipelineBuilder()'],
    ['dotnet-minimal-api', 'references/file-uploads.md', 'MultipartBodyLengthLimit'],
    ['dotnet-openapi', 'references/consumer-codegen.md', 'OpenApiGenerateDocumentsOnBuild'],
    ['dotnet-authentication', 'references/oidc-and-api-keys.md', 'AddOpenIdConnect'],
    ['csharp', 'references/csharp-style.md', 'dotnet_style_allow_multiple_blank_lines_experimental'],
    ['csharp', 'references/dependency-injection.md', '`appsettings.{Environment}.json`'],
];
test('moves: each moved block lives in its reference, not the body, and the body cites the reference', () =>
{
    for (const [name, ref, phrase] of MOVED)
    {
        const body = skill(name);
        assert.ok(skill(name, ref).includes(phrase), `${name}/${ref} lacks '${phrase}'`);
        assert.ok(!body.includes(phrase), `${name}/SKILL.md still carries '${phrase}' - one home`);
        assert.ok(body.includes(`\`${ref}\``), `${name}/SKILL.md never cites ${ref}`);
    }
});
