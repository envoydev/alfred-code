'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSelection, pluginsFor, itemsOf } = require('./selection-plugins.js');
const { placement, CORE } = require('./plugin-placement.js');

const ROOT = path.join(__dirname, '..');
const place = placement();

function sel(lines)
{
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'selplug-')), 'selection.txt');
    fs.writeFileSync(f, lines.join('\n') + '\n');
    return f;
}

test('a selection file enables the core and copies its library picks', () => {
    const picked = readSelection(sel(['skill dotnet-wpf', 'agent wpf-implementer', 'skill alfred-task-solve-cross', '# a comment', '']));
    const { plugins, copy } = pluginsFor(picked);
    assert.deepStrictEqual(plugins, [CORE], 'the core carries the commands and the baseline; no stack plugin exists');
    assert.deepStrictEqual(copy.skills, ['dotnet-wpf'], 'a stack skill is a library copy');
    assert.deepStrictEqual(copy.agents, ['wpf-implementer'], 'and so is a stack seat');
});

test('an opt-in item is library like any other and pulls in no plugin of its own', () => {
    const { plugins, copy } = pluginsFor(readSelection(sel(['skill angular-material', 'agent related-project-analyzer'])));
    assert.deepStrictEqual(plugins, [CORE], 'a library pick pulls in no plugin');
    assert.deepStrictEqual(copy.skills, ['angular-material']);
    assert.deepStrictEqual(copy.agents, ['related-project-analyzer']);
});

// The whole point of the split: what the plugins carry plus what is copied must be exactly what was
// picked. A gap here is a skill that reaches no project at all.
test('the core + the library copies cover every picked item, with nothing invented', () => {
    const skills = fs.readdirSync(path.join(ROOT, 'stack/skills')).filter(d => fs.existsSync(path.join(ROOT, 'stack/skills', d, 'SKILL.md')));
    const agents = fs.readdirSync(path.join(ROOT, 'stack/agents')).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));
    const picked = { skills: new Set(skills), agents: new Set(agents) };
    const { plugins, copy } = pluginsFor(picked);
    const carried = itemsOf(plugins);
    const gotSkills = new Set([...carried.skills, ...copy.skills]);
    const gotAgents = new Set([...carried.agents, ...copy.agents]);
    assert.deepStrictEqual([...gotSkills].sort(), [...skills].sort());
    assert.deepStrictEqual([...gotAgents].sort(), [...agents].sort());
    assert.ok(copy.skills.length + copy.agents.length > 0, 'the library is a real category, not an empty branch');
});

// `--installed-only` reads the plugins back, so the inverse direction has to round-trip: the items a
// picked set's plugins carry must re-pick exactly those plugins. Without it an update read a
// plugin-native install as 'nothing installed' and dropped every per-stack plugin it had.
test('itemsOf round-trips: the core items re-select the core and copy nothing', () => {
    const back = itemsOf([CORE]);
    assert.deepStrictEqual(back.skills, place.plugins[CORE].skills);
    const again = pluginsFor({ skills: new Set(back.skills), agents: new Set(back.agents) });
    assert.deepStrictEqual(again.plugins, [CORE]);
    assert.deepStrictEqual(again.copy, { skills: [], agents: [] }, 'a core item is never a library copy');
});

test('itemsOf ignores a name no placement knows, and accepts the @marketplace spelling', () => {
    const a = itemsOf(['claude-stack-wpf@envoydev', 'claude-stack-hooks', 'not-a-plugin']); // legacy-name
    const b = itemsOf(['claude-stack-wpf']);
    assert.deepStrictEqual(a, b, 'the 1.x hooks alias and an unknown name carry no skills or agents');
});

// status reads what a not-yet-removed per-stack entry carries through --items, while the user is
// deciding whether to run the update that removes it - an empty answer under-reports that install.
test('itemsOf reads a retired per-stack entry from its frozen 1.2.0 contents', () => {
    const { readRetiredEntries } = require('./plugin-placement.js');
    const angular = readRetiredEntries().find((e) => e.name === 'claude-stack-angular');
    const got = itemsOf(['claude-stack-angular@envoydev']);
    assert.deepStrictEqual(got.skills, [...angular.skills].sort());
    assert.deepStrictEqual(got.agents, [...angular.agents].sort());
    assert.ok(got.skills.length > 0);
});

test('readSelection takes only skill and agent lines, and strips a .md suffix', () => {
    const picked = readSelection(sel(['skill a', 'agent b.md', 'rule c', 'hook d', 'plugin e', 'mcp f', 'nonsense']));
    assert.deepStrictEqual([...picked.skills], ['a']);
    assert.deepStrictEqual([...picked.agents], ['b']);
});

test('a selection file that is not there is reported, never read as an empty pick', () => {
    assert.throws(() => readSelection(path.join(os.tmpdir(), 'no-such-selection-file.txt')), /cannot read/);
});
