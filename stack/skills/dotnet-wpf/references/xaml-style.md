# XAML style: formatting, attribute ordering, naming, and binding conventions

The concrete XAML *writing* style the WPF architecture in `SKILL.md` does not cover: how XAML is formatted and ordered, `x:Name` vs `Name`, attribute vs property-element syntax, namespace prefixes, value-converter naming, and data-binding style. The C# naming baseline (PascalCase/`_camelCase`/`I`-prefix, the canonical `.editorconfig`) is the `csharp` skill's style reference; the WPF architecture (strict MVVM, dependency/attached properties, CommunityToolkit.Mvvm) is this skill's `SKILL.md`. A project's own config - its `Settings.XamlStyler`, `.editorconfig`, `stylecop.json` - and its `<docs-path>/code-style/CODE-STYLE.md` are HIGHER priority: where a project diverges, follow the project.

## There is no official XAML formatter - use XAML Styler
Microsoft ships no XAML *formatting* spec, so the de-facto standard is **XAML Styler** (Xavalon/XamlStyler: a Visual Studio / VS Code extension plus the `xstyler.exe` CLI). Commit one config named `Settings.XamlStyler` (JSON) at the solution root - it is discovered up the folder hierarchy, so a subdirectory can override it. Enable format-on-save, and run `xstyler.exe` in check-only mode in CI to fail the build on non-conforming XAML. Rider/ReSharper couples XAML formatting to its XML formatter (less granular), so prefer XAML Styler for XAML and `.editorconfig` for C#.

## Attribute ordering (XAML Styler default groups)
Order attributes top-to-bottom by these groups, alphabetically within the last catch-all group:

1. `x:Class`
2. `xmlns`, `xmlns:x`
3. `xmlns:*`
4. `x:Key`, `x:Name` (and `Key`/`Name`), `x:Uid`, `Title`
5. attached layout: `Grid.Row`, `Grid.RowSpan`, `Grid.Column`, `Grid.ColumnSpan`, `Canvas.Left/Top/Right/Bottom`
6. size: `Width`, `Height`, `MinWidth/Height`, `MaxWidth/Height`
7. box model: `Margin`, `Padding`, `HorizontalAlignment`, `VerticalAlignment`, `*ContentAlignment`, `Panel.ZIndex`
8. everything else (`*:*`, `*`), then by name
9. shape/animation targets: `Color`, `TargetName`, `Property`, `Value`, `StartPoint`, `EndPoint`, ...
10. `mc:Ignorable`, `d:*`
11. `Storyboard.*`, `From`, `To`, `Duration`

Default formatting values: `AttributesTolerance: 2`, `MaxAttributesPerLine: 1`, `KeepFirstAttributeOnSameLine: false` - in practice, **one attribute per line once an element has more than two attributes**.

**Some ordering is semantic, not cosmetic** - encode these as custom ordering rules so the formatter keeps them:
- `Style` must come AFTER `x:Key`.
- A property that overrides a style value must come AFTER the `Style` reference, or the style overwrites it.
- `ItemsSource` before `SelectedItem`; `CommandParameter` before `Command`.

## Namespace prefixes
Conventional prefixes: `x` (the XAML language), `d` (design-time, the blend/2008 schema), `mc` (markup compatibility), `local` (the current assembly's CLR namespace). The `d:` attributes and `mc:Ignorable` are stripped from compiled output and serve the designer only - use `d:DataContext` for design-time IntelliSense that compiles out.

## `x:Name` vs `Name`
They are interchangeable when the element has a framework `Name` property (a `FrameworkElement`); `x:Name` works for ALL XAML elements (storyboards, transforms, and other timeline types that have no `Name` property). Setting both on one element throws a parse exception. Use `x:Name` uniformly for consistency - but in MVVM, **minimize named elements entirely**: bind to ViewModel properties instead of naming controls and reaching them from code-behind.

## Attribute vs property-element syntax
Use attribute syntax for simple values the parser type-converts (`Background="Red"`). Use property-element syntax (`<Button.Background>...</Button.Background>`) when the value is a complex object - a brush with an image, a template, or nested content.

## Data-binding style
- Set `DataContext` at the view root; bind to ViewModel properties rather than wiring in code-behind.
- Put `x:DataType` / `DataType` on a `DataTemplate` to get compiled-binding validation and rename-safety (subject to this skill's stance on where `x:DataType` earns its keep).
- Prefer `StaticResource` over `DynamicResource` where the value does not change at runtime - `DynamicResource` carries real lookup overhead. (Resource-dictionary organization and the theme-switch cases are in `references/styling-theming.md`.)

## Value converters
- Implement `IValueConverter` (`Convert`/`ConvertBack`) or `IMultiValueConverter`.
- Name it `<Source>To<Target>Converter` - `BooleanToVisibilityConverter`, `BytesToHumanSizeConverter`.
- Decorate the class with `[ValueConversion(typeof(TSource), typeof(TTarget))]` so tooling knows the types.
- On failure return `DependencyProperty.UnsetValue` or `Binding.DoNothing`, never throw - the binding engine does not catch converter exceptions. Making the converter a `MarkupExtension` (its `ProvideValue` returns `this`) lets it be used inline without a resource declaration.

## Resource keys
Adopt a consistent resource-key naming scheme and hold to it (for example a role-then-variant shape: `PrimaryButton`, `DangerButton`). The dictionary organization itself - one dictionary per concern, a flat `MergedDictionaries` hierarchy - is `references/styling-theming.md`'s.
