namespace Ingest.Tests;

public sealed class LineParserTests
{
    [Fact]
    public void Parses_an_order_line()
    {
        var parsed = LineParser.Parse("2026-11-01T00:00:04Z,ord-100001,West,ORDER,129.50,USD,store-17,t-04");

        Assert.Null(parsed.Error);
        var sale = Assert.IsType<SaleRecord>(parsed.Record);
        Assert.Equal("ord-100001", sale.OrderId);
        Assert.Equal("West", sale.Region);
        Assert.Equal(SaleKind.Order, sale.Kind);
        Assert.Equal(129.50m, sale.Amount);
        Assert.Equal(new DateTimeOffset(2026, 11, 1, 0, 0, 4, TimeSpan.Zero), sale.At);
    }

    [Fact]
    public void Parses_a_refund_line()
    {
        var sale = LineParser.Parse("2026-11-01T00:00:09Z,ord-100002,Central,REFUND,5.00,USD,store-02,t-01").Record;

        Assert.Equal(SaleKind.Refund, sale?.Kind);
        Assert.Equal(5.00m, sale?.Amount);
    }

    [Theory]
    [InlineData("2026-11-01T00:00:04Z,ord-1,West,ORDER,lots,USD,store-17,t-04", "amount not a number")]
    [InlineData("2026-11-01T00:00:04Z,ord-1,West", "too few fields")]
    [InlineData("yesterday,ord-1,West,ORDER,1.00,USD,store-17,t-04", "timestamp not a date")]
    [InlineData("2026-11-01T00:00:04Z,ord-1,West,SALE,1.00,USD,store-17,t-04", "unknown kind")]
    public void Says_why_a_line_cannot_be_read(string line, string error)
    {
        var parsed = LineParser.Parse(line);

        Assert.Null(parsed.Record);
        Assert.Equal(error, parsed.Error);
    }
}
