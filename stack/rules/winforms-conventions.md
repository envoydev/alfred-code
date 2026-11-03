---
paths: ["**/*.Designer.cs", "**/*Form.cs", "**/*Form.*.cs"]
---

Editing a WinForms form - the designer surface or its hand-written code-behind - load
`dotnet-winforms`: the FIRST action after this rule attaches is that Skill call, before the NEXT edit
lands (a path-scoped rule attaches ON the touch, so it can never precede its own trigger) - skip the
load when it is already in context (some seats preload it); conventions are the source of truth, not
recall. Name the skill you loaded, or say it was already in context - the receipt is what makes the
load happen.

This surface rule leads that first action where the C# baseline attached on the same touch: both
skills load, `dotnet-winforms` first, and this file's list is the authority on what to load.

Governs the Form/UserControl designer surface (control serialization, resx-backed strings) - and when
the session's edit is the form's hand-written behavior (code-behind, presenter, binding, disposal),
load `dotnet-winforms` for that too; the plain C# layer stays governed by `csharp`.

A `Resources.Designer.cs` / `Settings.Designer.cs` (generated wrappers, any .NET project) or an EF
migration's `*.Designer.cs` (generated, under `Migrations/`) is not WinForms - skip, and so is a type
whose name merely ends in the letters form (a `ContactForm` DTO, a `Platform` or `Transform` class).
Skip one-line tweaks.

<!-- Maintainer note: the *Form.cs globs are the coverage fix for this rule's own code-behind clause - a Designer-only
     glob never attached on a hand-written MainForm.cs edit, so the clause telling the session to load dotnet-winforms
     for code-behind could only reach a session that had already touched a Designer file. Seeded on the winforms
     stack only, so a ContactForm.cs DTO elsewhere never sees it. -->
