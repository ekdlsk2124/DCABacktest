using System.Net;
using System.Net.Http.Headers;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddRazorPages();

builder.Services.AddHttpClient("proxy")
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
    {
        AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate
    });

var app = builder.Build();

// 개발 중엔 HTTPS 리다이렉션 생략
// app.UseHttpsRedirection();

app.UseStaticFiles();
app.UseRouting();
app.MapRazorPages();

// /api/yahoo 프록시 (CORS/차단 회피)
app.MapGet("/api/yahoo", async (string symbol, string range, IHttpClientFactory factory) =>
{
    string bust = $"_={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
    string host1 = $"https://query1.finance.yahoo.com/v8/finance/chart/{Uri.EscapeDataString(symbol)}?range={Uri.EscapeDataString(range)}&interval=1d&includeAdjustedClose=true&events=div%2Csplit&{bust}";
    string host2 = $"https://query2.finance.yahoo.com/v8/finance/chart/{Uri.EscapeDataString(symbol)}?range={Uri.EscapeDataString(range)}&interval=1d&includeAdjustedClose=true&events=div%2Csplit&{bust}";

    var client = factory.CreateClient("proxy");
    client.DefaultRequestHeaders.UserAgent.Clear();
    client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("Mozilla", "5.0"));

    foreach (var url in new[] { host1, host2 })
    {
        try
        {
            var resp = await client.GetAsync(url);
            if (resp.IsSuccessStatusCode)
            {
                var json = await resp.Content.ReadAsStringAsync();
                return Results.Content(json, "application/json");
            }
        }
        catch { }
    }
    return Results.StatusCode(502);
});

app.MapGet("/api/ping", () => Results.Ok(new { ok = true }));

app.Run();
