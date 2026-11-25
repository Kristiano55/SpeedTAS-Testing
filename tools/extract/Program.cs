// Reads inputs straight from SpeedTAS replay files, for the replays TAS Exchange's replayData API doesn't know.
// Adapted from the Kacky Reloaded Project's extractor (GBX.NET).
//
// Usage: dotnet run --project tools/extract -c Release -- data/inputs_todo.json data/inputs data/inputs_missing.json
//   inputs_todo.json:    [{ "event": 251, "replay": 1880, "game": "tm20" }, ...]  (written by scripts/update-data.mjs)
//   writes data/inputs/<replay>.txt in the same format as the API output:
//     "<seconds> press up" / "<seconds> rel down" / "<seconds> steer <value>"
//   replays that can't be read are added to inputs_missing.json so they aren't downloaded again.
using System.Text.Json;
using System.Text.Json.Nodes;
using GBX.NET;
using GBX.NET.Engines.Game;
using GBX.NET.LZO;

Gbx.LZO = new Lzo();
var todoPath = args.Length > 0 ? args[0] : "data/inputs_todo.json";
var outDir = args.Length > 1 ? args[1] : "data/inputs";
var missingPath = args.Length > 2 ? args[2] : "data/inputs_missing.json";
const int MaxPerRun = 60;
Directory.CreateDirectory(outDir);

var todo = File.Exists(todoPath) ? JsonNode.Parse(File.ReadAllText(todoPath))!.AsArray() : new JsonArray();
var missing = File.Exists(missingPath) ? JsonNode.Parse(File.ReadAllText(missingPath))!.AsObject() : new JsonObject();

using var http = new HttpClient();
http.DefaultRequestHeaders.UserAgent.ParseAdd("SpeedTAS data updater (github.com/Kristiano55/SpeedTAS-Testing)");
int ok = 0, fail = 0, done = 0;
foreach (var item in todo)
{
    if (done++ >= MaxPerRun) break;
    long ev = item!["event"]!.GetValue<long>(), id = item["replay"]!.GetValue<long>();
    var outFile = Path.Combine(outDir, $"{id}.txt");
    if (File.Exists(outFile)) continue;
    try
    {
        var bytes = await http.GetByteArrayAsync($"https://tmtas.exchange/events/{ev}/replays/{id}/download");
        using var ms = new MemoryStream(bytes);
        var replay = Gbx.ParseNode<CGameCtnReplayRecord>(ms);
        var text = Extract(replay);
        if (string.IsNullOrWhiteSpace(text)) throw new Exception("no inputs found");
        File.WriteAllText(outFile, text);
        ok++;
        Console.WriteLine($"ok   {id}");
    }
    catch (Exception e)
    {
        fail++;
        missing[id.ToString()] = $"{DateTime.UtcNow:yyyy-MM-dd} {e.GetType().Name}: {e.Message}";
        Console.WriteLine($"FAIL {id}: {e.GetType().Name}: {e.Message}");
    }
    await Task.Delay(300);
}
File.WriteAllText(missingPath, missing.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine($"extracted {ok}, failed {fail}, queue {todo.Count}");

static string Extract(CGameCtnReplayRecord replay)
{
    dynamic ghost = replay.GetGhosts().FirstOrDefault() ?? throw new Exception("no ghost");
    IEnumerable<object> inputs = null;
    try
    {
        dynamic pis = ghost.PlayerInputs; // TM2020
        if (pis != null) foreach (dynamic pi in pis) { inputs = ((IEnumerable<object>)pi.Inputs).ToList(); break; }
    }
    catch { }
    if (inputs == null || !inputs.Any())
        try { inputs = ((IEnumerable<object>)ghost.Inputs).ToList(); } catch { } // TMNF / TMUF
    if (inputs == null || !inputs.Any()) throw new Exception("ghost has no input list");

    var lines = new List<(int t, int order, string s)>();
    var held = new Dictionary<string, bool>();
    var types = new HashSet<string>();
    int i = 0;
    foreach (dynamic inp in inputs)
    {
        string name = ((object)inp).GetType().Name;
        types.Add(name);
        int ms = Ms(inp);
        switch (name)
        {
            case "Accelerate": case "Gas": case "AccelerateReal": case "AccelerateTM2020":
                Key("up", inp, ms); break;
            case "Brake": case "BrakeReal": case "BrakeTM2020":
                Key("down", inp, ms); break;
            case "SteerLeft": Key("left", inp, ms); break;
            case "SteerRight": Key("right", inp, ms); break;
            case "Steer": case "SteerOld": case "SteerTM2020":
                {
                    int v = Convert.ToInt32(inp.Value);
                    if (name == "SteerTM2020") v = (int)Math.Round(v / 127.0 * 65536); // same scale as the API (-65536..65536)
                    lines.Add((ms, i++, $"{Sec(ms)} steer {v}"));
                    break;
                }
            case "Respawn": case "RespawnTM2020":
                if (Pressed(inp)) lines.Add((ms, i++, $"{Sec(ms)} press enter")); break;
            default: break; // camera, horn, internal events
        }
    }
    Console.WriteLine("  input types: " + string.Join(",", types));
    return string.Join("\n", lines.OrderBy(l => l.t).ThenBy(l => l.order).Select(l => l.s)) + "\n";

    void Key(string key, dynamic inp, int ms)
    {
        bool p = Pressed(inp);
        if (held.TryGetValue(key, out var was) && was == p) return;
        if (!held.ContainsKey(key) && !p) { held[key] = false; return; } // a release before any press means nothing
        held[key] = p;
        lines.Add((ms, i++, $"{Sec(ms)} {(p ? "press" : "rel")} {key}"));
    }
}

static string Sec(int ms) { var s = (ms / 1000.0).ToString("0.00", System.Globalization.CultureInfo.InvariantCulture); return s.EndsWith(".00") ? s[..^3] : s; }
static bool Pressed(dynamic inp) { try { return (bool)inp.Pressed; } catch { return true; } }
static int Ms(dynamic inp)
{
    object t = inp.Time;
    try { return (int)((dynamic)t).TotalMilliseconds; } catch { }
    try { return Convert.ToInt32(t); } catch { return 0; }
}
