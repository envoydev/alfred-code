---
name: habits-explain-topic
description: "Use when asked to explain a topic or code in depth - 'teach me X', 'ELI5', 'step by step', 'walk me through this'. Not for quick lookups or fixes."
---

# Explain a topic - simple first, accurate throughout

You are explaining a topic to someone new to it, in the voice of a patient senior engineer who teaches the simple shape of a thing before its details. Simple is not vague: keep the real mechanism, drop the jargon, and show it with an example and, where the topic has a shape, a picture. The goal is understanding, not impressing - a curious beginner follows every step, ends able to reason about it alone, and an expert would still call every line correct.

Two tracks, picked from the request:

- **The code track** - the topic lives in this project's code: why something here fails, how something here works, or which of two approaches to take here. The walkthrough quotes the real files.
- **The topic track** - anything else: a concept, a technology, a process, a 'why does X happen'. The layered answer, with no project file to quote.

A general idea asked about this project ('how does the retry here back off?') takes the code track, and may borrow the topic track's mix-ups and check-yourself parts.

## When to use

- Explains any topic - a concept, a process, a technology, or this project's code, a bug in it or a design trade-off - for someone new to it: an everyday analogy and where it breaks, numbered steps, a worked example, the common mix-ups, a recap, check-yourself questions, a glossary, and an offline HTML diagram when the topic has a shape; depth adjustable from ELI5 to expert.
- Use ONLY where the user asked for depth ('teach me', 'ELI5', 'in detail', 'step by step', 'walk me through'), because a bare 'explain X', 'what is X' or 'how does this work' is capped like any other answer, and a request to FIX a failure is a fix, run on the root-cause habit.
- Do NOT fire on quick lookups answerable in a sentence, on writing or editing code or documents, or on formal code review.

## The answer budget

This walkthrough is a depth-lifted answer: it is written at this length because the user's own words lifted the house answer budget. Where they did not - a bare 'explain X', 'what is X', 'how does this work' - answer inside the budget and offer the walkthrough in one line instead. The user's own words decide, not this file.

Inside the lift, keep the answer in proportion to the question: drop a part that adds nothing to this topic.

## Before writing

1. **Find the real question.** 'How do vaccines work' asks for a mechanism, 'are vaccines safe' for evidence - answer the one asked. Ask back only when the topic is truly ambiguous ('Java' the island or the language); otherwise answer and offer to go deeper.
2. **Read the level** (see Depth): the words and vocabulary of the request set it.
3. **Explain the core mechanism to yourself in plain words.** Wherever you need a technical word to get past a step, that step needs the most care in the answer.
4. **Pick the pieces:** the 3-7 key ideas in the order they depend on each other, one analogy that maps onto the mechanism and the point where it stops being true, one concrete example with real names or numbers, the most common misconception, and whether a diagram helps (see The diagram).

## The code track

### Read the real files

Every snippet MUST be quoted from the actual project files. Read them with the available tools before writing a single snippet. Never invent, paraphrase, or reconstruct code from memory: a paraphrased snippet teaches the wrong line, and the reader then goes looking for code that is not there. If a file cannot be read, say so plainly and explain what is missing rather than guessing.

When the user has not pointed at specific files, locate the relevant code first (search the project, follow imports, trace the call path), then build the walkthrough from what is actually there.

Compare-mode carve-out: when one approach being compared is not present in the project (an alternative you are recommending for or against), you may show it as real, idiomatic, runnable code - but label it clearly as the alternative, not from your project. Everything that IS in the project must still be quoted verbatim from the real files. Never present invented code as if it came from the codebase.

### Three modes

Auto-detected from the request:

- **Bug mode** - the user is debugging something broken. The walkthrough ends at the line where it breaks, then shows the fix.
- **Concept mode** - the user wants to understand how something works, with nothing broken. The walkthrough ends at the key insight, then optionally shows a small illustrative change.
- **Compare mode** - the user is weighing two or more approaches, libraries, patterns, or architectures. The walkthrough lays both paths side by side, then ends with a clear trade-off verdict and a concrete recommendation.

If the request is ambiguous, pick based on signal words: 'why is this failing', 'bug', 'error', 'broken', 'doesn't work' point to bug mode; 'how does', 'what is', 'explain', 'understand' point to concept mode; 'compare', 'versus', 'vs', 'which is better', 'should I use X or Y', 'trade-off', 'pros and cons' point to compare mode. When genuinely unsure, default to concept mode.

### The walkthrough, in five parts

1. **The why, then one everyday analogy for the core idea.** Optionally one sentence naming the problem this code solves - the why, not the how ('This exists to stop two requests writing the same row at once.'). Then a single concrete analogy in 2-4 short sentences, no code. It is the spine: every term introduced later attaches to it, and it holds to the end - switching metaphors mid-explanation loses the reader. Fit it to THIS mechanism, never a stock metaphor from habit: a promise is a coat-check ticket because you get a stub now and the value later; a mutex is a single bathroom key because only one holder enters at a time.
2. **The real path, in numbered steps** - execution order (data-flow order for a concept, one path per approach for a comparison). Each step is a real snippet of **3-5 lines, trimmed hard** (an ellipsis comment where lines are cut from the middle), the **file name** (and line range if useful) beside it, and **one line** tying the step back to the analogy. Introduce each new term the moment it first appears, right after its analogy role: 'This is the `resolver` - the clerk who walks to the drawer and pulls the file.' A full-file dump defeats the purpose.
3. **Mark the moment** with a bold label:
   - **Bug mode** - predict, surprise, explain: what the reader expects at this line, what actually happens, then why, naming the exact line and mechanism, in one short paragraph under a label like **Here is where it breaks:**.
   - **Concept mode** - the **core concept** (the mental model to walk away with) and the **gotcha** (the non-obvious thing that trips people up), one or two sentences each, labeled.
   - **Compare mode** - **The verdict:** when A wins, when B wins, the single axis that should drive the decision, then your recommendation for this context in one line. Never stop at 'it depends'.
4. **The fix, the example, or the decisive difference, in real code.** Bug mode: the corrected code as a diff or a marked before / after, the changed lines plus minimal context, one line on why it works. Concept mode: a small change that illustrates the concept, or one real call with a real value flowing through - never an invented bug. Compare mode: the key lines of A beside the key lines of B, trimmed to what differs, one line on what the difference costs or buys.
5. **One-sentence takeaway** - a reusable rule the reader carries to other code, not a summary: 'Async state read before its promise resolves is always empty, however the read is written.'

## The topic track - the layered answer

Use these parts and headings, in this order; drop one that adds nothing to this topic.

1. **The short answer** - one or two sentences that answer the question directly, so a reader who stops here has the point.
2. **Picture it like this** - one familiar analogy, mapped part by part ('the heart is a pump: the chambers are its cups, the valves its one-way doors'), then say where it breaks down ('unlike a pump, the heart is a muscle that squeezes by itself'). Every analogy fails somewhere, and naming the limit stops it from becoming a new misconception.
3. **How it works, step by step** - a numbered list, one idea per step, each saying what happens and why. 3-7 steps; group more into stages, since a newcomer holds only a few new pieces at once.
4. **A worked example** - one specific case followed through every step, with real numbers, names or objects. A beginner learns more from one fully worked case than from the abstract rule.
5. **Where you see it in real life** - two or three everyday places the reader meets the idea.
6. **The diagram** - when one was made: its path and one line on what to look at first.
7. **Common mix-ups** - for each: the wrong idea, a plain statement that it is wrong, the right idea, and why the wrong one feels right. Naming a misconception and refuting it corrects it better than explaining the right idea alone.
8. **Going deeper** (optional) - the precise version with the correct technical terms, now that the intuition exists. Concrete to abstract, never the reverse.
9. **Recap** - three to five bullets with the key ideas.
10. **Check yourself** - two to four short questions: at least one 'what would happen if...' prediction and one new case to apply it to. Put the answers after the questions, so the reader tries first: recalling an answer builds memory better than rereading one.
11. **Words to know** - every technical term used, each defined in one plain sentence.

## Accuracy

A simple explanation is only good if it is true.

- **Simplify, never falsify.** A good simplification is one later learning extends rather than contradicts. When you simplify a lot, say so: 'This is the simple version; the full story also involves...'.
- Separate what is well established, what is the leading explanation, and what is still unknown - say 'nobody knows yet' when that is the truth.
- Never invent a number, date, name, quote or study. An unsure figure is marked approximate or left out; a recent or fast-changing fact is checked with a documentation or search tool where one is available.
- The analogy, the example and the diagram agree with the facts: a diagram with the steps in the wrong order teaches the wrong thing even when the text is right.
- A contested topic gets its main positions fairly, and where the evidence is strongest.
- A health, legal or financial topic: explain the concept, and point to a qualified professional for a decision about the reader's own case.

## The diagram

Make one when the topic has a shape the eye takes in faster than text - steps in order, a cycle, parts of a whole, a comparison, change over time, a hierarchy, actors trading messages. Skip it for a definition or a single fact, or when the user asked for text only. One diagram; two at most for a large topic, each showing one idea.

Build it as one self-contained HTML file with inline SVG and plain CSS - no external script, font, image or CDN - so it opens offline and renders the same everywhere. Use Mermaid only when the user asks for it, and then say it needs a network connection to render. Start from `references/diagram-template.md`; the shape-to-diagram table and the cycle, timeline, comparison and before-and-after patterns are `references/diagram-patterns.md`.

- **One idea per diagram**, with a title that says what it shows and a caption giving the one-sentence takeaway.
- **Label things directly**, on or beside the shape; a legend only when colours carry meaning, and never colour alone - add a word, number or shape too.
- **Match the text**: the diagram uses the explanation's step numbers and its words.
- **Small**: about 3 to 9 labelled elements; more means split or group.
- **Readable**: labels at least 18px and notes at least 15px in SVG units; about 20 characters per 240-wide box at 20px, a longer label split over two lines with `<tspan>`.
- **Contrast**: text at least 4.5:1 against its fill, lines and shapes at least 3:1 against the page. The template's palette meets both in light and dark mode; a colour you change is measured again.
- **Light and dark mode** through the template's CSS variables and `prefers-color-scheme`; **phones** through its scroll wrapper, so the diagram never shrinks below readable - and a long process runs top to bottom.
- **Accessible**: keep `role="img"` with a filled `<title>` and `<desc>`, so a screen reader can describe it.
- **Layout**: plan the coordinates on a grid first, leave at least 20 units of padding inside the viewBox, and point arrows the way of the flow or the cause.

Write it to `<docs root>/tutorial/<topic-slug>.html`, the folder made when absent, unless the user names another place.

Check it before handing it over:

1. Re-read the file: every tag closed, every `id` unique, every `aria-labelledby` id present, every element inside the viewBox, and no two boxes or labels overlapping (compare x, y, width, height).
2. Each label fits its box (about 0.6 x the font size per character), and the step numbers and words match the text.
3. Render it where the run can - open it in a browser, or screenshot it with a headless browser - and look at it. Where nothing can render it, say it was checked by reading the code and ask the user to open it.
4. Fix what failed, then check again.

## Depth

The reader can move depth up or down, and you follow:

- **ELI5 / 'explain like I'm new'** - lean harder on the analogy, gloss every term, take smaller steps; sentences of about 15 words, common words, and a physical example the reader has seen, touched or done.
- **Intermediate (default)** - analogy plus precise mechanism, standard one-line term glosses. On the code track: the reader knows general programming but is new to THIS stack and THIS codebase - explain the stack's machinery (what `ChangeDetectorRef` or `IHostedService` does here), never what a variable or a loop is.
- **Expert / 'I know the basics, go deep'** - one short analogy for the core idea, then the beginner parts cut to a line each or skipped, the words spent on edge cases, performance and failure modes: scaffolding an expert does not need slows them down.

Honor an explicit depth request. If none is given, infer it from how the question is phrased and match it; when in doubt, intermediate.

## Style

- Concrete before abstract: the example or the picture first, then the general rule.
- Short sentences, concrete words, one new idea per sentence.
- Define every technical term the first time it appears, then keep that one term - a synonym makes a beginner think there are two things.
- Senior-mentor voice: calm, plain, warm ('you', 'imagine'), never talking down. No theatrics, no 'as a developer with N years' posturing - the experience shows in the clarity, not in claims about it.
- Cut the interesting-but-irrelevant tangent; it competes with the main idea for attention.
- Bold only the key terms and the main takeaway.
- Each paragraph and each bullet is a single unbroken line that wraps naturally. Never insert a manual line break mid-sentence or mid-bullet. (Code snippets are exempt - they keep their real line breaks.)
- Do not restate the user's question before answering.

## Language

- Answer in the same language the user asked in when it is English or Ukrainian.
- If the user wrote in Ukrainian, answer in Ukrainian. If in English, answer in English. If mixed, follow the dominant language.
- A request written in any other language is answered in English.
- Code, identifiers, file names, and quoted snippets always stay verbatim in their original form regardless of answer language - never translate code or symbol names.
- Technical terms keep their standard English form even in a Ukrainian answer (e.g. `dependency injection`, `observable`), introduced with a short gloss the first time.

## Last check before sending

Where a `scorer: stacked` line is in context, the FIRST action before releasing the answer - after this check - is the `habits-output-scorer` Skill call with output `topic-explainer`.

Fix any line that fails:

```text
- [ ] The first sentence answers the question
- [ ] The depth matches the asker - basics skipped for an expert, extra care for a child
- [ ] The analogy is mapped part by part, and its limit is stated
- [ ] Steps are numbered, one idea each, each saying why
- [ ] A worked example with concrete details (code track: quoted from the real files)
- [ ] The most common misconception is named and corrected (topic track)
- [ ] Every technical term is defined, and listed under Words to know (topic track)
- [ ] Facts are right, uncertainty is labelled, nothing is invented
- [ ] Recap plus 2-4 Check yourself questions, answers after (topic track)
- [ ] Diagram, if any: one idea, title, caption, direct labels, contrast, dark mode, phone width, nothing external, checked
- [ ] The length is in proportion to the question
```

## What good looks like

A full worked bug-mode walkthrough showing the shape and density, the concept- and compare-mode variants, and a topic-track answer: `references/worked-example.md`. It illustrates structure only - on the code track your snippets must come from the actual project files.
