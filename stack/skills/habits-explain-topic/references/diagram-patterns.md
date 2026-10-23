# Diagram patterns

Which diagram fits a topic's shape, and the snippets for the shapes the template's left-to-right flow does not
draw. Every pattern reuses the template's page shell, CSS variables, arrow marker and classes
(`references/diagram-template.md`): paste an SVG snippet inside the template's `<svg>` in place of its step groups, or
an HTML-only one inside `<main>`, then update the `viewBox`, the `<title>` and the `<desc>`.

## Contents

- Shape to diagram
- Cycle (a repeating loop)
- Timeline (events over time)
- Comparison table (options side by side)
- Before and after panels (what changes)

## Shape to diagram

| Topic shape | Diagram | Example |
|---|---|---|
| Steps in order | Flowchart or numbered step boxes (the template) | How a letter gets delivered |
| A repeating loop | Cycle | The water cycle |
| Who sends what to whom, in time order | Sequence diagram - numbered step boxes per actor | What happens when you open a website |
| Groups and sub-groups | Tree or hierarchy | How living things are classified |
| A physical thing with parts | Labelled illustration | Parts of a plant cell |
| Two or more options side by side | Comparison table | Viruses vs bacteria |
| Events over time | Timeline | The history of flight |
| What changes because of something | Before and after panels | What a vaccine changes in the body |
| Sizes or amounts | Proportional bars | How much of Earth's water is fresh |

## Cycle

`viewBox="0 0 640 600"`, four stages placed top, right, bottom and left.

```html
<rect class="box" x="230" y="50" width="180" height="80" rx="14"/>
<text class="label" x="320" y="97" text-anchor="middle">Stage 1</text>
<rect class="box" x="440" y="260" width="180" height="80" rx="14"/>
<text class="label" x="530" y="307" text-anchor="middle">Stage 2</text>
<rect class="box" x="230" y="470" width="180" height="80" rx="14"/>
<text class="label" x="320" y="517" text-anchor="middle">Stage 3</text>
<rect class="box" x="20" y="260" width="180" height="80" rx="14"/>
<text class="label" x="110" y="307" text-anchor="middle">Stage 4</text>
<path class="arrow" d="M412,90 Q530,90 530,256"/>
<path class="arrow" d="M530,344 Q530,510 414,510"/>
<path class="arrow" d="M228,510 Q110,510 110,344"/>
<path class="arrow" d="M110,256 Q110,90 226,90"/>
<text class="note" x="320" y="305" text-anchor="middle">repeats again and again</text>
```

## Timeline

`viewBox="0 0 900 220"`. Space the events evenly unless the real gaps matter; where they do, space them in proportion
and say so in the caption.

```html
<line class="arrow" x1="40" y1="110" x2="860" y2="110"/>
<circle class="box highlight" cx="120" cy="110" r="9"/>
<text class="num" x="120" y="80" text-anchor="middle">YEAR</text>
<text class="note" x="120" y="145" text-anchor="middle">First event</text>
<circle class="box" cx="340" cy="110" r="9"/>
<text class="num" x="340" y="80" text-anchor="middle">YEAR</text>
<text class="note" x="340" y="145" text-anchor="middle">Second event</text>
<circle class="box" cx="560" cy="110" r="9"/>
<text class="num" x="560" y="80" text-anchor="middle">YEAR</text>
<text class="note" x="560" y="145" text-anchor="middle">Third event</text>
<circle class="box" cx="780" cy="110" r="9"/>
<text class="num" x="780" y="80" text-anchor="middle">YEAR</text>
<text class="note" x="780" y="145" text-anchor="middle">Fourth event</text>
```

## Comparison table

HTML only, no SVG. The difference people care about most goes in the first row.

```html
<style>
  table.compare { border-collapse: collapse; width: 100%; font-size: 1rem; }
  table.compare th, table.compare td { border: 2px solid var(--box-stroke); padding: 10px 12px; text-align: left; vertical-align: top; }
  table.compare thead th { background: var(--box); }
  .table-wrap { overflow-x: auto; }
</style>
<div class="table-wrap">
  <table class="compare">
    <caption>Option A vs Option B at a glance</caption>
    <thead><tr><th scope="col">Feature</th><th scope="col">Option A</th><th scope="col">Option B</th></tr></thead>
    <tbody>
      <tr><th scope="row">Most important difference</th><td>...</td><td>...</td></tr>
      <tr><th scope="row">Size</th><td>...</td><td>...</td></tr>
      <tr><th scope="row">Everyday example</th><td>...</td><td>...</td></tr>
    </tbody>
  </table>
</div>
```

## Before and after panels

HTML and a CSS grid: side by side on a wide screen, stacked on a phone.

```html
<style>
  .panels { display: grid; grid-template-columns: 1fr; gap: 16px; }
  @media (min-width: 640px) { .panels { grid-template-columns: 1fr 1fr; } }
  .panel { border: 2px solid var(--box-stroke); border-radius: 14px; padding: 16px; background: var(--box); }
  .panel.after { border-color: var(--accent); background: var(--accent-bg); }
  .panel h2 { margin: 0 0 8px; font-size: 1.2rem; }
</style>
<div class="panels">
  <section class="panel"><h2>Before</h2><p>What it is like without the thing.</p></section>
  <section class="panel after"><h2>After</h2><p>What changes, and why.</p></section>
</div>
```
