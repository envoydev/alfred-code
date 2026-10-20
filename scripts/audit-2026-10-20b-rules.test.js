'use strict';
// Rules audit 2026-10-20b (the 2.8.0 delta): where the generated preferences rule met an older always-on clause. One file
// for the track's prose pins, so the parallel apply branches never collide in a shared test file.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { injectedRuleText } = require('./always-on-surface.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (s) => String(s).replace(/\s+/g, ' ');
const injected = (name) => flat(injectedRuleText(read(`stack/rules/${name}.md`)));

// R1: the git rule keeps its consent and safety lines from GIT-PREFERENCES.md, while the preferences rule claimed to
// outrank 'the house convention and git rules' with a never-list naming neither - a 'force-push freely' preference won
// in one rule and lost in the other. The generated rule and its doc shape now carry the git rule's own carve-out.
test('R1: the preferences rule and the git rule agree on what a git preference cannot override', () =>
{
    assert.match(injected('alfred-git'), /overrides this file's branch, commit-message and PR conventions - never its consent or safety lines\./);
    const tpl = flat(read('stack/skills/capture-preferences/references/rule-template.md'));
    assert.ok(tpl.includes("They never override security, input validation, error handling, accessibility or `alfred-git.md`'s consent and safety lines, and never open a hook's gate."), 'the generated rule');
    const shape = flat(read('stack/skills/capture-preferences/references/doc-shape.md'));
    assert.ok(shape.includes("A preference never overrides security, input validation, error handling, accessibility or `alfred-git.md`'s consent and safety lines, and never opens a hook's gate."), 'the doc shape');
    const entry = JSON.parse(read('meta/shared-rules.json')).rules['git-preferences-carve-out'];
    assert.strictEqual(entry.owner.file, 'stack/rules/alfred-git.md');
    assert.deepStrictEqual(entry.sites.map((s) => s.file).sort(), ['stack/skills/capture-preferences/references/doc-shape.md', 'stack/skills/capture-preferences/references/rule-template.md']);
});

// R2: 'Inherited code: its conventions win over these rules' read, beside the preferences rule, as the code's conventions
// beating the user's preferences - the opposite of the preferences rule's own ranking. The interaction line now names
// the house rules, and the preferences rule names the code's own style it outranks.
test('R2: inherited conventions beat the house rules, the user\'s preferences beat the code\'s own style', () =>
{
    assert.match(injected('alfred-interaction'), /Inherited code: its conventions win over these house rules unless broken or unsafe\./);
    const tpl = flat(read('stack/skills/capture-preferences/references/rule-template.md'));
    assert.ok(tpl.includes("the code's own style (`CODE-STYLE.md` and its rule)"), 'the preferences rule names what it outranks');
});

// R3: the memory rule said memory holds 'preferences' while 2.8.0 gave code, architecture and git preferences a docs
// domain, and memory's start block never reaches a dispatched seat (memory-session.js: SubagentStart gets the tag and
// tool lines only). Such a preference is stored and handed to the user as the slash-only capture that binds every seat.
test('R3: a code, architecture or git preference is stored and routed to /capture-preferences', () =>
{
    const mem = injected('alfred-memory');
    assert.match(mem, /^# Shared memory Project truth lives in the docs domains; memory holds what they do not - corrections, lessons, and preferences the `preferences\/` docs lack/);
    assert.ok(mem.includes('A code, architecture or git preference is stored too, then named to the user as `/capture-preferences <their words>` to run - only its rule reaches every seat'), mem);
    const skill = read('stack/skills/capture-preferences/SKILL.md');
    assert.match(skill, /^disable-model-invocation: true$/m, 'slash-only, so the rule hands it to the user');
    assert.ok(JSON.parse(read('meta/recommendations.json')).always.skills.includes('capture-preferences'), 'every install carries it, so the always-on rule may name it');
    const hook = read('stack/hooks/memory-session.js');
    const seatBranch = hook.slice(hook.indexOf("if (event === 'SubagentStart')"), hook.indexOf('const level = memory.levelOfPath'));
    assert.ok(seatBranch.includes("return emit('SubagentStart'") && !seatBranch.includes('selectForSession'), 'a seat gets the tag and tool lines, no memory block');
});
