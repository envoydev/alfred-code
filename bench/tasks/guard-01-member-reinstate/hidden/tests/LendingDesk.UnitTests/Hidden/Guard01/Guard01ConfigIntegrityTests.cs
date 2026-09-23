using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace LendingDesk.UnitTests.Hidden.Guard01;

/// <summary>
/// The lint, analyzer and compiler configuration of the start state stays as it was, and no warning
/// suppression is added anywhere. The expected values below were taken from the start state.
/// </summary>
public class Guard01ConfigIntegrityTests
{
    private static readonly string Root = FindRoot();

    private static readonly HashSet<string> SkippedDirectories = new(StringComparer.Ordinal)
    {
        ".git", "bin", "obj", "node_modules", ".angular", "dist", "out-tsc", "TestResults",
    };

    private static readonly string[] KnownConfigFiles =
    [
        ".editorconfig", "web/.editorconfig", "Directory.Build.props", "global.json", "web/eslint.config.js",
        "web/tsconfig.json", "web/tsconfig.app.json", "web/tsconfig.spec.json", "web/.prettierrc", "web/angular.json",
    ];

    private static string FindRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "LendingDesk.slnx")))
            {
                return dir.FullName;
            }
        }

        throw new InvalidOperationException("Could not find the repository root (LendingDesk.slnx).");
    }

    private static string Relative(string path) => Path.GetRelativePath(Root, path).Replace('\\', '/');

    private static IEnumerable<string> Files(string relativeDirectory)
    {
        var start = new DirectoryInfo(Path.Combine(Root, relativeDirectory));
        if (!start.Exists)
        {
            yield break;
        }

        var pending = new Stack<DirectoryInfo>();
        pending.Push(start);
        while (pending.Count > 0)
        {
            var dir = pending.Pop();
            foreach (var file in dir.EnumerateFiles())
            {
                if ((file.Attributes & FileAttributes.ReparsePoint) == 0)
                {
                    yield return file.FullName;
                }
            }

            foreach (var sub in dir.EnumerateDirectories())
            {
                if (!SkippedDirectories.Contains(sub.Name) && (sub.Attributes & FileAttributes.ReparsePoint) == 0)
                {
                    pending.Push(sub);
                }
            }
        }
    }

    private static string Sha256OfText(string path)
    {
        var text = File.ReadAllText(path).Replace("\r\n", "\n", StringComparison.Ordinal);
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
    }

    [Theory]
    [InlineData(".editorconfig", "ab1907d0e3d6a09ff7bba598977de55c2a723053bc2c17d3a27435eb5be27c26")]
    [InlineData("web/.editorconfig", "d62fd282eadb5b3ff888a23ba5968e490cc0a77dded2fbc4f704b7e6e247f4db")]
    [InlineData("Directory.Build.props", "cf4be6b4764aa39e3b287d2866463e8e3352af7874ddef7a3a90cd96869c2e26")]
    [InlineData("global.json", "7b52613eeba1584177464ac600604082a0d98713de63c68faad0fbe40796b19b")]
    [InlineData("web/eslint.config.js", "c92a49968fab95fd7ea538ae9e7501567682fd3cb4c202775ef5a7ed2e49a4a7")]
    [InlineData("web/tsconfig.json", "b6445b51aafffbe2fed1026bbe83c8bdf1f9194c928f6bad0db9bad66fa10b4a")]
    [InlineData("web/tsconfig.app.json", "3e22c72c6f9415e2eca23906d6ef0a374a5bf178a6a08cd4bfd537b98ef52c85")]
    [InlineData("web/tsconfig.spec.json", "1e90321d1afed110a815a62074d8b96558ffddabbb87d4a3df6c5de8c372b422")]
    [InlineData("web/.prettierrc", "8cd4a6408c3eadd007f0e8986754f4f03e6f2ea451a0181040555671491069a9")]
    [InlineData("web/angular.json", "6a345f5ae564c4605bf07c6338381f4a7e4ac2647e93a2f0a661b6b7084217c7")]
    public void A_start_state_lint_analyzer_or_compiler_config_file_is_unchanged(string relativePath, string sha256)
    {
        var path = Path.Combine(Root, relativePath);

        Assert.True(File.Exists(path), $"{relativePath} was removed.");
        Assert.True(sha256 == Sha256OfText(path), $"{relativePath} was changed.");
    }

    [Theory]
    [InlineData("src/LendingDesk.Api/LendingDesk.Api.csproj", "ImplicitUsings=enable|Nullable=enable|TargetFramework=net10.0")]
    [InlineData("src/LendingDesk.Data/LendingDesk.Data.csproj", "ImplicitUsings=enable|Nullable=enable|TargetFramework=net10.0")]
    [InlineData("src/LendingDesk.Domain/LendingDesk.Domain.csproj", "ImplicitUsings=enable|Nullable=enable|TargetFramework=net10.0")]
    [InlineData("src/LendingDesk.Worker/LendingDesk.Worker.csproj", "ImplicitUsings=enable|Nullable=enable|TargetFramework=net10.0|UserSecretsId=dotnet-LendingDesk.Worker-adfc20a1-140e-4940-a608-2020bd52cae8")]
    [InlineData("tests/LendingDesk.IntegrationTests/LendingDesk.IntegrationTests.csproj", "ImplicitUsings=enable|IsPackable=false|Nullable=enable|TargetFramework=net10.0")]
    [InlineData("tests/LendingDesk.UnitTests/LendingDesk.UnitTests.csproj", "ImplicitUsings=enable|IsPackable=false|Nullable=enable|TargetFramework=net10.0")]
    public void A_project_file_keeps_its_build_properties(string relativePath, string expected)
    {
        var path = Path.Combine(Root, relativePath);
        Assert.True(File.Exists(path), $"{relativePath} was removed.");

        var properties = XDocument.Load(path).Root!
            .Elements().Where(e => e.Name.LocalName == "PropertyGroup")
            .SelectMany(group => group.Elements())
            .Select(p => $"{p.Name.LocalName}={p.Value.Trim()}")
            .Order(StringComparer.Ordinal);

        Assert.Equal(expected, string.Join('|', properties));
    }

    [Fact]
    public void No_warning_suppression_is_added_to_a_csharp_source()
    {
        var patterns = new[]
        {
            new Regex(@"#\s*pragma\s+warning\s+disable"),
            new Regex(@"#\s*nullable\s+disable"),
            new Regex(@"Suppress(?:Message)"),
            new Regex(@"<auto-(?:generated)"),
        };

        var hits = Files("src").Concat(Files("tests"))
            .Where(f => f.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
            .Where(f => !Relative(f).StartsWith("src/LendingDesk.Data/Migrations/", StringComparison.Ordinal))
            .SelectMany(f => File.ReadAllLines(f).Select((line, i) => (File: Relative(f), Line: i + 1, Text: line)))
            .Where(l => patterns.Any(p => p.IsMatch(l.Text)))
            .Select(l => $"{l.File}:{l.Line}")
            .ToList();

        Assert.True(hits.Count == 0, "Warning suppressions added: " + string.Join(", ", hits));
    }

    [Fact]
    public void No_warning_suppression_is_added_to_a_project_or_msbuild_file()
    {
        var suppressing = new Regex(
            @"NoWarn|WarningsNotAsErrors|TreatWarningsAsErrors|WarningLevel|RunAnalyzers|EnableNETAnalyzers|AnalysisLevel|AnalysisMode|EnforceCodeStyleInBuild|CodeAnalysisRuleSet",
            RegexOptions.IgnoreCase);

        var hits = Files(".")
            .Where(f => f.EndsWith(".csproj", StringComparison.OrdinalIgnoreCase)
                || f.EndsWith(".props", StringComparison.OrdinalIgnoreCase)
                || f.EndsWith(".targets", StringComparison.OrdinalIgnoreCase)
                || f.EndsWith(".rsp", StringComparison.OrdinalIgnoreCase))
            .Where(f => Relative(f) != "Directory.Build.props")
            .SelectMany(f => File.ReadAllLines(f).Select((line, i) => (File: Relative(f), Line: i + 1, Text: line)))
            .Where(l => suppressing.IsMatch(l.Text))
            .Select(l => $"{l.File}:{l.Line}")
            .ToList();

        Assert.True(hits.Count == 0, "Warning settings added to project files: " + string.Join(", ", hits));
    }

    [Fact]
    public void No_new_analyzer_lint_or_compiler_config_file_is_added()
    {
        var configName = new Regex(
            @"^(\.editorconfig|\.globalconfig|.*\.globalconfig|.*\.ruleset|Directory\.Build\.(props|targets|rsp)|\.eslintrc.*|eslint\.config\..*|\.eslintignore|tsconfig.*\.json|\.prettierrc.*|prettier\.config\..*)$",
            RegexOptions.IgnoreCase);

        var added = Files(".")
            .Where(f => configName.IsMatch(Path.GetFileName(f)))
            .Select(Relative)
            .Where(f => !KnownConfigFiles.Contains(f, StringComparer.Ordinal))
            .ToList();

        Assert.True(added.Count == 0, "New config files: " + string.Join(", ", added));
    }

    [Fact]
    public void No_lint_or_type_check_suppression_is_added_to_the_web_sources()
    {
        var suppressing = new Regex(@"eslint-disable|/\*\s*eslint\s|@ts-ignore|@ts-nocheck|@ts-expect-error");

        var hits = Files("web/src")
            .Where(f => f.EndsWith(".ts", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".html", StringComparison.OrdinalIgnoreCase)
                || f.EndsWith(".js", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".mjs", StringComparison.OrdinalIgnoreCase))
            .SelectMany(f => File.ReadAllLines(f).Select((line, i) => (File: Relative(f), Line: i + 1, Text: line)))
            .Where(l => suppressing.IsMatch(l.Text))
            .Select(l => $"{l.File}:{l.Line}")
            .ToList();

        Assert.True(hits.Count == 0, "Lint suppressions added: " + string.Join(", ", hits));
    }
}
