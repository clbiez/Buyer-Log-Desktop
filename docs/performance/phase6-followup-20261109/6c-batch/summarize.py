import json, statistics
from pathlib import Path
root=Path(__file__).resolve().parent
summary={"pairs":[],"medians":[],"parity":True,"candidate_budget":"FAIL"}
for count in [1,100,1000]:
 for phase in ["cold","warm"]:
  samples={"main":[],"candidate":[]}
  for pair in range(1,4):
   rows={}
   for arm in samples:
    data=json.loads((root/"pairs"/f"ab-{count}-{pair}-{arm}.json").read_text())
    assert data["ok"]
    rows[arm]=next(r for r in data["rows"] if r["phase"]==phase)
    samples[arm].append(rows[arm])
   keys=["fixtureHash","businessHash","eventHash","ackHash","eventCount","updated","skipped","replayEqual"]
   parity=all(rows["main"][key]==rows["candidate"][key] for key in keys)
   summary["parity"] &= parity
   summary["pairs"].append({"count":count,"phase":phase,"pair":pair,"parity":parity,"walByteDelta":rows["candidate"]["physical"]["walBytes"]-rows["main"]["physical"]["walBytes"]})
  medians={"count":count,"phase":phase}
  for arm,rs in samples.items():
   medians[arm]={key:statistics.median(r[key] for r in rs) for key in ["ackMs","totalMs","cpuMs","eventLoopGapMs","peakRss","peakHeap"]}
   medians[arm]["physical"]={key:statistics.median(r["physical"][key] for r in rs) for key in rs[0]["physical"]}
  summary["medians"].append(medians)
assert summary["parity"]
print(json.dumps(summary,indent=2))
