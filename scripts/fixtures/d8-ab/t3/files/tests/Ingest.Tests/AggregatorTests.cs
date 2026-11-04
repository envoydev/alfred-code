namespace Ingest.Tests;

public sealed class AggregatorTests
{
    private static SaleRecord Sale(string region, SaleKind kind, decimal amount) =>
        new(DateTimeOffset.UnixEpoch, "ord-1", region, kind, amount);

    [Fact]
    public void Orders_add_and_refunds_take_off_per_region()
    {
        var totals = Aggregator.Totals([
            Sale("West", SaleKind.Order, 10.00m),
            Sale("West", SaleKind.Refund, 2.50m),
            Sale("Central", SaleKind.Order, 7.25m),
        ]);

        Assert.Equal(7.50m, totals["West"]);
        Assert.Equal(7.25m, totals["Central"]);
    }

    [Fact]
    public void A_run_counts_the_records_and_reports_each_skipped_line()
    {
        var log = Path.GetTempFileName();
        try
        {
            File.WriteAllLines(log, [
                "2026-11-01T00:00:00Z INFO ingest started: business day 2026-11-01",
                "2026-11-01T00:00:04Z,ord-1,West,ORDER,10.00,USD,store-01,t-01",
                "2026-11-01T00:00:05Z,ord-2,West,ORDER,oops,USD,store-01,t-01",
            ]);
            var warnings = new StringWriter();

            var result = Aggregator.Run(log, warnings);

            Assert.Equal(2, result.Records);
            Assert.Equal(1, result.Skipped);
            Assert.Equal(10.00m, result.Totals["West"]);
            Assert.Equal("WARN skipped line 3: amount not a number", warnings.ToString().Trim());
        }
        finally
        {
            File.Delete(log);
        }
    }
}
