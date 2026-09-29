# WinForms style: control naming, event handlers, and designer conventions

The naming/style slice the architecture rules in `SKILL.md` do not cover: how controls, event handlers, and designer files are named and organized. The C# naming baseline (PascalCase members, camelCase locals, `_camelCase` private fields, the canonical `.editorconfig`) is the `csharp` skill's style reference; the WinForms architecture (MVP passive view, DI-resolvable forms, disposal, high-DPI, virtual-mode grids) is this skill's `SKILL.md`. A project's own `.editorconfig` and its `<docs-path>/code-style/CODE-STYLE.md` are HIGHER priority: where a project diverges, follow the project.

## Control naming - the one genuinely contested area
Microsoft's Framework Design Guidelines reject Hungarian notation, but WinForms practice never fully dropped it, because the designer's generated names (`button1`, `textBox1`) are useless and the guidelines say nothing about related label/field pairs. There is no official ruling; three living schools, each internally consistent:

1. **Hungarian prefixes** (still very common): `btnSave`, `txtName`, `lblDescription`, `cboProfiles`, `lstItems`, `pnlGroup`. Upside: type-grouping in IntelliSense. Downside: rename churn when a control's type changes, and it contradicts the FDG.
2. **Suffix / logical-name-plus-type** (aligns with Microsoft casing): `SaveButton`, `NameTextBox`, `DescriptionLabel`. Rename-stable only if you use a neutral suffix (`NameField`) when the control type may change.
3. **Neutral value names**: `CountryValue` instead of `txtCountry`/`cboCountry`, so a `TextBox` becoming a `ComboBox` needs no rename.

**Recommendation: pick one and enforce it in review.** The house lean is the suffix style (`SaveButton`) for FDG alignment; accept Hungarian only if the team already uses it consistently. Whatever you pick, never ship the designer defaults (`button1`) - rename every control that code or a binding references.

## Event handler naming
- Visual Studio auto-generates `<controlName>_<EventName>` (`btnSave_Click`, `Form1_Load`). Renaming a control does NOT auto-rename its handler - use Rename (F2) refactoring so both move together, or the handler name rots against the control it serves.
- For handlers you write by hand, follow the FDG verb-phrase pattern - events are named with verbs, and before/after is present/past tense (`Painting`/`Painted`, `Closing`/`Closed`); a handler reads `On<Event>` or `<Subject><Event>`.

## Designer files
- Each Form/UserControl is a `partial class` split across your file (`Form1.cs`) and the generated `Form1.Designer.cs` (the `InitializeComponent` body, control field declarations, `+=` event wiring). Never hand-edit `InitializeComponent` in a way the designer will fight - it round-trips the file; the naming above is what makes that generated code legible.
- Keep a hand edit to one control per meaningful change, and expect DPI / default-font re-serialization churn on modern .NET (the mitigation is `modern-net.md`).
- Initialization that touches controls goes AFTER the `InitializeComponent()` call in the constructor, or in the `Load` event - not interleaved into the generated region.
- One Form per file; declare control fields in the designer file, and follow FDG capitalization for the form's own public members.

## Resource and localization hygiene
- Every user-facing string comes from a `resx` file with satellite assemblies (`Localizable = true` plus the form's `Language` property to generate per-culture resx). No hard-coded UI sentences.
- Build sentences with composite format strings, never concatenation - word order is not the same across languages.
