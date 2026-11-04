namespace Ingest.Tests;

public sealed class LogReaderTests
{
    [Theory]
    [InlineData("2026-11-01T00:00:04Z,ord-1,West,ORDER,10.00,USD,store-01,t-01", true)]
    [InlineData("2026-11-01T00:00:04Z,ord-1,\"North, East\",ORDER,10.00,USD,store-01,t-01", true)]
    [InlineData("2026-11-01T00:00:00Z INFO ingest finished: 2 records, 0 skipped", false)]
    [InlineData("2026-11-01T00:00:05Z WARN skipped line 3: amount not a number", false)]
    [InlineData("", false)]
    public void Tells_a_record_line_from_the_job_s_own(string text, bool record)
    {
        Assert.Equal(record, LogReader.IsRecord(text));
    }

    [Fact]
    public void Numbers_the_record_lines_by_their_place_in_the_file()
    {
        var log = Path.GetTempFileName();
        try
        {
            File.WriteAllLines(log, [
                "2026-11-01T00:00:00Z INFO ingest started: business day 2026-11-01",
                "2026-11-01T00:00:04Z,ord-1,West,ORDER,10.00,USD,store-01,t-01",
            ]);

            var line = Assert.Single(LogReader.ReadRecords(log));

            Assert.Equal(2, line.Number);
        }
        finally
        {
            File.Delete(log);
        }
    }
}
