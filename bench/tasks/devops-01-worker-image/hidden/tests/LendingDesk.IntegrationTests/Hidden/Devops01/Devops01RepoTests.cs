using System.Text.RegularExpressions;

namespace LendingDesk.IntegrationTests.Hidden.Devops01;

/// <summary>The Dockerfile's stages, the CI job and the README lines - read as text, no Docker needed.</summary>
public sealed partial class Devops01RepoTests
{
    private const string WorkerBuild = "docker build -f src/LendingDesk.Worker/Dockerfile -t lendingdesk-worker .";

    /// <summary>The jobs as they stand before the change, comments and blank lines left out.</summary>
    private static readonly Dictionary<string, string[]> OriginalJobs = new()
    {
        ["api"] =
        [
            "runs-on: ubuntu-latest",
            "steps:",
            "- uses: actions/checkout@v7",
            "with:",
            "persist-credentials: false",
            "- uses: actions/setup-dotnet@v6",
            "with:",
            "global-json-file: global.json",
            "- run: dotnet restore",
            "- run: dotnet build --no-restore -c Release",
            "- run: dotnet test --no-build -c Release",
        ],
        ["api-image"] =
        [
            "runs-on: ubuntu-latest",
            "steps:",
            "- uses: actions/checkout@v7",
            "with:",
            "persist-credentials: false",
            "- run: docker build -f src/LendingDesk.Api/Dockerfile -t lendingdesk-api .",
        ],
        ["web"] =
        [
            "runs-on: ubuntu-latest",
            "defaults:",
            "run:",
            "working-directory: web",
            "steps:",
            "- uses: actions/checkout@v7",
            "with:",
            "persist-credentials: false",
            "- uses: actions/setup-node@v7",
            "with:",
            "node-version: 24",
            "cache: npm",
            "cache-dependency-path: web/package-lock.json",
            "- run: npm ci",
            "- run: npm run lint",
            "- run: npm test -- --watch=false",
            "- run: npm run build",
        ],
    };

    [Fact]
    public void The_Dockerfile_is_multi_stage_and_builds_with_the_dotnet_10_sdk_image()
    {
        var path = RepoRoot.File("src/LendingDesk.Worker/Dockerfile");
        Assert.True(File.Exists(path), "src/LendingDesk.Worker/Dockerfile does not exist.");

        var images = File.ReadAllLines(path)
            .Select(l => FromLine().Match(l))
            .Where(m => m.Success)
            .Select(m => m.Groups["image"].Value)
            .ToList();

        Assert.True(images.Count >= 2, $"Expected a multi-stage build, found FROM {string.Join(", ", images)}.");
        Assert.Contains(images, i => i.StartsWith("mcr.microsoft.com/dotnet/sdk:10.0", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void CI_builds_the_worker_image_in_a_job_shaped_like_api_image_and_leaves_the_other_jobs_alone()
    {
        var jobs = Jobs(File.ReadAllLines(RepoRoot.File(".github/workflows/ci.yml")));

        Assert.True(jobs.ContainsKey("worker-image"), "ci.yml has no worker-image job; jobs: " + string.Join(", ", jobs.Keys));
        foreach (var (name, lines) in OriginalJobs)
        {
            Assert.True(jobs.ContainsKey(name), $"The {name} job is gone.");
            Assert.Equal(lines, Significant(jobs[name]));
        }

        var worker = jobs["worker-image"];
        var significant = Significant(worker);
        Assert.Contains("runs-on: ubuntu-latest", significant);
        Assert.Equal(["actions/checkout@v7"], significant.Select(l => UsesLine().Match(l)).Where(m => m.Success).Select(m => m.Groups["action"].Value));
        Assert.Contains("persist-credentials: false", significant);
        Assert.Equal([WorkerBuild], RunCommands(worker));
    }

    [Fact]
    public void The_README_shows_the_worker_image_build_and_run_next_to_the_api_image()
    {
        var lines = File.ReadAllLines(RepoRoot.File("README.md"));
        var commands = Commands(lines);

        var apiBuild = commands.FindIndex(c => c.Text == "docker build -f src/LendingDesk.Api/Dockerfile -t lendingdesk-api .");
        Assert.True(apiBuild >= 0, "The API image's build command is gone from the README.");
        Assert.Contains(commands, c => c.Text.StartsWith("docker run -p 8080:8080 -e ConnectionStrings__Lending=", StringComparison.Ordinal) && c.Text.EndsWith(" lendingdesk-api", StringComparison.Ordinal));

        var workerBuild = commands.FindIndex(c => c.Text == WorkerBuild);
        Assert.True(workerBuild >= 0, $"The README does not show '{WorkerBuild}'.");
        var workerRun = commands.FindIndex(c => c.Text.StartsWith("docker run ", StringComparison.Ordinal) && c.Text.Split(' ', StringSplitOptions.RemoveEmptyEntries).Any(t => t is "lendingdesk-worker" or "lendingdesk-worker:latest"));
        Assert.True(workerRun >= 0, "The README shows no docker run command for lendingdesk-worker.");

        var apiSection = commands[apiBuild].Section;
        Assert.True(Math.Abs(commands[workerBuild].Section - apiSection) <= 1, "The worker image's build command is not next to the API image's.");
        Assert.True(Math.Abs(commands[workerRun].Section - apiSection) <= 1, "The worker image's run command is not next to the API image's.");
    }

    [GeneratedRegex(@"^\s*FROM\s+(?:--\S+\s+)*(?<image>\S+)", RegexOptions.IgnoreCase)]
    private static partial Regex FromLine();

    [GeneratedRegex(@"^(?:-\s+)?uses:\s*(?<action>\S+)\s*$")]
    private static partial Regex UsesLine();

    [GeneratedRegex(@"^(?<indent>\s*)(?:-\s+)?run:\s*(?<value>.*)$")]
    private static partial Regex RunLine();

    [GeneratedRegex(@"^(?<indent>\s+)(?<name>[A-Za-z0-9_-]+):\s*(#.*)?$")]
    private static partial Regex JobKey();

    /// <summary>The lines of each job under the top-level jobs key.</summary>
    private static Dictionary<string, List<string>> Jobs(string[] lines)
    {
        var jobs = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        var start = Array.FindIndex(lines, l => l.TrimEnd() == "jobs:");
        Assert.True(start >= 0, "ci.yml has no jobs key.");
        string? indent = null;
        List<string>? current = null;
        for (var i = start + 1; i < lines.Length; i++)
        {
            var line = lines[i];
            if (line.Length > 0 && !char.IsWhiteSpace(line[0]) && !line.StartsWith('#'))
            {
                break;
            }

            var key = JobKey().Match(line);
            if (key.Success && (indent is null || key.Groups["indent"].Value == indent))
            {
                indent = key.Groups["indent"].Value;
                current = [];
                jobs[key.Groups["name"].Value] = current;
                continue;
            }

            current?.Add(line);
        }

        return jobs;
    }

    private static List<string> Significant(IEnumerable<string> lines) =>
        [.. lines.Select(l => l.Trim()).Where(l => l.Length > 0 && !l.StartsWith('#'))];

    /// <summary>The command of every run step, block scalars folded into one line.</summary>
    private static List<string> RunCommands(List<string> job)
    {
        var commands = new List<string>();
        for (var i = 0; i < job.Count; i++)
        {
            var run = RunLine().Match(job[i]);
            if (!run.Success)
            {
                continue;
            }

            var value = run.Groups["value"].Value.Trim();
            if (value.StartsWith('|') || value.StartsWith('>'))
            {
                var body = new List<string>();
                var keyColumn = job[i].IndexOf("run:", StringComparison.Ordinal);
                while (i + 1 < job.Count && (job[i + 1].Trim().Length == 0 || job[i + 1].Length - job[i + 1].TrimStart().Length > keyColumn))
                {
                    body.Add(job[++i].Trim());
                }

                value = string.Join(' ', body.Where(b => b.Length > 0));
            }
            else if (value.Length >= 2 && (value[0] == '"' || value[0] == '\'') && value[^1] == value[0])
            {
                value = value[1..^1];
            }

            commands.Add(value.Trim());
        }

        return commands;
    }

    /// <summary>The shell commands in the README's fenced blocks, continuation lines joined, trailing comments dropped.</summary>
    private static List<(string Text, int Section)> Commands(string[] lines)
    {
        var commands = new List<(string Text, int Section)>();
        var section = 0;
        var inFence = false;
        var pending = string.Empty;
        foreach (var raw in lines)
        {
            if (raw.TrimStart().StartsWith("```", StringComparison.Ordinal))
            {
                inFence = !inFence;
                pending = string.Empty;
                continue;
            }

            if (!inFence)
            {
                if (raw.StartsWith('#'))
                {
                    section++;
                }

                continue;
            }

            var line = raw.Trim();
            var comment = line.IndexOf(" #", StringComparison.Ordinal);
            if (comment >= 0)
            {
                line = line[..comment].TrimEnd();
            }

            if (line.EndsWith('\\'))
            {
                pending += line[..^1].Trim() + " ";
                continue;
            }

            var text = string.Join(' ', (pending + line).Split(' ', StringSplitOptions.RemoveEmptyEntries));
            pending = string.Empty;
            if (text.Length > 0)
            {
                commands.Add((text, section));
            }
        }

        return commands;
    }
}
