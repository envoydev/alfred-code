'use strict';
// 2026-10-22, the user's ask: the code-explaining habit becomes habits-explain-topic - any topic, not only this project's
// code - with the layered answer and the offline HTML diagram of the explain-any-topic research, the depth-only trigger
// kept (the user's pick) and the diagram written under the docs root's tutorial/ folder (the user's words).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKILL = 'stack/skills/habits-explain-topic';
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const flat = (t) => t.replace(/\s+/g, ' ');
const front = (t) => (t.match(/^---\n([\s\S]*?)\n---/) || ['', ''])[1];

// The old names live only in the manifest's renamed map (install-renames: no surface names an old skill), so they are read
// from it: the 2.9.0 name and its two earlier spellings.
test('explain-topic: renamed on disk, in the catalog, and every old name maps to it and is retired', () => {
  assert.ok(fs.existsSync(path.join(ROOT, SKILL, 'SKILL.md')), 'the new folder');
  const m = JSON.parse(read('meta/stack-manifest.json'));
  const olds = Object.keys(m.renamed.skills).filter((k) => m.renamed.skills[k] === 'habits-explain-topic');
  assert.strictEqual(olds.length, 3, `three old spellings map to it: ${olds.join(', ')}`);
  const names = m.skills.map((e) => e.name);
  assert.ok(names.includes('habits-explain-topic'));
  for (const old of olds) {
    assert.ok(!names.includes(old), `${old} left the catalog`);
    assert.ok(!fs.existsSync(path.join(ROOT, 'stack/skills', old)), `${old}'s folder is gone`);
    assert.ok(m.retired.skills.includes(old), `${old} is retired, so its copy is pruned`);
    assert.ok(!Object.values(m.renamed.skills).includes(old), `no row still points at ${old}`);
  }
});

test('explain-topic: the description fires on depth asks only, inside the 160-char cap', () => {
  const t = read(`${SKILL}/SKILL.md`);
  const d = (front(t).match(/^description:\s*"(.*)"$/m) || [])[1];
  assert.ok(d && d.length <= 160, `${d && d.length} chars`);
  assert.match(d, /^Use when/);
  for (const w of ['teach me', 'ELI5', 'step by step', 'walk me through']) assert.ok(d.includes(w), w);
  assert.match(d, /Not for quick lookups or fixes\.$/);
  const b = flat(t);
  assert.match(b, /a bare 'explain X', 'what is X' or 'how does this work' is capped like any other answer/);
  assert.match(b, /Where they did not - a bare 'explain X', 'what is X', 'how does this work' - answer inside the house budget - 900 characters of prose, and bullets count - and offer the walkthrough in one line instead/);
  assert.ok(b.includes("The user's own words decide, not this file"));
});

test('explain-topic: project code keeps the real-file walkthrough, any other topic gets the layered answer', () => {
  const t = read(`${SKILL}/SKILL.md`);
  const b = flat(t);
  assert.match(t.replace(/^---[\s\S]*?---\s*/, ''), /^# Explain a topic - /);
  for (const mode of ['**Bug mode**', '**Concept mode**', '**Compare mode**']) assert.ok(b.includes(mode), mode);
  assert.match(b, /Every snippet MUST be quoted from the actual project files/);
  for (const part of ['The short answer', 'Picture it like this', 'How it works, step by step', 'A worked example',
    'Where you see it', 'Common mix-ups', 'Going deeper', 'Recap', 'Check yourself', 'Words to know'])
    assert.ok(b.includes(part), part);
  assert.match(b, /say where it breaks down/i, 'an analogy states its limit');
  assert.match(b, /the answers after the questions/, 'recall before the answers');
  assert.match(b, /Simplify, never falsify/);
  assert.match(b, /Answer in the language the user asked in, whatever it is/);   // no language hardcoded (2026-10-27)
});

test('explain-topic: the diagram is one offline HTML file under the docs root, checked before hand-over', () => {
  const b = flat(read(`${SKILL}/SKILL.md`));
  assert.match(b, /`<docs root>\/explanations\/<topic-slug>\.<level>\.html`/);
  assert.match(b, /inline SVG/);
  assert.match(b, /no external script, font, image or CDN/);
  assert.match(b, /4\.5:1/);
  assert.match(b, /3:1/);
  assert.match(b, /`references\/diagram-template\.md`/);
  assert.match(b, /`references\/diagram-patterns\.md`/);
  const tpl = read(`${SKILL}/references/diagram-template.md`);
  assert.doesNotMatch(tpl, /<script\b|<link\b|https?:\/\//, 'the template loads nothing');
  assert.match(tpl, /role="img" aria-labelledby="d-title d-desc"/);
  assert.match(tpl, /prefers-color-scheme: dark/);
  assert.doesNotMatch(read(`${SKILL}/references/diagram-patterns.md`), /<script\b|<link\b|https?:\/\//);
});

test('explain-topic: a child level, and every run saves its pair under explanations/ (item 6)', () => {
  const b = flat(read(`${SKILL}/SKILL.md`));
  assert.match(b, /\*\*Child \/ 'like I'm six'\*\*/);
  assert.match(b, /child level: a story/);
  assert.match(b, /sentences of about 8-10 words/);
  assert.match(b, /grown-ups call this/);
  assert.match(b, /`<docs root>\/explanations\/<topic-slug>\.<level>\.md`/);
  assert.match(b, /`<docs root>\/explanations\/<topic-slug>\.<level>\.html`/);
  assert.match(b, /`-2`/);
  assert.doesNotMatch(b, /tutorial\//);
});

// The template's own claim, measured: every text colour reaches 4.5:1 on each fill it sits on, every line and shape
// 3:1 on the page (WCAG 1.4.3 and 1.4.11), in light and dark mode.
const paletteOf = (file) => [...read(`${SKILL}/references/${file}`).matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => Object.fromEntries(
  [...m[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((v) => [v[1], v[2]])));
for (const file of ['diagram-template.md', 'page-template.md'])
test(`explain-topic: the ${file} colours meet the contrast they promise, in both modes`, () => {
  const blocks = paletteOf(file);
  assert.strictEqual(blocks.length, 2, 'a light and a dark palette');
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const c of blocks) {
    for (const [fg, bg] of [['text', 'bg'], ['muted', 'bg'], ['text', 'box'], ['muted', 'box'], ['box-stroke', 'box'],
      ['text', 'accent-bg'], ['muted', 'accent-bg'], ['box-stroke', 'accent-bg']])
      assert.ok(ratio(c[fg], c[bg]) >= 4.5, `${fg} on ${bg}: ${ratio(c[fg], c[bg]).toFixed(2)}`);
    for (const [fg, bg] of [['line', 'bg'], ['box-stroke', 'bg'], ['accent', 'bg']])
      assert.ok(ratio(c[fg], c[bg]) >= 3, `${fg} on ${bg}: ${ratio(c[fg], c[bg]).toFixed(2)}`);
    // the page's answer feedback is text on the page
    if (file === 'page-template.md')
      for (const fg of ['ok', 'bad']) assert.ok(ratio(c[fg], c.bg) >= 4.5, `${fg} on bg: ${ratio(c[fg], c.bg).toFixed(2)}`);
  }
});

test('explain-topic: the page keeps the diagram template\'s palette, so a diagram pasted in looks the same (item 6)', () => {
  const [page, diagram] = [paletteOf('page-template.md'), paletteOf('diagram-template.md')];
  for (const mode of [0, 1]) for (const [k, v] of Object.entries(diagram[mode])) assert.strictEqual(page[mode][k], v, `--${k} in mode ${mode}`);
});

test('explain-topic page template: no script, link or URL; every radio has its label; one right answer per question (item 6)', () => {
  const tpl = read(`${SKILL}/references/page-template.md`);
  assert.doesNotMatch(tpl, /<script\b|<link\b|https?:\/\//);
  const radios = [...tpl.matchAll(/<input type="radio" name="(q\d+)" id="([^"]+)"([^>]*)>/g)];
  assert.ok(radios.length >= 2);
  for (const [, , id] of radios) assert.ok(tpl.includes(`<label for="${id}"`), id);
  for (const q of new Set(radios.map((m) => m[1])))
    assert.strictEqual(radios.filter((m) => m[1] === q && /\bdata-right\b/.test(m[3])).length, 1, q);
  assert.match(tpl, /<details>\s*<summary>/);
  assert.match(tpl, /input:checked \+ label/);
});

// 2026-11-19, the user's rulings: the output format is asked, the picture leads and a video is offered (only where the
// run can make one, else an animated page) - on a SECOND try only, when the first explanation did not land.
test('explain-topic: the first explanation asks nothing and keeps the diagram near the end', () => {
  const t = read(`${SKILL}/SKILL.md`);
  const before = t.split('## Before writing')[1].split('## The code track')[0];
  assert.match(before, /^\s*1\. \*\*Find the real question\.\*\*/, 'the first step before writing is the question, not an ask');
  assert.doesNotMatch(before, /```ask|Ask the format/);
  const b = flat(t);
  assert.match(b, /1\. \*\*The short answer\*\*.* 2\. \*\*Picture it like this\*\*.* 6\. \*\*The diagram\*\* - when one was made/);
  assert.doesNotMatch(b, /its diagram comes before part 2: the reader sees the path/);
  const ex = read(`${SKILL}/references/worked-example.md`);
  assert.ok(ex.indexOf('**The diagram:**') > ex.indexOf('**How it works, step by step:**'), 'the worked example keeps the diagram after the steps');
});

test('explain-topic: a second try, after the first did not land, asks the format and leads with the picture', () => {
  const t = read(`${SKILL}/SKILL.md`);
  const second = t.split('## When it did not land')[1].split('## Accuracy')[0];
  const s = flat(second);
  assert.match(s, /The first explanation is the walkthrough above, in chat, with no ask\. The format ask, the picture-first order and a video are for a second try only/);
  assert.match(s, /when the user does not understand a topic explained to them - this walkthrough or a plain answer about it - in any words and any language: 'I don't get it', 'explain it simpler', 'explain it better', 'still unclear'\./);
  assert.match(s, /A question about a status, a plan or a design answer is not this: it gets a plainer answer at the same length\./);
  assert.match(second, /^\s*1\. \*\*Ask the format\*\*/m);
  const ask = (second.match(/```ask\n([\s\S]*?)```/) || [])[1] || '';
  assert.match(ask, /^\s*The first explanation of <topic> did not land\. How do you want the second\?/);
  const opts = ask.split('\n').filter((l) => /^\s*- '/.test(l));
  assert.match(opts[0] || '', /'HTML page with diagrams \(Recommended\)'/, 'the page is the recommended option, listed first');
  assert.ok(opts.some((o) => /'In chat'/.test(o)) && opts.some((o) => /'Video'/.test(o)), 'chat and video are offered');
  assert.match(s, /Check the tools for a video route first/);
  assert.match(s, /With no video route, the third option is 'Animated page'/);
  assert.match(s, /Never offer a video the run cannot make/);
  assert.match(s, /one depth level plainer \(Depth\), a new analogy - the first did not carry - and a new worked example/);
  assert.match(s, /\*\*Lead with the picture\.\*\* On the topic track the diagram comes right after the short answer, before any step; on the code track it comes before the walkthrough's part 2/);
  const b = flat(t);
  assert.match(b, /On a second try it leads \(When it did not land\)\. The steps keep the picture's numbers and add the why the picture cannot show; they do not re-describe its layout/);
  assert.match(b, /\[ \] Video or animated page, if any: every step appears in order and is readable; reduced motion shows every step/);
  assert.match(b, /An animated page is screenshot with reduced motion emulated, or after its run's length/);
  assert.match(b, /embedded as a `data:` URI, never a downloaded one, so the page stays offline/);
  assert.match(b, /With 'Video', on a second try: `<docs root>\/explanations\/<topic-slug>\.<level>\.webm`/);
  const pat = flat(read(`${SKILL}/references/diagram-patterns.md`));
  assert.match(pat, /## Animated steps/);
  assert.match(pat, /prefers-reduced-motion: reduce\) \{ \.step \{ animation: none; \} \}/);
  assert.match(pat, /Watch the file through once before handing it over/);
  assert.match(pat, /a\.currentTime = n \* 100/, 'frames are seeked, not timed by the shots');
});

test('explain-topic: the walkthrough itself is written to the ASD-STE100 writing rules', () => {
  const b = flat(read(`${SKILL}/SKILL.md`));
  assert.match(b, /Write in the style of ASD-STE100 \(Simplified Technical English\), its writing rules, not its dictionary: a description of 25 words or fewer, an instruction of 20 or fewer, the active voice/);
  assert.match(b, /It keeps the explanation on its main topic\. A depth level's shorter sentences \(Depth\) win where they are shorter\./);
});

test('interaction rule: a topic explanation that did not land goes to the explainer\'s second try', () => {
  const r = flat(read('stack/rules/alfred-interaction.md'));
  assert.match(r, /When the user does not understand a topic explained to them, in any words \('I don't get it', 'explain it simpler', 'explain it better'\), the FIRST action is the `habits-explain-topic` Skill call: its second try asks the format \(a page with diagrams, chat or a video\) and leads with the picture\. After a status, a plan or a design answer, 'I haven't understood' means plainer at the same length\./);
});

// 2026-11-19: the explainer names the house budget exactly and uses the three labels of the interaction rule.
test('explain-topic: the budget is named exactly and the confidence labels match the rule', () => {
  const t = read(`${SKILL}/SKILL.md`);
  const budget = t.split('## The answer budget')[1].split('## Before writing')[0];
  assert.match(budget, /answer inside the house budget - 900 characters of prose, and bullets count - and offer the walkthrough in one line instead/);
  const accuracy = t.split('## Accuracy')[1].split('## Last check before sending')[0];
  assert.match(accuracy, /'\(high confidence\)', '\(medium confidence - <what is not verified>\)' or '\(low confidence - <why>\)'/);
  assert.match(accuracy, /A walkthrough that gives a cause or a verdict \(bug mode, compare mode\) carries the label in its first sentence\./);
  const check = t.split('## Last check before sending')[1].split('## The diagram')[0];
  assert.match(check, /a claim carries .*, and a cause or a verdict \(bug mode, compare mode\) carries its label in the first sentence/);
  assert.match(check, /The length is in proportion to the question/, 'no length cap on a lifted walkthrough');
  const rule = read('stack/rules/alfred-interaction.md');
  for (const label of ["'(high confidence)'", "'(medium confidence - <what is not verified>)'", "'(low confidence - <why>)'"])
    assert.ok(rule.includes(label) && accuracy.includes(label) && check.includes(label), `the rule, Accuracy and the last check share ${label}`);
});
