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
    const picked = readSelection(sel(['skill dotnet-wpf', 'agent wpf-implementer', 'skill task-solve-cross', '# a comment', '']));
    const { plugins, copy } = pluginsFor(picked);
    assert.deepStrictEqual(plugins, [CORE], 'the core carries the commands, the hooks and every seat; no stack plugin exists');
    assert.deepStrictEqual(copy.skills, ['dotnet-wpf', 'task-solve-cross'], 'every skill is a library copy, an always one included');
    assert.deepStrictEqual(copy.agents, [], 'a seat rides the core - never copied');
});

test('an opt-in item is library like any other and pulls in no plugin of its own', () => {
    const { plugins, copy } = pluginsFor(readSelection(sel(['skill angular-material', 'agent related-project-analyzer'])));
    assert.deepStrictEqual(plugins, [CORE], 'a library pick pulls in no plugin');
    assert.deepStrictEqual(copy.skills, ['angular-material']);
    assert.deepStrictEqual(copy.agents, [], 'the opt-in seat rides the core, off until picked');
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
    const a = itemsOf([`${CORE}@envoydev`, 'alfred-code-hooks', 'not-a-plugin']);
    const b = itemsOf([CORE]);
    assert.deepStrictEqual(a, b, 'a hooks entry and an unknown name carry no skills or agents');
    assert.deepStrictEqual(itemsOf(['alfred-code-angular@envoydev', 'not-a-plugin']), { skills: [], agents: [] });
});

test('readSelection takes only skill and agent lines, and strips a .md suffix', () => {
    const picked = readSelection(sel(['skill a', 'agent b.md', 'rule c', 'hook d', 'plugin e', 'mcp f', 'nonsense']));
    assert.deepStrictEqual([...picked.skills], ['a']);
    assert.deepStrictEqual([...picked.agents], ['b']);
});

test('a selection file that is not there is reported, never read as an empty pick', () => {
    assert.throws(() => readSelection(path.join(os.tmpdir(), 'no-such-selection-file.txt')), /cannot read/);
});
