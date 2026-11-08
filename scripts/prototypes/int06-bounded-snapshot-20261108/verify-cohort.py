"""Verify saved observations, never rerun a sample or change a validator."""
import hashlib
import json
import statistics
import subprocess
from pathlib import Path

repo = Path(__file__).resolve().parents[3]
out = repo / 'docs/performance-program/contrib-int06-bounded-snapshot-20261108'
summary = json.loads((out / 'cohort/100000-steady-summary.json').read_text())
order = ['legacy-store', 'journal', 'journal', 'legacy-store', 'legacy-store', 'journal']
counts = dict.fromkeys(order, 0)
reports = []
for arm in order:
    counts[arm] += 1
    report = json.loads((out / f'cohort/100000-steady-{arm}-{counts[arm]}.json').read_text())
    assert report['parity'] and not report['productionGainAccepted']
    assert report['config']['orders'] == 100000 and report['config']['batchSize'] == 250
    assert report['config']['scenario'] == 'steady' and report['traceBatches'] == 400
    assert report['metrics']['committedBatches'] == 400
    assert report['source']['revision'] == '4e66c955e51e01ac84a0e799d5e1c491008f6393'
    expected_bytes = 6777574427 if arm == 'legacy-store' else 193920022
    assert report['metrics']['checkpointBytes'] == expected_bytes
    assert report['metrics']['totalReplayCpuMs'] >= report['metrics']['checkpointCpuMs']
    assert report['metrics']['totalReplayWallMs'] >= report['metrics']['checkpointWallMs']
    for field in ['fixtureSha256', 'traceSha256', 'outputSha256', 'finalManifestSha256', 'finalRowsSha256', 'finalOrderStatesSha256']:
        assert report[field] == summary[field]
    if reports:
        assert report['source'] == reports[0]['source'] and report['environment'] == reports[0]['environment']
    reports.append(report)
for arm, metrics in summary['arms'].items():
    for metric, expected in metrics.items():
        values = []
        for report in reports:
            if report['config']['arm'] != arm:
                continue
            value = report['metrics']
            for key in metric.split('.'):
                value = value[key]
            values.append(value)
        assert expected == dict(median=statistics.median(values), min=min(values), max=max(values))
historical = out.parent / 'contrib-int06-checkpoint-journal-20261108/rss-followup/acceptance/100000-steady-journal-1.json'
old = json.loads(historical.read_text())
for field in ['fixtureSha256', 'traceSha256', 'outputSha256']:
    assert old[field] == reports[0][field]
for key, file in [('journalSha256', 'resources/app/server/lib/power-bi-checkpoint-journal.js'),
                  ('productionSha256', 'resources/app/server/lib/power-bi-import-dashboard.js'),
                  ('harnessSha256', 'scripts/prototypes/int06-bounded-snapshot-20261108/measure.cjs'),
                  ('metricsSha256', 'scripts/prototypes/int06-bounded-snapshot-20261108/metrics.cjs')]:
    data = subprocess.check_output(['git', 'show', f"{reports[0]['source']['revision']}:{file}"], cwd=repo)
    assert hashlib.sha256(data).hexdigest() == reports[0]['source'][key]
assert summary['rssMedianDeltaPercent'] > 0
assert not summary['rssRegressionAccepted'] and not summary['productionGainAccepted']
result = {'samples': 6, 'order': order, 'sameFixtureTraceOutputAsHistorical': True,
          'fullManifestRowsStatesHashesEqual': True, 'sameFormatByteTotals': True,
          'allSummaryMetricsRecomputed': True, 'committedMeasurementSourcesVerified': True,
          'rssMedianDeltaPercent': summary['rssMedianDeltaPercent'], 'rssRegressionAccepted': False,
          'storage': summary['storage'], 'source': reports[0]['source']}
with (out / 'cohort-verification.json').open('x') as f:
    json.dump(result, f, indent=2); f.write('\n')
