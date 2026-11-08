#!/usr/bin/env python3
"""Validate retained evidence and the two-directory write boundary."""
import gzip, hashlib, json, pathlib, subprocess
ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/performance-program/contrib-int03-pipeline-adapter-20261108'
SCRIPT = ROOT / 'scripts/prototypes/int03-pipeline-adapter-20261108'
BASE = 'ea49389836dba23f0970a974b4c0185f1b36ec0e'
PREFIXES = ('scripts/prototypes/int03-pipeline-adapter-20261108/', 'docs/performance-program/contrib-int03-pipeline-adapter-20261108/')
def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)
def digest(bytes_):
    return hashlib.sha256(bytes_).hexdigest()
changed = set(git('diff', '--name-only', BASE).decode().splitlines()) | set(git('ls-files', '--others', '--exclude-standard').decode().splitlines())
assert all(p.startswith(PREFIXES) for p in changed), sorted(changed)
assert json.loads((ROOT / 'resources/app/tests/fixtures/i18n-coverage-baseline.json').read_text())['files'] == {}
protected = {}
for file in ['CLAUDE.md', 'AGENTS.md', 'resources/app/server/lib/plm-image-download-queue.js', 'resources/app/server/lib/plm-image-sync-service.js', 'resources/app/server/lib/plm-image-ingest.js', 'resources/app/server/lib/model-image-distribution.js', 'resources/app/server/lib/shared-image-store.js', 'resources/app/server/server.js', 'resources/app/server/user-data.js', 'resources/app/server/db.js', 'resources/app/tests/fixtures/i18n-coverage-baseline.json']:
    assert (ROOT / file).read_bytes() == git('show', f'{BASE}:{file}'), file
    protected[file] = digest((ROOT / file).read_bytes())
runs = []
for n, arm in enumerate(['before', 'after', 'after', 'before', 'before', 'after'], 1):
    stem = OUT / f'measurement-{n}-{arm}'
    raw = gzip.decompress(pathlib.Path(str(stem)+'.json.gz').read_bytes())
    status = json.loads(pathlib.Path(str(stem)+'.status.json').read_text())
    assert digest(raw) == status['rawSha256'] and status['exitCode'] == 0
    r = json.loads(raw); runs.append(r)
    assert r['arm'] == arm and r['outputMatches'] and r['ownerMatches'] and r['noRetention'] and not r['failures']
    assert r['statuses'] == ['completed', 'completed'] and r['files'] == 2048 and r['revisionDelta'] == 2
    assert r['peakReservationBytes'] <= r['totalBudgetBytes']
    assert r['firstCanonicalLinkMs'] <= r['totalMs'] and r['firstCanonicalLinkMs'] > 0
    assert r['osPeakRssBytes'] >= r['sampledPeakRssBytes'] > 0
    for key in ['reservedBytes', 'activePermits', 'waitingCount', 'buffers', 'stagedBytes', 'scopes']:
        assert r['final'][key] == 0, key
for key in ['fixtureSha256', 'outputSha256', 'ownershipSha256', 'outcomesSha256', 'perJobConcurrency', 'acceptanceBytes']:
    assert len({str(r[key]) for r in runs}) == 1, key
for scenario in ['partial', 'cancel']:
    rs = [json.loads((OUT / f'{scenario}-{n}-{arm}.json').read_text()) for n, arm in enumerate(['before', 'after', 'after', 'before', 'before', 'after'], 1)]
    for key in ['fixtureSha256', 'outputSha256', 'status', 'failures', 'checkpoints', 'oracleMatches', 'noRetention']:
        assert len({json.dumps(r[key], sort_keys=True) for r in rs}) == 1, (scenario, key)
    assert all(r['oracleMatches'] and r['noRetention'] for r in rs)
for name, count in [('green-final-2.txt', 23), ('helper-tests.txt', 29), ('preparation-tests.txt', 10), ('native-tests.txt', 99), ('i18n-guard.txt', 5)]:
    data = (OUT / name).read_text()
    assert f'pass {count}' in data and 'fail 0' in data, name
assert 'Yeni eksik: 0' in (OUT / 'i18n.txt').read_text()
manifest = {str(p.relative_to(ROOT)): digest(p.read_bytes()) for p in SCRIPT.iterdir() if p.is_file()}
manifest.update({str(p.relative_to(ROOT)): digest(p.read_bytes()) for p in OUT.iterdir() if p.is_file() and p.name not in ['validation.json', 'source-manifest.json', 'files.txt', 'README.md']})
(OUT / 'source-manifest.json').write_text(json.dumps(dict(base=BASE, protected=protected, files=manifest), indent=2)+'\n')
(OUT / 'validation.json').write_text(json.dumps(dict(scopeOnly=True, protectedUnchanged=True, baselineEmpty=True, pairedSuccessRuns=6, pairedFaultRuns=12, equivalent=True, noRetention=True, prototypeTests=23, inheritedHelperTests=29, inheritedPreparationTests=10, nativeTests=99, i18nGuardTests=5, i18nNew=0), indent=2)+'\n')
print('PASS: scope, protected sources, raw hashes, six paired runs, 12 fault runs, canonical outputs, quiescence and test evidence')
