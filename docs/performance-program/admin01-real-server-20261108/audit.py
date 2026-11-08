"""Read-only cross-checks of measured artifacts; writes only this report/manifest."""
import hashlib
import json
import math
import os
import pathlib
import subprocess

doc = pathlib.Path(__file__).resolve().parent
repo = doc.parents[2]
proto = repo / 'scripts/prototypes/admin01-real-server-20261108'
digest = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
cohort = doc / 'cohort-v3'
summary = json.loads((cohort / 'summary.json').read_text())
total = 0
for item in summary['runs']:
    directory = cohort / f"{item['scenario']}-{item['ordinal']}"
    report = json.loads((directory / 'report.json').read_text())
    assert report['status'] == 'passed' and report['correctness'] is True
    assert report['anonymousProjectionStatus'] == 401
    assert len(report['mutations']) == 2
    assert all(m['retries'] == 0 for m in report['mutations'])
    assert [m['endpoint'] for m in report['mutations']] == ['/api/user-login', '/api/backups']
    assert report['before'] == report['after']
    for file, sha in report['identity']['harnessHashes'].items():
        assert digest(proto / file) == sha, file
    for file, sha in report['identity']['sourceHashes'].items():
        assert digest(repo / 'resources/app' / file) == sha, file
    observation = json.loads((directory / 'observation.json').read_text())
    assert observation == report['measurement']
    attempts = json.loads((directory / 'attempts.json').read_text())['attempts']
    selected = [a for a in attempts if observation['startedMs'] <= a['sentMs'] < observation['endedMs']]
    total += len(selected)
    for endpoint, stats in report['http'].items():
        samples = [a for a in selected if a['endpoint'] == endpoint]
        assert len(samples) == stats['count']
        assert all(a['status'] == 200 and a['error'] is None for a in samples)
        values = sorted(a['latencyMs'] for a in samples)
        for key, p in [('p50Ms', .5), ('p95Ms', .95), ('maxMs', 1)]:
            assert values[math.ceil(len(values) * p) - 1] == stats[key]
    correctness = json.loads((directory / 'correctness.json').read_text())
    assert correctness['passed'] is True and correctness['crcAndShaVerified'] is True
    assert correctness['restoredFiles'] == 27
assert total == 2657
inherited = json.loads((doc / 'inheritance.json').read_text())
for item in inherited['files']:
    assert digest(repo / item['path']) == item['sha256']
changed = subprocess.check_output(['git', 'diff', '--name-only', '1796193f0a57c7785e7bf9fdb3557e33c550b25e'], cwd=repo, text=True).splitlines()
allowed = ['scripts/prototypes/admin01-real-server-20261108/', 'docs/performance-program/admin01-real-server-20261108/']
assert all(any(f.startswith(prefix) for prefix in allowed) for f in changed)
validation = json.loads((doc / 'validation-v1.json').read_text())
assert validation['passed'] is True and validation['testFiles'] == 14
(doc / 'audit.json').write_text(json.dumps({'passed': True, 'successfulRuns': 9, 'httpAttemptsInBackupWindows': total,
    'inheritedFilesUnchanged': len(inherited['files']), 'measuredHarnessUnchanged': True,
    'sourceHashesMatchMeasured': True, 'trackedPathsWithinAllowlist': True,
    'quantilesIndependentlyRecomputed': True}, indent=2) + '\n')
files = []
for root in [doc, proto]:
    for current, dirs, names in os.walk(root, followlinks=False):
        current = pathlib.Path(current)
        for name in list(dirs):
            file = current / name
            if file.is_symlink():
                files.append({'path': str(file.relative_to(repo)), 'symlink': os.readlink(file)})
                dirs.remove(name)
            elif file == doc / 'runtime' or name == '__pycache__':
                dirs.remove(name)
        for name in names:
            file = current / name
            if file == doc / 'evidence-manifest.json':
                continue
            files.append({'path': str(file.relative_to(repo)), 'sha256': digest(file), 'bytes': file.stat().st_size})
(doc / 'evidence-manifest.json').write_text(json.dumps({'algorithm': 'sha256', 'runtimeExcluded': True,
    'files': sorted(files, key=lambda x: x['path'])}, indent=2) + '\n')
print(json.dumps({'passed': True, 'runs': 9, 'httpAttempts': total, 'manifestFiles': len(files)}))
