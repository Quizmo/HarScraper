using System.Text.Json.Nodes;
using Microsoft.Playwright;

Console.WriteLine("Insert link you want to scrape: ");
var url = Console.ReadLine();
if (string.IsNullOrEmpty(url))
{
    Console.WriteLine("Url is empty");
    return;
}

Install();
await GetHarFileFromUrl(url);
await ReadHarFile();

Console.WriteLine("Sucessfully downloaded all content from har.");
Console.WriteLine("You can find the content in the Output folder.");
Console.WriteLine("Press any key to exit.");
Console.ReadKey();
Environment.Exit(0);

static void Install()
{
    Environment.SetEnvironmentVariable("PLAYWRIGHT_BROWSERS_PATH", "0");
    var exitCode = Microsoft.Playwright.Program.Main(new[] { "install", "chromium" });
    if (exitCode != 0)
    {
        Console.WriteLine("Failed to install browsers");
        Environment.Exit(exitCode);
    }
}

static async Task GetHarFileFromUrl(string url)
{
    var currentDir = Directory.GetCurrentDirectory();
    using var playwright = await Playwright.CreateAsync();
    Console.WriteLine($"Opening browser for {url}");
    var browser = await playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions { Headless = false });
    if (!Directory.Exists($"{currentDir }/Input"))
    {
        Directory.CreateDirectory($"{currentDir }/Input");
    }
    var context = await browser.NewContextAsync(new BrowserNewContextOptions()
    {
        RecordHarPath = Path.Combine(currentDir, "Input/input.har")
    });

    var page = await context.NewPageAsync();
    await page.GotoAsync(url);
    Console.WriteLine("Press any key to continue");
    Console.ReadKey();
    await context.CloseAsync();
    await browser.CloseAsync();
}

static async Task ReadHarFile()
{
    Console.WriteLine("Reading har file");
    string fileName = "Input/input.har";
    using FileStream openStream = File.OpenRead(fileName);
    var entries = ((dynamic)JsonNode.Parse(openStream))["log"]["entries"];
    var total = entries.Count;
    var i = 0;
    foreach (var entry in entries)
    {
        i++;
        var url = (string)entry["request"]["url"];
        if(string.IsNullOrEmpty(url) || url.StartsWith("blob"))
        {
            Console.WriteLine($"Entry skipped {i} out of {total}");
            continue;
        }
        
        var filePath = url.Replace(new Uri(url).GetLeftPart(UriPartial.Authority), string.Empty);
        var filename = Path.GetFileName(filePath).Split("?")[0];
        if (string.IsNullOrEmpty(filename) || filename.StartsWith("?") || !filename.Contains('.'))
        {
            Console.WriteLine($"Entry skipped {i} out of {total}");
            continue;
        }
        var path = Path.GetDirectoryName(filePath);
        if (!Directory.Exists($"Output/{path}"))
        {
            Directory.CreateDirectory($"Output/{path}");
        }

        var content = await DownloadFile(url);
        if (content == null)
        {
            Console.WriteLine($"Failed to download {url}");
            continue;
        }
        try
        {
            await File.WriteAllBytesAsync($"Output/{path}/{filename}", content);
        }
        catch
        {
            Console.WriteLine($"Failed to write file for: Output/{path}/{filename}");
        }
        
        Console.WriteLine($"File downloaded {i} out of {total}");
    }
}

static async Task<byte[]?> DownloadFile(string url)
{
    using (var client = new HttpClient())
    using (var result = await client.GetAsync(url))
        return result.IsSuccessStatusCode ? await result.Content.ReadAsByteArrayAsync() : null;
}