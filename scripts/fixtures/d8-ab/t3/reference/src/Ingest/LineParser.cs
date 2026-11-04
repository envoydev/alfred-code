using System.Globalization;
using System.Text;

namespace Ingest;

public enum SaleKind
{
    Order,
    Refund,
}

/// <summary>One sale from the log; <see cref="Amount"/> is in US dollars.</summary>
public sealed record SaleRecord(DateTimeOffset At, string OrderId, string Region, SaleKind Kind, decimal Amount);

/// <summary>A parsed record, or why the line could not be read.</summary>
public readonly record struct ParseResult(SaleRecord? Record, string? Error)
{
    public static ParseResult Ok(SaleRecord record) => new(record, null);

    public static ParseResult Fail(string error) => new(null, error);
}

/// <summary>
/// Parses one record line: timestamp, order id, region, kind (ORDER or REFUND), amount, currency, store, terminal.
/// The line is CSV (RFC 4180): a field holding a comma is quoted, and a quote inside it is doubled.
/// </summary>
public static class LineParser
{
    public static ParseResult Parse(string line)
    {
        var fields = SplitFields(line);
        if (fields is null)
        {
            return ParseResult.Fail("unterminated quote");
        }

        if (fields.Count < 5)
        {
            return ParseResult.Fail("too few fields");
        }

        if (!DateTimeOffset.TryParse(fields[0], CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var at))
        {
            return ParseResult.Fail("timestamp not a date");
        }

        if (!decimal.TryParse(fields[4], NumberStyles.Number, CultureInfo.InvariantCulture, out var amount))
        {
            return ParseResult.Fail("amount not a number");
        }

        SaleKind? kind = fields[3] switch
        {
            "ORDER" => SaleKind.Order,
            "REFUND" => SaleKind.Refund,
            _ => null,
        };
        if (kind is null)
        {
            return ParseResult.Fail("unknown kind");
        }

        return ParseResult.Ok(new SaleRecord(at, fields[1], fields[2], kind.Value, amount));
    }

    /// <summary>The line's fields with their quotes removed, or null when a quoted field never closes.</summary>
    public static List<string>? SplitFields(string line)
    {
        var fields = new List<string>();
        var field = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];
            if (quoted)
            {
                if (c != '"')
                {
                    field.Append(c);
                }
                else if (i + 1 < line.Length && line[i + 1] == '"')
                {
                    field.Append('"');
                    i++;
                }
                else
                {
                    quoted = false;
                }
            }
            else if (c == '"' && field.Length == 0)
            {
                quoted = true;
            }
            else if (c == ',')
            {
                fields.Add(field.ToString());
                field.Clear();
            }
            else
            {
                field.Append(c);
            }
        }

        if (quoted)
        {
            return null;
        }

        fields.Add(field.ToString());
        return fields;
    }
}
