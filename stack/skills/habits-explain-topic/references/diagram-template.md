# Diagram template

The starting file for a topic's diagram: one page, inline SVG, no external file of any kind.

## Contents

- [The file](#the-file) - the page to copy
- [Adapting it](#adapting-it) - adding a step, the highlighted box, the palette, what it does not draw

## The file

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>How TOPIC works - diagram</title>
<style>
  :root {
    --bg: #ffffff; --text: #1a1a1a; --muted: #4a4a4a; --line: #333333;
    --box: #eef4ff; --box-stroke: #1f5fbf; --accent: #a8420a; --accent-bg: #fff1e6;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #121212; --text: #f2f2f2; --muted: #c8c8c8; --line: #d0d0d0;
      --box: #1b2a44; --box-stroke: #8ab4ff; --accent: #ffb27a; --accent-bg: #3a2414;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--text);
         font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.5; }
  main { max-width: 960px; margin: 0 auto; }
  h1 { font-size: 1.6rem; margin: 0 0 4px; }
  .subtitle { color: var(--muted); margin: 0 0 16px; }
  .diagram-wrap { overflow-x: auto; }
  .diagram-wrap svg { display: block; width: 100%; min-width: 640px; height: auto; }
  figure { margin: 0; }
  figcaption { margin-top: 12px; color: var(--muted); }
  .box { fill: var(--box); stroke: var(--box-stroke); stroke-width: 2; }
  .box.highlight { fill: var(--accent-bg); stroke: var(--accent); stroke-width: 3; }
  .num { fill: var(--box-stroke); font-size: 18px; font-weight: 700; }
  .label { fill: var(--text); font-size: 20px; font-weight: 600; }
  .note { fill: var(--muted); font-size: 16px; }
  .arrow { stroke: var(--line); stroke-width: 3; fill: none; marker-end: url(#arrowhead); }
  .arrowhead-fill { fill: var(--line); }
  ol.key { padding-left: 20px; }
</style>
</head>
<body>
<main>
  <h1>How TOPIC works</h1>
  <p class="subtitle">The big idea in one sentence.</p>
  <figure>
    <div class="diagram-wrap">
      <svg viewBox="0 0 900 260" role="img" aria-labelledby="d-title d-desc">
        <title id="d-title">How TOPIC works in three steps</title>
        <desc id="d-desc">Step 1 LABEL leads to step 2 LABEL, which leads to step 3 LABEL.</desc>
        <defs>
          <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path class="arrowhead-fill" d="M0,0 L10,5 L0,10 z"/>
          </marker>
        </defs>

        <g>
          <rect class="box" x="30" y="60" width="240" height="140" rx="14"/>
          <text class="num" x="50" y="92">1</text>
          <text class="label" x="150" y="128" text-anchor="middle">First step</text>
          <text class="note" x="150" y="158" text-anchor="middle">what happens</text>
          <text class="note" x="150" y="180" text-anchor="middle">and why</text>
        </g>

        <line class="arrow" x1="272" y1="130" x2="326" y2="130"/>

        <g>
          <rect class="box highlight" x="330" y="60" width="240" height="140" rx="14"/>
          <text class="num" x="350" y="92">2</text>
          <text class="label" x="450" y="128" text-anchor="middle">Key step</text>
          <text class="note" x="450" y="158" text-anchor="middle">the most</text>
          <text class="note" x="450" y="180" text-anchor="middle">important part</text>
        </g>

        <line class="arrow" x1="572" y1="130" x2="626" y2="130"/>

        <g>
          <rect class="box" x="630" y="60" width="240" height="140" rx="14"/>
          <text class="num" x="650" y="92">3</text>
          <text class="label" x="750" y="128" text-anchor="middle">Result</text>
          <text class="note" x="750" y="158" text-anchor="middle">what you</text>
          <text class="note" x="750" y="180" text-anchor="middle">end up with</text>
        </g>
      </svg>
    </div>
    <figcaption>Takeaway: one sentence that says what the picture proves.</figcaption>
  </figure>
  <ol class="key">
    <li><strong>First step</strong> - the same words as step 1 in the explanation.</li>
    <li><strong>Key step</strong> - the same words as step 2.</li>
    <li><strong>Result</strong> - the same words as step 3.</li>
  </ol>
</main>
</body>
</html>
```

## Adapting it

- Replace the title, the description, the labels and the notes. A step group is one `<g>`; add or remove one by
  shifting `x` by 300 per box and widening the `viewBox` to match.
- The highlighted box (`box highlight`) marks the one step the explanation calls the key; use it once per diagram.
- The palette meets 4.5:1 for text on every fill it sits on and 3:1 for lines and shapes on the page, in light and
  dark mode (the skill's tests measure it); a colour you change is measured again.
- The template is a straight left-to-right flow: a graph with many crossing links is split into two diagrams rather
  than drawn by hand.
