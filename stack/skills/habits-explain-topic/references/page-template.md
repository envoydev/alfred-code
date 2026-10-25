# Page template

The starting file for a run's page, `<topic-slug>.<level>.html`: the steps, the diagram when the topic has a shape, and
Check yourself as questions that answer on a click - one offline file, no script, nothing loaded.

## Contents

- [The file](#the-file) - the page to copy
- [Adapting it](#adapting-it) - the diagram, a question, the palette, what it never holds

## The file

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TOPIC, explained</title>
<style>
  :root {
    --bg: #ffffff; --text: #1a1a1a; --muted: #4a4a4a; --line: #333333;
    --box: #eef4ff; --box-stroke: #1f5fbf; --accent: #a8420a; --accent-bg: #fff1e6;
    --ok: #1d6b2f; --bad: #a3221b;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #121212; --text: #f2f2f2; --muted: #c8c8c8; --line: #d0d0d0;
      --box: #1b2a44; --box-stroke: #8ab4ff; --accent: #ffb27a; --accent-bg: #3a2414;
      --ok: #7fd18f; --bad: #ff9a8f;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--text);
         font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.5; }
  main { max-width: 960px; margin: 0 auto; }
  h1 { font-size: 1.6rem; margin: 0 0 4px; }
  h2 { font-size: 1.2rem; margin: 24px 0 8px; }
  .subtitle { color: var(--muted); margin: 0 0 16px; }
  ol.steps li { margin: 0 0 8px; }
  fieldset.q { border: 2px solid var(--box-stroke); border-radius: 12px; margin: 0 0 16px; padding: 12px 16px; }
  fieldset.q legend { font-weight: 700; padding: 0 6px; }
  .opt { margin: 6px 0; }
  .opt label { margin-left: 6px; cursor: pointer; }
  .opt .fb { display: none; margin: 4px 0 0 28px; font-weight: 600; }
  .opt input:checked + label { font-weight: 700; }
  .opt input:checked + label + .fb { display: block; }
  .opt input[data-right]:checked + label + .fb { color: var(--ok); }
  .opt input:not([data-right]):checked + label + .fb { color: var(--bad); }
  details { margin: 12px 0; }
  summary { cursor: pointer; font-weight: 700; }
  dt { font-weight: 700; }
  dd { margin: 0 0 8px 16px; }
</style>
</head>
<body>
<main>
  <h1>TOPIC, explained</h1>
  <p class="subtitle">Level: LEVEL. The short answer, in one sentence.</p>

  <h2>How it works, step by step</h2>
  <ol class="steps">
    <li><strong>First step</strong> - what happens, and why.</li>
    <li><strong>Key step</strong> - what happens, and why.</li>
    <li><strong>Result</strong> - what you end up with.</li>
  </ol>

  <!-- The diagram goes here when the topic has a shape: the <figure> of diagram-template.md, its numbers and words the steps' own, with that template's diagram rules appended to the style above. -->

  <h2>Check yourself</h2>
  <fieldset class="q">
    <legend>1. What would happen if ...?</legend>
    <div class="opt"><input type="radio" name="q1" id="q1-1"><label for="q1-1">A tempting wrong answer</label><p class="fb">Not quite - why it feels right, and why it is wrong.</p></div>
    <div class="opt"><input type="radio" name="q1" id="q1-2" data-right><label for="q1-2">The right answer</label><p class="fb">Right - the step that makes it so.</p></div>
    <div class="opt"><input type="radio" name="q1" id="q1-3"><label for="q1-3">Another wrong answer</label><p class="fb">Not quite - what it misses.</p></div>
  </fieldset>
  <fieldset class="q">
    <legend>2. A new case: ...?</legend>
    <div class="opt"><input type="radio" name="q2" id="q2-1" data-right><label for="q2-1">The right answer</label><p class="fb">Right - why it applies here too.</p></div>
    <div class="opt"><input type="radio" name="q2" id="q2-2"><label for="q2-2">A wrong answer</label><p class="fb">Not quite - what it misses.</p></div>
  </fieldset>

  <details>
    <summary>The answers, explained</summary>
    <ol>
      <li>Question 1: the right answer, and the step that proves it.</li>
      <li>Question 2: the right answer, and why it carries over.</li>
    </ol>
  </details>
  <details>
    <summary>Words to know</summary>
    <dl>
      <dt>term</dt><dd>One plain sentence.</dd>
    </dl>
  </details>
</main>
</body>
</html>
```

## Adapting it

- Replace the title, the level, the short answer, the steps and the words. The steps carry the walkthrough's own
  numbers and words, so the page and the chat answer agree.
- The diagram: paste the `<figure>` from `references/diagram-template.md` where the comment sits and copy its diagram
  rules (`.diagram-wrap` to `.arrowhead-fill`) into the style. A topic with no shape has no diagram; drop the comment.
- A question is one `<fieldset class="q">`: one `<input type="radio">` per option, all sharing `name="q<n>"`, each with
  its own `id="q<n>-<k>"` and the `<label for="q<n>-<k>">` right after it, then the feedback `<p class="fb">`. Exactly
  one option carries `data-right`. The feedback opens with a word - 'Right' or 'Not quite' - so colour never carries
  the answer alone.
- The palette is the diagram template's, plus `--ok` and `--bad` for the feedback; the skill's tests measure every
  pair in light and dark mode and hold the shared colours equal to the diagram's. A colour you change is measured again.
- The page never holds a script, an external stylesheet, font or image, or a link to load: it opens offline and runs
  no code.
