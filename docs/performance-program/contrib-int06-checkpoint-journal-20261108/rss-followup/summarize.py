"""Read existing diagnostic artifacts; never run a workload or infer acceptance."""
import collections
import json
from pathlib import Path

root = Path(__file__).resolve().parent
result = {"diagnosticOnly": True, "runs": {}}
for name in ("before-phase", "after-phase", "before-gc-sampling", "after-gc-sampling"):
    data = json.loads((root / "diagnostics" / (name + ".json")).read_text())
    events = data["events"]
    boundary = next(e for e in events if e["stage"] == "acceptance-peak-boundary")
    measured = [e for e in events if e["ms"] <= boundary["ms"]]
    final = [e for e in measured if e["region"] == "final-compact"]
    run = {
        "helperSha256": data["helperSha256"],
        "forceGC": data["forceGC"], "sampleHeap": data["sampleHeap"],
        "oracleCreatedAtPeakBoundary": boundary["oracleCreated"],
        "peakBoundary": boundary,
        "observedMaxRssEventBeforeBoundary": max(measured, key=lambda e: e["rss"]),
        "finalSnapshotEvents": final,
        "fullGraphParseCallsDuringFinalSnapshot": sum(e["stage"] == "json:parse:after" for e in final),
        "collectedHeapStages": [e for e in events if e["stage"].endswith(":after-gc")],
        "gcBeforePeakBoundary": {
            "count": sum(e["startTime"] <= boundary["ms"] for e in data["collections"]),
            "durationMs": sum(e["duration"] for e in data["collections"] if e["startTime"] <= boundary["ms"]),
            "kinds": dict(collections.Counter(e["kind"] for e in data["collections"] if e["startTime"] <= boundary["ms"])),
        },
    }
    if data["sampleHeap"]:
        run["sampledSurvivingAllocations"] = {}
        for stage in ("trace", "before-final", "after-final"):
            profile = json.loads((root / "diagnostics" / (name + ".json." + stage + ".heap-sampling.json")).read_text())
            sizes = collections.Counter()

            def walk(node, stack):
                frame = node["callFrame"]
                here = f'{frame["functionName"]}@{frame["url"].split("/")[-1]}:{frame["lineNumber"] + 1}'
                stack = stack + [here]
                sizes[" > ".join(stack[-4:])] += node["selfSize"]
                for child in node.get("children", []):
                    walk(child, stack)

            walk(profile["head"], [])
            run["sampledSurvivingAllocations"][stage] = {
                "totalBytes": sum(sizes.values()),
                "largestStacks": [{"stack": stack, "bytes": size} for stack, size in sizes.most_common(15)],
            }
    result["runs"][name] = run

with (root / "diagnostic-summary.json").open("x") as target:
    json.dump(result, target, indent=2)
    target.write("\n")
