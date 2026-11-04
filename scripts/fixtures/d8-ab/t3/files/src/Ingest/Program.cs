using System.Globalization;
using Ingest;

// The nightly ingest: totals one business day's sales log per region. Usage: Ingest <log file>
if (args.Length != 1)
{
    Console.Error.WriteLine("usage: Ingest <log file>");
    return 2;
}

var result = Aggregator.Run(args[0], Console.Error);
Console.WriteLine($"{result.Records} records, {result.Skipped} skipped");
foreach (var (region, total) in result.Totals.OrderBy(t => t.Key, StringComparer.Ordinal))
{
    Console.WriteLine($"total {region}: {total.ToString("0.00", CultureInfo.InvariantCulture)}");
}

return 0;
