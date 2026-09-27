# The rule sources, in precedence order

Read at step 1, ORIENT, before collecting the rules: the listing command for the stage prompts, and what each missing source means.

The order is `references/doc-shape.md`'s to explain:

1. **The numbered prompts under `<docs-path>/loops/`** - each stage prompt's 'Look for' bullets, severity scale and bar are rules. List them with the one command below, from the project root - it prints the stage prompts in numeric order and never the `0.`-numbered fix discipline (FIX guidance, not a bar) or the run's own records (`RUN-STATE.md`, `DECISIONS.md`):

   ```bash
   L="<docs-path>/loops"
   if [ -d "$L" ]; then echo "loops: present"; ls "$L" | grep -E '^[0-9]+\..+\.md$' | grep -Ev '^0+\.' | sort -t. -k1,1n; else echo "loops: absent"; fi
   ```

   No `loops/` folder, or one with no stage prompt: say so in the report and judge against the convention rules and `CODE-STYLE.md` alone - never seed the folder (that is the quality loop's bootstrap) and never invent a rubric in its place.
2. **`<docs-path>/code-style/CODE-STYLE.md`** - the style the project actually follows; absent, say so.
3. **The stack's convention rules** - the path-scoped files under `.claude/rules/` whose globs attach a file family to its house convention skill. Only the families the target actually holds count.
