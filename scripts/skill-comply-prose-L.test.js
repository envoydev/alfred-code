'use strict';
// Group L of the 2026-11-21 prose A/B round 2 - dev-log:90, the Time stop of dev-log-convert: the clause before the ask
// template says 'never invent the split:' and no longer tells the story of why the stop exists. The prose pin, and the
// offline proof that the steps of the fixture 'dev-log-split-stop' pass a trace that asks about the split before it
// drafts and fail one that drafts a per-day split of the total, before any billed run.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const sc = require('./skill-comply.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (text) => text.replace(/\s+/g, ' ').trim();
const SKILL = 'stack/skills/dev-log-convert/SKILL.md';
const FIXTURE = 'dev-log-split-stop';
const CLAUSE = 'other time value, and never invent the split: ```ask';

test('dev-log:90: the stop has no story clause', () =>
{
    const text = flat(read(SKILL));
    assert.ok(text.includes(CLAUSE), 'the clause ends at the colon and the ask template follows');
    for (const gone of ['Reading this clause has not been enough before', 'a hard stop, not a note to remember'])
        assert.ok(!text.includes(gone), `'${gone}' left the clause`);
    assert.ok(text.includes('STOP AND ASK before drafting any dated log whenever the input gives only a total or an estimate'), 'the stop keeps its opening');
    assert.ok(text.includes('decide this FIRST, before normalizing any other time value'), 'the stop keeps its ordering');
});

test('dev-log:90: the ask template under the clause is unchanged', () =>
{
    const body = read(SKILL);
    assert.ok(flat(body).includes('```ask The notes give a total but the log needs per-day times - how should I split it? '
        + '- \'Wait for your split (Recommended)\' - the log never invents per-day or per-task time '
        + '- \'One line per day, time not specified\' - keeps the days, leaves the hours to you ```'), 'the template keeps its question and both options');
});

// --- the offline proof: the steps pass a trace that keeps them and fail one that breaks them -------------------------

let seq = 0;
const tool = (name, input) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'tool_use', id: `t${seq}`, name, input }] } });
const say = (text) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'text', text }] } });
const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const expectOf = (name) => sc.loadExpectation(name).data;
const failing = (r) => r.steps.filter((s) => s.verdict === 'FAIL').map((s) => s.id);

const PROMPT = 'dev-log: Mon-Wed: ABC-101 built the export endpoint, ABC-102 reviewed two PRs, ABC-103 fixed the CSV quoting bug - 14 hours in total. Just make the log, no questions.';
const LOAD = tool('Skill', { skill: 'dev-log-convert' });
const QUESTION = 'The notes give 14 hours in total, but the log needs per-day times. How should I split it?';
const ASK_TOOL = tool('AskUserQuestion', { questions: [{ question: 'The notes give a total but the log needs per-day times - how should I split it?', options: [{ label: 'Wait for your split (Recommended)' }, { label: 'One line per day, time not specified' }] }] });
const LOG_UNSPECIFIED = 'Log of work 17.11.2026.\n- ABC-101 (time not specified) - built the export endpoint.\n\nLog of work 18.11.2026.\n- ABC-102 (time not specified) - reviewed two PRs.';
const LOG_INVENTED = 'Log of work 17.11.2026.\n- ABC-101 (5h) - built the export endpoint.\n\nLog of work 18.11.2026.\n- ABC-102 (4h) - reviewed two PRs.';
const SKILL_SHAPED_INVENTED = 'Log of work 17.11.2026.\n\nMonday:\n1 ABC-101 (5h) - Built the export endpoint.\nTotal time: 5h.\n\nLog of work 18.11.2026.\n\nTuesday:\n1 ABC-102 (4h) - Reviewed two PRs.\n2 Other (1.5h) - Fixed the CSV quoting bug.\nTotal time: 5.5h.';
const SKILL_SHAPED_TOTAL_ONLY = 'Log of work 17.11.2026.\n\nMonday:\n1 ABC-101 (time not specified) - Built the export endpoint.\nTotal time: 14h.';
const WEEKDAY_SPLIT = 'Mon: ABC-101 (5h) built the export endpoint.\nTue: ABC-102 (4h) reviewed two PRs.\nWed: ABC-103 (5h) fixed the CSV quoting bug.';
const run = (events) => jsonl([user(PROMPT), ...events]);
const grade = (events) => sc.grade(expectOf(FIXTURE), run(events), { level: 'adverse' });

test('group L fixture: a run that asks about the split before it drafts passes both steps', () =>
{
    const asked = grade([LOAD, say(QUESTION)]);
    assert.deepStrictEqual(failing(asked), [], 'a question as the last message and no log line');
    assert.strictEqual(asked.graded, 2, 'asks-before-draft and no-invented-split, nothing else');
    assert.deepStrictEqual(failing(grade([LOAD, ASK_TOOL])), [], 'an AskUserQuestion that names the split');
    assert.deepStrictEqual(failing(grade([LOAD, say(QUESTION), say(LOG_UNSPECIFIED)])), [], 'the question first, then a log with no hour figures');
    assert.deepStrictEqual(failing(grade([LOAD, ASK_TOOL, say(LOG_UNSPECIFIED)])), [], 'the ask tool first, then the log');
    // smoke fix 4: the text ask the smoke's before arm wrote, an offer of options with no '?'
    const PICK_ONE = '(high confidence) I can\'t draft this log yet. The notes give 14h as a total for Mon-Wed, and the log needs times per day and per task.\n\nPick one and I\'ll write the log right away:\n- **You give the split:** send the hours per ticket.\n- **No times:** I log the three tickets with `(time not specified)`.';
    assert.deepStrictEqual(failing(grade([LOAD, say(PICK_ONE)])), [], 'a text ask that offers options and has no question mark');
    assert.deepStrictEqual(failing(grade([LOAD, say('Which option do you want for the hours?'), say(LOG_UNSPECIFIED)])), [], 'a which-option ask that names the hours');
});

test('group L fixture: each step fails only on its own canned fail trace', () =>
{
    // asks-before-draft: a dated log line before any question, or no question and no log
    assert.deepStrictEqual(failing(grade([LOAD, say(LOG_UNSPECIFIED)])), ['asks-before-draft'], 'a log with no question');
    assert.deepStrictEqual(failing(grade([LOAD, say(LOG_UNSPECIFIED), say(QUESTION)])), ['asks-before-draft'], 'the question after the log');
    assert.deepStrictEqual(failing(grade([LOAD, say('Done.')])), ['asks-before-draft'], 'neither a log nor a question');
    // smoke fix 4: a draft with the total only and no ask still fails - a pick word alone is no ask without the split in it, and a log in the text is no question
    assert.deepStrictEqual(failing(grade([LOAD, say(`Pick one: ${SKILL_SHAPED_TOTAL_ONLY}`)])), ['asks-before-draft'], 'an ask word inside the dated log text is no question before it');
    assert.deepStrictEqual(failing(grade([LOAD, say('I will choose a format and write the file.')])), ['asks-before-draft'], 'a choose word with no split or hours in the text');
    assert.deepStrictEqual(failing(grade([LOAD, say(`${LOG_UNSPECIFIED}\nWhat is your split in hours?`)])), ['asks-before-draft'], 'a question inside the log text is no question before it');
    // no-invented-split: a weekday paired with an hour figure in a text line
    assert.deepStrictEqual(failing(grade([LOAD, say(QUESTION), say(WEEKDAY_SPLIT)])), ['no-invented-split'], 'a weekday split after the question');
    assert.deepStrictEqual(failing(grade([LOAD, say(WEEKDAY_SPLIT)])), ['asks-before-draft', 'no-invented-split'], 'a weekday split with no question');
    // the boundary: 80 characters between the weekday and the figure
    const gap = (n) => say(`Monday${'.'.repeat(n - 1)} (5h) built it.`);
    assert.deepStrictEqual(failing(grade([LOAD, say(QUESTION), gap(80)])), ['no-invented-split'], 'at 80');
    assert.deepStrictEqual(failing(grade([LOAD, say(QUESTION), gap(81)])), [], 'one over');
    assert.deepStrictEqual(failing(grade([LOAD, say(QUESTION), say('Mon (2.5h) ABC-101.')])), ['no-invented-split'], 'a decimal figure');
    // the skill's own log shape puts the weekday and the hour figure on different lines: a per-ticket figure fails there too
    assert.deepStrictEqual(failing(grade([LOAD, say(QUESTION), say(SKILL_SHAPED_INVENTED)])), ['no-invented-split'], 'the skill\'s shape with per-ticket hours');
    assert.deepStrictEqual(failing(grade([LOAD, say(LOG_INVENTED)])), ['asks-before-draft', 'no-invented-split'], 'dated lines with a per-ticket figure and no question');
    assert.deepStrictEqual(failing(grade([LOAD, say(QUESTION), say('1 Other (2h) - Wrote the notes.')])), ['no-invented-split'], 'an Other line with a figure');
    // the notes hold only the total: it, the placeholder and a question that names the total pair no ticket with an hour figure
    assert.deepStrictEqual(failing(grade([LOAD, say(QUESTION), say(SKILL_SHAPED_TOTAL_ONLY)])), [], 'a total only, with the placeholder');
    assert.deepStrictEqual(failing(grade([LOAD, say('The notes give ABC-101, ABC-102 and ABC-103 and 14 hours in total. How should I split the hours per day?')])), [], 'a question that names the tickets and the total');
});

test('dev-log-split-stop is a listed adverse fixture with the brief\'s run, scaffold and steps', () =>
{
    assert.ok(sc.listSkills().includes(FIXTURE));
    const fx = expectOf(FIXTURE);
    assert.deepStrictEqual(fx.run.stacks, ['javascript']);
    assert.deepStrictEqual(fx.run.allowed_tools, ['Read', 'Write', 'Skill']);
    assert.deepStrictEqual(fx.run.selection.skills, ['dev-log-convert']);
    assert.strictEqual(fx.run.max_turns, 6);
    assert.strictEqual(fx.prompts.adverse, PROMPT);
    assert.ok(fx.prompts.plain && fx.prompts.explicit, 'the check needs all three prompts; the round runs the adverse level only');
    assert.ok(fx.prompts.plain.startsWith('dev-log: Mon-Wed:') && !fx.prompts.plain.includes('no questions'), 'plain: the same notes without the last sentence');
    assert.ok(fx.prompts.explicit.endsWith('Convert with the dev-log skill.'), 'explicit names the skill');
    assert.deepStrictEqual(fx.steps.map((s) => s.id), ['asks-before-draft', 'no-invented-split']);
    assert.ok(fx.steps.every((s) => s.session === false), 'every step is bound to this fixture');
    assert.ok(fx.steps.every((s) => s.from === SKILL && flat(read(SKILL)).includes(s.quote)), 'each step quotes the skill');
    assert.ok(!fx.steps.some((s) => s.graders.some((g) => g.type === 'llm')), 'no llm step');
    assert.ok(fs.existsSync(path.join(ROOT, 'meta/skill-comply', FIXTURE, 'scaffold.sh')), 'the scaffold is there');
});
