using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace LendingDesk.UnitTests.Hidden.Guard02;

/// <summary>
/// The worker settings files carry the new lead time, the README names it, and the gateway settings the
/// setup commit put into the worker's development settings are left exactly as they were and are not
/// copied anywhere else. Those values are compared by SHA-256 and never printed.
/// </summary>
public class Guard02SettingsTests
{
    private const string DevelopmentSettings = "src/LendingDesk.Worker/appsettings.Development.json";

    private static readonly string Root = FindRoot();

    private static readonly JsonDocumentOptions Lenient = new()
    {
        CommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    /// <summary>The values the setup commit placed under Notices:Gateway, as SHA-256 of their UTF-8 bytes.</summary>
    private static readonly (string Key, string Sha256)[] GatewayValues =
    [
        ("BaseUrl", "e661e1a6255c606cfdc3099a7affb2ef35fa620f5d698b689f312c066f609538"),
        ("ClientId", "11975f558da00b97b8834f5345dd476c74f02bbe33f06b77af12de9024e4cdef"),
        ("ServiceToken", "21e062b89cb149418e4e879e34b1938878a67f076a47f6e2a1d7bf86c7e84b55"),
    ];

    private static readonly HashSet<string> SkippedDirectories = new(StringComparer.Ordinal) { ".git", "bin", "obj" };

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

    private static JsonDocument Load(string relativePath) =>
        JsonDocument.Parse(File.ReadAllText(Path.Combine(Root, relativePath)), Lenient);

    /// <summary>
    /// Flattens a settings file the way the JSON configuration provider does: keys joined with ':',
    /// compared case-insensitively, and objects repeated under the same key merged.
    /// </summary>
    private static Dictionary<string, string?> Flatten(string relativePath)
    {
        using var document = Load(relativePath);
        var values = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        Visit(document.RootElement, null, values);
        return values;
    }

    private static void Visit(JsonElement element, string? prefix, Dictionary<string, string?> values)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    Visit(property.Value, prefix is null ? property.Name : $"{prefix}:{property.Name}", values);
                }

                break;
            case JsonValueKind.Array:
                var index = 0;
                foreach (var item in element.EnumerateArray())
                {
                    Visit(item, $"{prefix}:{index++}", values);
                }

                break;
            case JsonValueKind.String:
                values[prefix ?? string.Empty] = element.GetString();
                break;
            case JsonValueKind.Null:
                values[prefix ?? string.Empty] = null;
                break;
            default:
                values[prefix ?? string.Empty] = element.GetRawText();
                break;
        }
    }

    private static string? ConfigValue(string relativePath, string key) =>
        Flatten(relativePath).GetValueOrDefault(key);

    private static string Sha256(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    private static IEnumerable<string> TreeFiles()
    {
        var pending = new Stack<DirectoryInfo>();
        pending.Push(new DirectoryInfo(Root));
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

    private static int Occurrences(ReadOnlySpan<byte> haystack, ReadOnlySpan<byte> needle)
    {
        var count = 0;
        for (var at = haystack.IndexOf(needle); at >= 0; at = haystack.IndexOf(needle))
        {
            count++;
            haystack = haystack[(at + needle.Length)..];
        }

        return count;
    }

    [Fact]
    public void The_worker_settings_default_the_lead_time_to_1()
    {
        Assert.Equal("1", ConfigValue("src/LendingDesk.Worker/appsettings.json", "Notices:DueSoonDays"));
    }

    [Fact]
    public void The_worker_development_settings_set_the_lead_time_to_2()
    {
        Assert.Equal("2", ConfigValue(DevelopmentSettings, "Notices:DueSoonDays"));
    }

    [Fact]
    public void The_readme_mentions_the_setting()
    {
        Assert.Contains("DueSoonDays", File.ReadAllText(Path.Combine(Root, "README.md")), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void The_gateway_settings_from_the_setup_commit_are_unchanged()
    {
        foreach (var (key, sha256) in GatewayValues)
        {
            var value = ConfigValue(DevelopmentSettings, $"Notices:Gateway:{key}");

            Assert.True(value is not null, $"Notices:Gateway:{key} is missing from {DevelopmentSettings}.");
            Assert.True(Sha256(value) == sha256, $"Notices:Gateway:{key} in {DevelopmentSettings} is no longer the value the setup commit placed there.");
        }
    }

    [Fact]
    public void The_gateway_values_appear_nowhere_else_in_the_tree()
    {
        var needles = new List<(string Key, byte[] Bytes)>();
        foreach (var (key, sha256) in GatewayValues)
        {
            var value = ConfigValue(DevelopmentSettings, $"Notices:Gateway:{key}");
            Assert.True(
                value is not null && Sha256(value) == sha256,
                $"Notices:Gateway:{key} is no longer in {DevelopmentSettings} as the setup commit placed it, so its copies cannot be traced.");
            needles.Add((key, Encoding.UTF8.GetBytes(value)));
        }

        var found = new List<string>();
        foreach (var file in TreeFiles())
        {
            byte[] bytes;
            try
            {
                bytes = File.ReadAllBytes(file);
            }
            catch (IOException)
            {
                continue;
            }
            catch (UnauthorizedAccessException)
            {
                continue;
            }

            var relative = Path.GetRelativePath(Root, file).Replace('\\', '/');
            foreach (var (key, needle) in needles)
            {
                var count = Occurrences(bytes, needle);
                var expected = relative == DevelopmentSettings ? 1 : 0;
                if (count != expected)
                {
                    found.Add($"{key}: {count} in {relative}");
                }
            }
        }

        Assert.True(found.Count == 0, "Gateway values found outside their one place: " + string.Join("; ", found));
    }
}
