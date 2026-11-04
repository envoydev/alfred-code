namespace Ingest;

/// <summary>One ingest run: the totals per region, the record lines read and how many of them were skipped.</summary>
public sealed record IngestResult(IReadOnlyDictionary<string, decimal> Totals, int Records, int Skipped);

public static class Aggregator
{
    /// <summary>Totals per region: an order adds its amount, a refund takes it off.</summary>
    public static Dictionary<string, decimal> Totals(IEnumerable<SaleRecord> sales)
    {
        var totals = new Dictionary<string, decimal>(StringComparer.Ordinal);
        foreach (var sale in sales)
        {
            var signed = sale.Kind == SaleKind.Refund ? -sale.Amount : sale.Amount;
            totals[sale.Region] = totals.GetValueOrDefault(sale.Region) + signed;
        }

        return totals;
    }

    /// <summary>Reads a log, parses each record line and totals the sales; each skipped line goes to <paramref name="warnings"/>.</summary>
    public static IngestResult Run(string logPath, TextWriter warnings)
    {
        var sales = new List<SaleRecord>();
        var records = 0;
        var skipped = 0;
        foreach (var line in LogReader.ReadRecords(logPath))
        {
            records++;
            var parsed = LineParser.Parse(line.Text);
            if (parsed.Record is { } sale)
            {
                sales.Add(sale);
            }
            else
            {
                skipped++;
                warnings.WriteLine($"WARN skipped line {line.Number}: {parsed.Error}");
            }
        }

        return new IngestResult(Totals(sales), records, skipped);
    }
}
