'use strict';
// The stack audit of 2026-10-20, agents track: what the seat bodies, their orchestrators' protocol docs and the data
// stack's detection now say. Each test names the audit row it holds, so a regression reads as the row it reopens.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');
const AGENTS = path.join(ROOT, 'stack', 'agents');
const squash = (s) => s.replace(/\s+/g, ' ');
const seats = fs.readdirSync(AGENTS).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')).sort();
const read = (seat) => fs.readFileSync(path.join(AGENTS, `${seat}.md`), 'utf8');
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const split = (text) =>
{
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    return { meta: yaml.load(m[1]), body: m[2] };
};
const meta = (seat) => split(read(seat)).meta;
const body = (seat) => split(read(seat)).body;
const rules = () => JSON.parse(readRel('meta/shared-rules.json')).rules;
const copiesOf = (id) => { const r = rules()[id]; return [r.owner, ...(r.sites || [])]; };
const listedIn = (id) => new Set(copiesOf(id).map((c) => c.file));
const section = (text, heading) =>
{
    const at = text.indexOf(`\n## ${heading}`);
    if (at < 0) return '';
    const rest = text.slice(at + 1);
    const next = rest.indexOf('\n## ', 3);
    return next < 0 ? rest : rest.slice(0, next);
};
const of = (suffix) => seats.filter((s) => s.endsWith(suffix));

// --- A7 (the user's ruling: the data trio is .NET / EF Core only) ----------------------------------------------------------
// The data seats preview `dotnet ef` scripts and gate on `__EFMigrationsHistory`, but init detected `data` from any
// `*.sql`, so a Flyway or Prisma repo got a trio that could only report BLOCKED_BY_BUILD. Detection now asks for EF
// Core, every data seat says so, and `dotnet-migrate` - which data-implementer names on demand - is seeded with the
// stack instead of arriving only through the designer's and verifier's preloads.
test('A7: data is detected from EF Core alone, the trio says .NET / EF Core, dotnet-migrate is seeded', () =>
{
    const init = squash(readRel('setup-plugin/references/init-install.md'));
    assert.doesNotMatch(init, /`\*\.sql` \/ a migrations folder -> `data`/, 'init: *.sql alone no longer detects data');
    assert.ok(init.includes('a `.csproj` referencing `Microsoft.EntityFrameworkCore.*`, or a `Migrations/` folder holding a `*ModelSnapshot.cs` beside a `.csproj` -> `data`'), 'init: the EF Core signal');
    assert.match(init, /`\*\.sql` files or a migrations folder alone \(Flyway, Liquibase, Prisma, a Node or Python ORM\) are NOT `data`/, 'init: the pure-SQL case is named');
    for (const s of ['data-solution-designer', 'data-implementer', 'data-verifier'])
        assert.match(meta(s).description, /\.NET \/ EF Core/, `${s}: the description names .NET / EF Core`);
    const recs = JSON.parse(readRel('meta/recommendations.json'));
    assert.ok(recs.stacks.data.skills.includes('dotnet-migrate'), 'stacks.data seeds dotnet-migrate');
    assert.ok(squash(read('data-implementer')).includes('load `dotnet-migrate`'), 'the cite it backs');
});

// --- agents #2: the WPF seats no longer call the toolkit generators unavailable on net48 ------------------------------
// The preloaded dotnet-wpf reference says the generators run on net48 under three conditions (PackageReference, C# 8+,
// the .NET 6+ SDK) with a netstandard2.0 view-model library as the fallback; the seats said the opposite.
test('agents #2: the WPF seats point at the net48 reference instead of contradicting it', () =>
{
    for (const s of ['wpf-implementer', 'wpf-verifier'])
    {
        const text = squash(read(s));
        assert.doesNotMatch(text, /generators (are )?unavailable/, `${s}: the stale net48 claim`);
        assert.ok(text.includes("`dotnet-wpf`'s `references/net-framework-48.md`"), `${s}: the pointer`);
        assert.ok(meta(s).skills.includes('dotnet-wpf'), `${s}: the reference's skill is preloaded`);
    }
    const ref = squash(readRel('stack/skills/dotnet-wpf/references/net-framework-48.md'));
    assert.match(ref, /PackageReference, not packages\.config/);
    assert.match(ref, /\.NET Standard 2\.0 class library/);
});

module.exports = { seats, read, readRel, meta, body, section, squash, rules, copiesOf, listedIn, of };
