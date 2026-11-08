#!/usr/bin/env python3
"""Three fresh, sequential helper processes. Never a production comparison."""
import hashlib
import json
import os
from pathlib import Path
import statistics
import subprocess

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
ENTRY = 'resources/app/tests/fixtures/int03-byte-budget/measure.js'


def main():
    if os.environ.get('INT03_LOCK_HELD') != '1':
        raise SystemExit('Run with the shared flock and INT03_LOCK_HELD=1')
    outputs = [OUT / f'helper-run-{i}.{suffix}' for i in range(1, 4) for suffix in ['json', 'stderr.txt']]
    if any(path.exists() for path in outputs):
        raise SystemExit('Preserve existing evidence; use a fresh output directory')
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    paths = ['resources/app/server/lib/plm-image-byte-budget.js', ENTRY,
             'resources/app/tests/fixtures/int03-byte-budget/mock-pipeline.js',
             'resources/app/tests/fixtures/int03-byte-budget/plm-image-memory-fixture.js']
    hashes = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in paths}
    runs = []
    for i in range(1, 4):
        with (OUT / f'helper-run-{i}.json').open('w') as stdout, (OUT / f'helper-run-{i}.stderr.txt').open('w') as stderr:
            result = subprocess.run(['node', ENTRY], cwd=ROOT, stdout=stdout, stderr=stderr)
        if result.returncode:
            raise SystemExit(f'Run {i} failed: {result.returncode}; raw outputs retained')
        run = json.loads((OUT / f'helper-run-{i}.json').read_text())
        runs.append(run)
        print(json.dumps(dict(run=i, totalMs=run['totalMs'], reservation=run['reservation'], osPeakRssBytes=run['osPeakRssBytes'])), flush=True)
    metrics = ['osPeakRssBytes', 'sampledPeakRssBytes', 'sampledPeakExternalBytes',
               'sampledPeakArrayBuffersBytes', 'firstMockCompletionMs', 'totalMs']
    summary = dict(kind='isolated-helper-only', productionAcceptance=False, sourceCommit=source,
                   sourceSha256=hashes, lock='/tmp/buyerlog-performance-measurement.lock', lockFlags='-n -E 75',
                   runs=3, allOracleMatches=all(run['oracleMatches'] for run in runs),
                   median={key: statistics.median(run[key] for run in runs) for key in metrics})
    (OUT / 'measurement-summary.json').write_text(json.dumps(summary, indent=2) + '\n')


if __name__ == '__main__':
    main()
