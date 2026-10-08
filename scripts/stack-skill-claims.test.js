// Content assertions for the 2.1.4 audit's stack-skill findings (merged.md C2-C4, I30, I36-I44).
// Each case pins one wrong claim absent and the verified claim present, so a later edit that
// restores the old teaching goes red here instead of shipping to every .NET, npm or docs seat.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ');
const SKILLS = path.join(ROOT, 'stack', 'skills');

function skillFiles(filter)
{
    const out = [];
    const walk = (dir) =>
    {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (filter(e.name)) out.push(p);
        }
    };
    walk(SKILLS);
    return out;
}

// The text of one `## Heading` section, up to the next heading of the same or higher level.
function section(text, heading)
{
    const lines = text.split('\n');
    const start = lines.findIndex((l) => l.replace(/^#+\s*/, '') === heading && /^#+ /.test(l));
    assert.ok(start >= 0, `section '${heading}' not found`);
    const level = /^#+/.exec(lines[start])[0].length;
    let end = lines.findIndex((l, i) => i > start && /^#+ /.test(l) && /^#+/.exec(l)[0].length <= level);
    if (end < 0) end = lines.length;
    return lines.slice(start, end).join('\n');
}

const shared = () => JSON.parse(read('meta/shared-rules.json')).rules;
function assertPinned(files, owner)
{
    const rules = shared();
    const hit = Object.entries(rules).find(([, r]) =>
        r.owner && r.owner.file === owner && files.every((f) => f === owner || (r.sites || []).some((s) => s.file === f)));
    assert.ok(hit, `no shared-rules entry owned by ${owner} pins ${files.join(', ')}`);
    return hit[0];
}

// C2 - no SDK rule orders class members; a clean build proves nothing about the order.
test('C2: no shipped skill credits .editorconfig with a rule that has no analyzer id', () =>
{
    for (const file of skillFiles((n) => n.endsWith('.md')))
    {
        read(path.relative(ROOT, file)).split('\n').forEach((line, i) =>
        {
            if (!/Enforced by `?\.editorconfig/i.test(line)) return;
            assert.match(line, /\b(IDE|CA|SA)\d{4}\b/, `${path.relative(ROOT, file)}:${i + 1} says 'Enforced by .editorconfig' with no IDE/CA/SA rule id`);
        });
    }
});

test('C2: csharp member ordering is a review rule, and the build is not its proof', () =>
{
    const text = read('stack/skills/csharp/SKILL.md');
    const ordering = squash(section(text, 'Class member ordering'));
    assert.doesNotMatch(ordering, /Enforced by/);
    assert.match(ordering, /No SDK analyzer or `\.editorconfig` rule enforces/);
    assert.match(ordering, /SA1201/, 'names that StyleCop orders differently, so the pack is no stand-in');
    const prove = squash(section(text, 'Prove it'));
    assert.match(prove, /analyzer-backed rules held/);
    assert.match(prove, /member ordering and the file, method and parameter caps .* diff/);
});

// C3 - CS8019 is a hidden diagnostic: WarningsAsErrors cannot promote it.
test('C3: the hygiene wave promotes IDE0005 with its three prerequisites, never CS8019', () =>
{
    // 2026-10-08 audit: the waves moved to a reference the body section cites (a verifier preloads the body).
    const body = section(read('stack/skills/dotnet-code-quality/SKILL.md'), 'Legacy backlog: promote in batches, never all at once');
    assert.ok(body.includes('`references/legacy-backlog.md`'), 'the body section cites the waves reference');
    const wave = squash(read('stack/skills/dotnet-code-quality/references/legacy-backlog.md'));
    assert.doesNotMatch(wave, /Add `CS8019/);
    assert.match(wave, /Add `IDE0005;CS0219;CS0168` to `WarningsAsErrors`/);
    for (const prereq of ['`EnforceCodeStyleInBuild=true`', '`GenerateDocumentationFile=true`', '`dotnet_diagnostic.IDE0005.severity = warning`'])
        assert.ok(wave.includes(prereq), `missing prerequisite ${prereq}`);
    assert.match(wave, /`CS8019`, a hidden diagnostic/);
    assert.match(wave, /`GenerateDocumentationFile` is also what makes `CS1591` fire/);
});

// C4 - `dotnet list package --vulnerable` exits 0 on a finding; the gate is restore-time NuGet Audit.
test('C4: the vulnerable-package gate is NuGet Audit, the listing only a report', () =>
{
    const sites = [
        'stack/skills/dotnet-security/SKILL.md',
        'stack/skills/dotnet-security/references/owasp-a06-a10.md',
        'stack/skills/dotnet-web-backend/SKILL.md',
        'stack/skills/dotnet-project-setup/references/central-package-management.md',
    ];
    for (const rel of sites)
    {
        const text = squash(read(rel));
        assert.doesNotMatch(text, /--vulnerable[^.]*fails the build/, `${rel} still says the listing fails the build`);
        assert.match(text, /exits 0 on a finding/, `${rel} does not say the listing exits 0`);
        assert.match(text, /NU1903;NU1904/, `${rel} does not name the audit codes raised to errors`);
    }
    for (const rel of sites.slice(0, 2))
        assert.match(squash(read(rel)), /`NuGetAuditMode` `all` below net10\.0/, `${rel} does not set the transitive audit mode for pre-net10 targets`);
    assertPinned(sites, 'stack/skills/dotnet-security/SKILL.md');
});

// I30 - a bare `scripts/...` path resolves against the session cwd, not the skill.
test('I30: no SKILL.md runs a bundled script by a cwd-relative path', () =>
{
    for (const file of skillFiles((n) => n === 'SKILL.md'))
    {
        const text = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(text, /node\s+["'`]?scripts\//, `${path.relative(ROOT, file)} runs node scripts/... - resolve it through \${CLAUDE_SKILL_DIR} or the project copy`);
    }
    const devlog = read('stack/skills/dev-log-convert/SKILL.md');
    assert.ok(devlog.includes('${CLAUDE_SKILL_DIR}/scripts/total-time.js'));
    assert.ok(devlog.includes('.claude/skills/dev-log-convert/scripts/total-time.js'), 'the platform-neutral fallback is the project copy');
});

// I36 - Aspire ships `aspire publish` / `aspire deploy`; the house stance is a policy, not a product limit.
test('I36: Aspire deploy stance is stated as house policy in both skills', () =>
{
    const aspire = squash(read('stack/skills/dotnet-aspire/SKILL.md'));
    const devops = squash(read('stack/skills/devops/SKILL.md'));
    assert.doesNotMatch(aspire, /never a deployment system/);
    assert.doesNotMatch(devops, /composition root for the local run and the deployment manifest/);
    for (const text of [aspire, devops])
    {
        assert.match(text, /`aspire publish` and `aspire deploy` exist/);
        assert.match(text, /adopting them is a deliberate pipeline decision, never a default/);
    }
    assertPinned(['stack/skills/devops/SKILL.md', 'stack/skills/dotnet-aspire/SKILL.md'], 'stack/skills/devops/SKILL.md');
});

// I37 - a Capacitor 8 default iOS project is SPM: no CocoaPods workspace to archive.
test('I37: the Fastfile archives the Xcode project, naming the CocoaPods variant', () =>
{
    const text = read('stack/skills/capacitor-release/SKILL.md');
    assert.match(text, /^\s*build_app\(project: 'ios\/App\/App\.xcodeproj', scheme: 'App'\)/m);
    for (const line of text.split('\n').filter((l) => /build_app\(workspace:/.test(l)))
        assert.match(line, /^\s*#.*CocoaPods/, `a live workspace archive line remains: ${line.trim()}`);
    assert.match(text, /`xcodebuild -project ios\/App\/App\.xcodeproj -scheme App/);
});

// I38 - under JWT bearer's default claim mapping `sub` becomes NameIdentifier, so FindFirst("sub") is null.
test('I38: the group join reads Context.UserIdentifier', () =>
{
    const text = read('stack/skills/dotnet-realtime/SKILL.md');
    assert.doesNotMatch(text, /FindFirst\("sub"\)\?\.Value;/);
    assert.match(text, /var customerId = Context\.UserIdentifier;/);
});

// I39 - one house answer: 404 for a resource the caller may not see, 403 only when it can see it.
test('I39: IDOR status is 404 without existence disclosure, pinned in three skills', () =>
{
    const security = read('stack/skills/dotnet-security/SKILL.md');
    assert.doesNotMatch(security, /Results\.Forbid\(\)/);
    assert.match(security, /if \(order is null\)\s*\{\s*return TypedResults\.NotFound\(\);/);
    const rule = 'a resource the caller may not see returns 404, never 403 - no existence disclosure; 403 only where the caller can see the resource but not the action';
    const files = ['stack/skills/dotnet-security/SKILL.md', 'stack/skills/dotnet-testing/SKILL.md', 'stack/skills/dotnet-web-error-handling/SKILL.md'];
    for (const rel of files) assert.ok(squash(read(rel)).includes(rule), `${rel} lacks the IDOR status rule`);
    assertPinned(files, 'stack/skills/dotnet-security/SKILL.md');
});

// I40 - `[TOC]` renders on Gitiles and GitLab; GitHub prints it as literal text.
test('I40: every [TOC] in markdown-style carries the renderer condition', () =>
{
    const dir = 'stack/skills/markdown-style';
    for (const rel of [`${dir}/SKILL.md`, `${dir}/references/style-overlay.md`, `${dir}/references/syntax-canon.md`])
    {
        read(rel).split('\n').forEach((line, i) =>
        {
            if (!line.includes('[TOC]')) return;
            assert.match(line, /where the renderer supports it|literal text/, `${rel}:${i + 1} teaches [TOC] with no renderer condition`);
        });
    }
    assert.match(squash(read(`${dir}/SKILL.md`)), /`## Contents` list of anchor links/);
});

// I41 - the docs root and generated rules belong to the skill that writes them.
test('I41: markdown-style skips the docs root and the generated rules, pinned to the rule', () =>
{
    const marker = 'The generated docs root is NOT governed here, and neither are the generated rules.';
    assert.ok(squash(read('stack/skills/markdown-style/SKILL.md')).includes(marker));
    assertPinned(['stack/rules/markdown-docs.md', 'stack/skills/markdown-style/SKILL.md'], 'stack/rules/markdown-docs.md');
});

// I42 - ignore-scripts=true silently skips every dependency's install script, and a bare
// `npm rebuild` under it runs nothing (measured on npm 11.6.1).
test('I42: the npm baseline lists install-script dependencies and rebuilds the vetted ones', () =>
{
    const text = squash(section(read('stack/skills/npm/SKILL.md'), 'Non-negotiables (any repo that has a package.json)'));
    assert.match(text, /"hasInstallScript": true/);
    assert.match(text, /npm rebuild <name> --ignore-scripts=false/);
    assert.match(text, /build and test/);
    assert.match(text, /propose it through ONE AskUserQuestion.*merged into an existing `\.npmrc`, never an overwrite/);
});

// I43 - PgBouncer 1.21+ tracks protocol-level prepared statements in transaction mode.
test('I43: prepared statements behind a transaction pooler follow the pooler, not a blanket rule', () =>
{
    const pg = squash(section(read('stack/skills/postgres/SKILL.md'), 'Connections and pooling'));
    assert.doesNotMatch(pg, /Session mode is required only for features bound to one backend: server-side prepared statements/);
    assert.doesNotMatch(pg, /Behind a transaction pooler, disable driver-side prepared statements/);
    assert.match(pg, /`max_prepared_statements`/);
    assert.match(pg, /`SHOW CONFIG`/);
    assert.match(pg, /`Max Auto Prepare` at its default 0/);
    for (const rel of ['stack/skills/database-conventions/references/transactions-and-connections.md', 'stack/skills/dotnet-data-access/references/efcore.md'])
    {
        const text = squash(read(rel));
        assert.doesNotMatch(text, /Server-side prepared statements break behind a transaction-mode pooler/);
        assert.doesNotMatch(text, /Behind a Postgres transaction pooler, disable driver prepared statements/);
        assert.match(text, /`max_prepared_statements`/, `${rel} does not name the pooler setting`);
    }
});

// I44 - the config-protection guard blocks the Nullable edit the setup skill prescribes.
test('I44: dotnet-project-setup names the config-protection gate, pinned with typescript', () =>
{
    const text = squash(read('stack/skills/dotnet-project-setup/SKILL.md'));
    assert.match(text, /Where the house config-protection guard runs, it blocks any change to `Nullable`/);
    assert.match(text, /never route around the block/);
    assertPinned(['stack/skills/typescript/SKILL.md', 'stack/skills/dotnet-project-setup/SKILL.md', 'stack/skills/dotnet-code-quality/SKILL.md'], 'stack/skills/typescript/SKILL.md');
});
