#!/usr/bin/env python3
"""Run under the shared external flock; retain failures and lossless raw data."""
import gzip, hashlib, json, os, pathlib, platform, statistics, subprocess, time
ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/performance-program/contrib-int03-pipeline-adapter-20261108'
SCRIPT = ROOT / 'scripts/prototypes/int03-pipeline-adapter-20261108/measure.js'

def main():
    plan = ['before', 'after', 'after', 'before', 'before', 'after']
    runs = []
    env = dict(os.environ)
    env.setdefault('NODE_PATH', '/workspace/.buyerlog-tools/node_modules')
    for index, arm in enumerate(plan, 1):
        stem = OUT / f'measurement-{index}-{arm}'
        started = time.time()
        proc = subprocess.run(['node', str(SCRIPT), arm], cwd=ROOT, env=env, capture_output=True)
        with gzip.open(str(stem) + '.json.gz', 'wb') as f:
            f.write(proc.stdout)
        pathlib.Path(str(stem) + '.stderr.txt').write_bytes(proc.stderr)
        status = dict(index=index, arm=arm, exitCode=proc.returncode, wallSeconds=time.time()-started, rawSha256=hashlib.sha256(proc.stdout).hexdigest())
        pathlib.Path(str(stem) + '.status.json').write_text(json.dumps(status, indent=2)+'\n')
        print(json.dumps(status), flush=True)
        if proc.returncode:
            raise SystemExit(proc.returncode)
        r = json.loads(proc.stdout)
        runs.append(r)
    for key in ['fixtureSha256', 'outputSha256', 'ownershipSha256', 'outcomesSha256', 'acceptanceBytes', 'jobs', 'perJobConcurrency', 'files', 'revisionDelta']:
        assert len({json.dumps(r[key], sort_keys=True) for r in runs}) == 1, key
    for r in runs:
        assert r['outputMatches'] and r['ownerMatches'] and r['noRetention'] and r['failures'] == []
    keys = ['osPeakRssBytes', 'sampledPeakExternalBytes', 'sampledPeakArrayBufferBytes', 'peakReservationBytes', 'peakStagedBytes', 'firstCanonicalLinkMs', 'totalMs']
    medians = {a: {k: statistics.median([r[k] for r in runs if r['arm'] == a]) for k in keys} for a in ['before', 'after']}
    summary = dict(order=plan, medians=medians, equivalent=True, notes=['prototype only; canonical link is not UI visibility', 'reservation is not RSS', 'both arms use the identical strict stream transport', 'both arms inject one shared initial mutable ownership snapshot', 'canonical first link intentionally waits until staging is complete to preserve one patch per job'], fixtureSha256=runs[0]['fixtureSha256'], outputSha256=runs[0]['outputSha256'], runs=[{k: r[k] for k in ['arm', *keys, 'outputMatches', 'ownerMatches', 'noRetention', 'revisionDelta', 'files', 'statuses']} for r in runs])
    (OUT / 'measurement-summary.json').write_text(json.dumps(summary, indent=2)+'\n')
    print(json.dumps(medians), flush=True)

if __name__ == '__main__':
    main()
