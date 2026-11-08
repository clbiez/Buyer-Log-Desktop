#!/usr/bin/env python3
"""Run only under the shared flock. Reuse #899 files without changing them."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / 'resources/app'
OUT = Path(__file__).resolve().parent
PREP = 'b2a4a579c5369f59e5cfb9181140a00176d944ef'
FILTERS = ['plm-image', 'plm-sync-image-override', 'plm-main-option-image',
           'plm-option-image', 'plm-colour-image', 'plm-stale-image',
           'canonical-fields', 'compute-image-registry-params',
           'global-model-image-registry', 'model-image-registry-index',
           'plm-sync-two-phase', 'plm-sync-colours-retry']


def main():
    # Do not silently run unlocked, or acquire a second conflicting flock.
    if os.environ.get('INT03_LOCK_HELD') != '1':
        raise SystemExit('Use flock -n -E 75 /tmp/buyerlog-performance-measurement.lock env INT03_LOCK_HELD=1 python3 ' + str(Path(__file__)))
    checks = []
    with tempfile.TemporaryDirectory(prefix='int03-validation-') as temporary:
        temp = Path(temporary)
        env = os.environ.copy()
        for key, name in {'BUYER_LOG_SERVER_DATA_ROOT': 'server', 'BUYER_LOG_DATA_ROOT': 'app',
                          'BUYER_LOG_LOCAL_DATA_ROOT': 'local', 'BUYER_LOG_TEMP_ROOT': 'tmp'}.items():
            directory = temp / name
            directory.mkdir()
            env[key] = str(directory)
        env.update(TMPDIR=env['BUYER_LOG_TEMP_ROOT'], TMP=env['BUYER_LOG_TEMP_ROOT'],
                   TEMP=env['BUYER_LOG_TEMP_ROOT'], BUYER_LOG_CONFIG_PATH=str(temp / 'config.json'),
                   BUYER_LOG_LOCAL_DB=str(temp / 'local/BuyerLogLocal.db'))

        def check(name, command, cwd=APP):
            start = time.monotonic()
            with (OUT / name).open('w') as log:
                result = subprocess.run(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT)
            record = dict(command=command, cwd=str(cwd), log=name, exitCode=result.returncode,
                          elapsedSeconds=round(time.monotonic() - start, 3))
            checks.append(record)
            print(json.dumps(record), flush=True)
            if result.returncode:
                print((OUT / name).read_text()[-6000:], flush=True)

        # Direct Node execution retains individual node:test assertions in logs.
        check('unit-green.txt', ['node', 'tests/int03-byte-budget-unit.test.js'])
        check('pipeline-green.txt', ['node', 'tests/int03-byte-budget-pipeline.test.js'])
        check('native-tests.txt', ['npm', 'test', '--', *FILTERS, 'int03-byte-budget'])
        check('i18n.txt', ['npm', 'run', 'i18n:check'])

        overlay = temp / 'preparation/resources/app'
        paths = ['scripts/benchmark-plm-image-memory.js', 'scripts/lib/plm-image-memory-fixture.js',
                 'scripts/lib/plm-image-memory-probe.js', 'tests/plm-image-memory-preparation.test.js']
        for relative in paths:
            data = subprocess.check_output(['git', 'show', PREP + ':resources/app/' + relative], cwd=ROOT)
            destination = overlay / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            destination.chmod(0o444)
        inherited = (overlay / 'scripts/lib/plm-image-memory-fixture.js').read_bytes()
        copied = (APP / 'tests/fixtures/int03-byte-budget/plm-image-memory-fixture.js').read_bytes()
        assert inherited == copied, '#899 fixture must remain byte-identical'
        for name in ['server', 'public', 'vendor', 'node_modules']:
            if (APP / name).exists():
                (overlay / name).symlink_to(APP / name, target_is_directory=True)
        check('preparation-tests.txt', ['node', str(overlay / 'tests/plm-image-memory-preparation.test.js')])
        report = dict(baseCommit='1796193f0a57c7785e7bf9fdb3557e33c550b25e',
                      preparationCommit=PREP, preparationFilesModified=False,
                      inheritedFixtureSha256=hashlib.sha256(inherited).hexdigest(),
                      lock='/tmp/buyerlog-performance-measurement.lock', lockFlags='-n -E 75',
                      productionIntegrated=False, fullRegressionRun=False, checks=checks)
        (OUT / 'validation.json').write_text(json.dumps(report, indent=2) + '\n')
    if any(item['exitCode'] for item in checks):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
