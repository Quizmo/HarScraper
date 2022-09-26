using System.Text.Json.Nodes;

string fileName = "Input/input.har";
using FileStream openStream = File.OpenRead(fileName);
var entries = ((dynamic)JsonNode.Parse(openStream))["log"]["entries"];
var total = entries.Count;
var i = 0;
foreach (var entry in entries)
{
    i++;
    var url = (string)entry["request"]["url"];
    var filePath = url.Replace(new Uri(url).GetLeftPart(UriPartial.Authority), string.Empty);
    var path = Path.GetDirectoryName(filePath);
    if (!Directory.Exists($"Output/{path}"))
    {
        Directory.CreateDirectory($"Output/{path}");
    }

    var content = await DownloadFile(url);
    if (content == null)
    {
        Console.WriteLine("Failed to download" + url);
        continue;
    }
    await File.WriteAllBytesAsync($"Output/{path}/{Path.GetFileName(filePath).Split("?")[0]}", content);
    Console.WriteLine($"File downloaded {i} out of {total}");
}

static async Task<byte[]?> DownloadFile(string url)
{
    using (var client = new HttpClient())
    using (var result = await client.GetAsync(url))
        return result.IsSuccessStatusCode ? await result.Content.ReadAsByteArrayAsync() : null;
}