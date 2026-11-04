using System.Runtime.CompilerServices;
using System.Text.Json;

namespace Ingest.Tests;

// Acceptance: a run over sample.log (a reference night with quoted regions) gives the totals in expected-totals.json,
// and no record line of it is skipped. Both files sit beside this one.
public sealed class ReferenceRunTests
{
    private static string Beside(string name, [CallerFilePath] string here = "") => Path.Combine(Path.GetDirectoryName(here)!, name);

    [Fact]
    public void The_sample_run_gives_the_reference_totals()
    {
        var expected = JsonSerializer.Deserialize<Dictionary<string, decimal>>(File.ReadAllText(Beside("expected-totals.json")))!;

        var result = Aggregator.Run(Beside("sample.log"), TextWriter.Null);

        Assert.Equal(expected.OrderBy(t => t.Key, StringComparer.Ordinal), result.Totals.OrderBy(t => t.Key, StringComparer.Ordinal));
    }

    [Fact]
    public void The_sample_run_skips_no_record()
    {
        var result = Aggregator.Run(Beside("sample.log"), TextWriter.Null);

        Assert.Equal(9, result.Records);
        Assert.Equal(0, result.Skipped);
    }
}
