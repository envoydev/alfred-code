using System.Text.Json;
using System.Text.Json.Serialization;

namespace Api.Tests;

/// <summary>The API's own JSON shape: web defaults, enums as text.</summary>
public static class Json
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };
}
