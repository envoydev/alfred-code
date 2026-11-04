namespace Ingest;

/// <summary>One line of an ingest log, numbered from 1.</summary>
public readonly record struct LogLine(int Number, string Text);

/// <summary>
/// Reads the record lines of an ingest log. A record line starts with its timestamp and a comma; the job's own lines
/// (<c>&lt;timestamp&gt; INFO ...</c>, <c>&lt;timestamp&gt; WARN ...</c>) are skipped.
/// </summary>
public static class LogReader
{
    public static IEnumerable<LogLine> ReadRecords(string path)
    {
        var number = 0;
        foreach (var text in File.ReadLines(path))
        {
            number++;
            if (IsRecord(text))
            {
                yield return new LogLine(number, text);
            }
        }
    }

    public static bool IsRecord(string text)
    {
        var comma = text.IndexOf(',');
        var space = text.IndexOf(' ');
        return comma > 0 && (space < 0 || comma < space);
    }
}
