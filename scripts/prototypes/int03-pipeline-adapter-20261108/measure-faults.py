#!/usr/bin/env python3
import json, os, pathlib, statistics, subprocess
ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/performance-program/contrib-int03-pipeline-adapter-20261108'
SCRIPT = ROOT / 'scripts/prototypes/int03-pipeline-adapter-20261108/measure-faults.js'
plan = ['before', 'after', 'after', 'before', 'before', 'after']
summary = {}
for scenario in ['partial', 'cancel']:
    runs = []
    for n, arm in enumerate(plan, 1):
        proc = subprocess.run(['node', str(SCRIPT), arm, scenario], cwd=ROOT, env=os.environ, capture_output=True)
        stem = OUT / f'{scenario}-{n}-{arm}'
        stem.with_suffix('.json').write_bytes(proc.stdout)
        pathlib.Path(str(stem)+'.stderr.txt').write_bytes(proc.stderr)
        assert proc.returncode == 0, (scenario, arm, proc.stderr)
        runs.append(json.loads(proc.stdout))
    for key in ['fixtureSha256', 'outputSha256', 'status', 'failures', 'revisionDelta', 'patchCalls', 'checkpoints', 'oracleMatches', 'noRetention']:
        assert len({json.dumps(r[key], sort_keys=True) for r in runs}) == 1, (scenario, key)
    keys = ['osPeakRssBytes', 'sampledPeakExternalBytes', 'peakReservationBytes', 'firstCanonicalLinkMs', 'totalMs']
    summary[scenario] = {a: {k: statistics.median(r[k] for r in runs if r['arm'] == a) for k in keys} for a in ['before', 'after']}
(OUT / 'fault-measurement-summary.json').write_text(json.dumps(dict(order=plan, equivalent=True, medians=summary), indent=2)+'\n')
print(json.dumps(summary))
