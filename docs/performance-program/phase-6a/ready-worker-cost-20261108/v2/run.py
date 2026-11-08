#!/usr/bin/env python3
"""Preparation only. Root runs once, serially, after pinning the current real app."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time
from zoneinfo import ZoneInfo

PACKET = Path(__file__).resolve().parent
APP = Path('/workspace/buyerlog-post-main-acceptance/resources/app')
REPO = APP.parent.parent
NODE = '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node'
PHASE0 = Path('/tmp/buyerlog-startup-shellpost901-20261107T201347-after-3/measurement.json')
SOURCE = Path('/tmp/buyerlog-first-transition-Hxb1BB/local/model-snapshots/moderator.json.gz')
SOURCE_SHA = 'e858d85fd76a1db2858098b820a0c5e20e8466d3c3895e12ad6c93c9ab9530dd'
PHASE0_SHA = '932e3e2e2c75d1b780f654ce4d13d7725a51ed35a78c949357a9e7e3a5a540b3'
ORDER = [(1, 'A'), (1, 'B'), (2, 'B'), (2, 'A'), (3, 'A'), (3, 'B')]
MIB = 1024 * 1024
DISK_CAP = 512 * MIB  # Native temporary replica included, never a source-row cap.
MIN_FREE = 640 * MIB
EMERGENCY_FREE = 128 * MIB
TIMEOUT = 1200


def check(value, message):
    if not value:
        raise RuntimeError(message)


def read(file):
    return json.loads(Path(file).read_text())


def sha(file):
    h = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for chunk in iter(lambda: stream.read(MIB), b''):
            h.update(chunk)
    return h.hexdigest()


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def day():
    value = datetime.datetime.now(ZoneInfo('Europe/Istanbul'))
    return f'{value.year}-{value.month}-{value.day}'


def save(file, value):
    raw = (json.dumps(value, indent=2) + '\n').encode()
    check(len(raw) < 8 * MIB, 'Bounded JSON evidence cap')
    temporary = file.with_name(file.name + '.writing')
    temporary.write_bytes(raw)
    os.replace(temporary, file)


def git(*args):
    return subprocess.check_output(['git', '--no-optional-locks', *args], cwd=REPO, text=True).strip()


def size(root):
    total = 0
    for item in root.rglob('*'):
        try:
            info = item.lstat()
            check(not item.is_symlink(), 'Unexpected private artifact symlink')
            if item.is_file():
                total += info.st_size
        except FileNotFoundError:
            pass
    return total


def proc(pid):
    try:
        raw = Path('/proc', str(pid), 'stat').read_text()
    except FileNotFoundError:
        return None
    fields = raw[raw.rfind(') ') + 2:].split()
    return {'pid': pid, 'ppid': int(fields[1]), 'group': int(fields[2]), 'session': int(fields[3]), 'startTicks': fields[19]}


def session_members(pid):
    found = []
    for item in Path('/proc').iterdir():
        if item.name.isdecimal():
            value = proc(int(item.name))  # Permission failure propagates; never an empty success.
            if value and (value['group'] == pid or value['session'] == pid):
                found.append(value)
    return found


def stop(process):
    actions = []
    for sig, grace in [(signal.SIGTERM, 20), (signal.SIGKILL, 10)]:
        members = session_members(process.pid)
        if members:
            try:
                os.killpg(process.pid, sig)
                actions.append({'signal': sig.name, 'at': now(), 'members': members})
            except ProcessLookupError:
                pass
        until = time.monotonic() + grace
        while time.monotonic() < until:
            process.poll()
            if not session_members(process.pid):
                return actions
            time.sleep(.1)
    raise RuntimeError('Child/session exit not proven; root inspection required')


def validate_pins(pin):
    check(pin['testsStatus'] == 'passed' and pin['exclusiveMeasurement'] is True, 'Root test/exclusive receipt required')
    check(pin['head'] == git('rev-parse', 'HEAD'), 'Root explicit HEAD mismatch')
    check(pin['appTree'] == git('rev-parse', 'HEAD:resources/app'), 'Root app tree mismatch')
    check(not git('diff', '--name-only', 'HEAD', '--', 'resources/app'), 'Tracked app dirty')
    check(not git('ls-files', '--others', '--exclude-standard', 'resources/app'), 'Untracked app files: freeze first')
    check(sha(pin['testEvidencePath']) == pin['testEvidenceSha256'], 'Root test evidence changed')
    check(sha(SOURCE) == SOURCE_SHA and sha(PHASE0) == PHASE0_SHA, 'Synthetic provenance drift')
    original = read(PHASE0)
    check(original['synthetic'] is True and original['status'] == 'passed' and original['schemaVersion'] == 3,
          'Genuine Phase 0 evidence required')
    check(original['requestedRows'] == 30000 and original['fixture']['rows'] == 30000 and original['fixture']['seed'] == 7,
          'Exact 30k synthetic input required')
    fixture = Path(original['fixtureRoot'])
    check(read(fixture / 'source/benchmark-fixture.json') == original['fixture'], 'Phase 0 source metadata mismatch')
    check(sha(fixture / 'local/model-snapshots/moderator.json.gz') == SOURCE_SHA, 'Hxb snapshot differs from genuine source')
    # No source XLSX opens, copies, aliases, fixture mutation or regenerated source.
    return original


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root-pin', required=True)
    args = parser.parse_args()
    def interrupted(signum, frame):
        raise InterruptedError('Root stopped measurement: signal ' + str(signum))
    signal.signal(signal.SIGTERM, interrupted)
    blocked = [key for key, value in os.environ.items() if value and (key.startswith(('BUYER_LOG_', 'BL_', 'READY_WORKER_', 'FIRST_TRANSITION_')) or key in ('NODE_OPTIONS', 'NODE_PATH'))]
    check(not blocked, 'Ambient overrides (names only): ' + ','.join(blocked))
    pin_path = Path(args.root_pin).resolve()
    pin = read(pin_path)
    lock_path = Path('/tmp/buyerlog-performance-measurement.lock')
    check(lock_path.is_file() and not lock_path.is_symlink(), 'Existing common OS lock required')
    with lock_path.open('r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        original = validate_pins(pin)
        root = PACKET / 'runs'
        root.mkdir(exist_ok=False)  # Never overwrite/retry a cohort.
        report = {'status': 'running', 'formalAcceptance': False, 'startedAt': now(), 'rootPin': str(pin_path),
                  'rootPinSha256': sha(pin_path), 'sourcePins': pin, 'scriptSha256': sha(PACKET / 'measure.cjs'),
                  'input': str(PHASE0), 'inputSha256': PHASE0_SHA, 'snapshot': str(SOURCE), 'snapshotSha256': SOURCE_SHA,
                  'sourceMetadata': original['fixture'], 'order': ORDER, 'day': day(), 'runs': [],
                  'admission': {'minimumFreeBytes': MIN_FREE, 'emergencyFreeBytes': EMERGENCY_FREE,
                                'packetDiskCapBytes': DISK_CAP, 'timeoutSeconds': TIMEOUT},
                  'scope': 'Current-source full producer versus current-source full+schema+ready producer. Native worker/IPC only; no UI/client performance claim.'}
        def persist():
            save(root / 'series.json', report)
        persist()
        try:
            reference = None
            for pair, arm in ORDER:
                check(day() == report['day'], 'Date rollover requires a separately declared cohort; no automatic retry')
                check(sha(pin_path) == report['rootPinSha256'] and sha(PACKET / 'measure.cjs') == report['scriptSha256'], 'Pin/script changed')
                validate_pins(pin)
                available = shutil.disk_usage('/tmp').free
                check(available >= MIN_FREE, 'Disk admission refused; preserve prior evidence')
                out = root / f'p{pair}{arm}'
                out.mkdir()
                command = [NODE, '--expose-gc', str(PACKET / 'measure.cjs'), '--arm', arm, '--out', str(out), '--day', report['day']]
                item = {'pair': pair, 'arm': arm, 'status': 'running', 'command': command, 'startedAt': now(), 'freeBeforeBytes': available}
                report['runs'].append(item)
                persist()
                env = dict(os.environ, TZ='Europe/Istanbul', READY_WORKER_COST_LOCK='held')
                process = None
                try:
                    with (out / 'native.log').open('x') as log:
                        process = subprocess.Popen(command, cwd=APP, env=env, stdout=log, stderr=subprocess.STDOUT,
                                                   start_new_session=True, pass_fds=(lock.fileno(),))
                        item['identity'] = proc(process.pid)
                        check(item['identity'] is not None, 'Cannot inspect native process')
                        started = time.monotonic()
                        item['minimumFreeBytes'] = available
                        item['peakPacketBytes'] = 0
                        while process.poll() is None:
                            free = shutil.disk_usage('/tmp').free
                            allocated = size(PACKET)
                            item['minimumFreeBytes'] = min(item['minimumFreeBytes'], free)
                            item['peakPacketBytes'] = max(item['peakPacketBytes'], allocated)
                            check(free >= EMERGENCY_FREE, 'Disk emergency: preserve failed artifacts')
                            check(allocated <= DISK_CAP, 'Packet disk cap exceeded; no artifact deletion')
                            check(time.monotonic() - started < TIMEOUT, 'Native process timeout; no retry')
                            time.sleep(.25)
                        item['returncode'] = process.returncode
                    check(not session_members(process.pid), 'Unexpected child/session remains after native process exit')
                    value = read(out / 'result.json')
                    item['result'] = value
                    check(process.returncode == 0 and value['status'] == 'passed', 'Native computation/admission failed; no retry')
                    check(value['nativeWorkerExitsVerified'] is True, 'Native worker exits not verified')
                    check(value['poolAfterClose']['workerCount'] == 0 and value['poolAfterClose']['leasedOutputBytes'] == 0,
                          'Pool resources remain after close')
                    eq = value['equivalence']
                    check(eq['status'] == 'passed' and eq['rows'] == 30000, 'Full ordinal/normalization equivalence failed')
                    comparable = {key: value['output'][key] for key in ['fullGzipSha256', 'fullJsonBytes']}
                    comparable.update(fullRowsSha256=eq['fullRowsSha256'], normalizedRowsSha256=eq['normalizedRowsSha256'],
                                      sourceProjectionKey=value['descriptor']['projectionKeys']['orders'],
                                      moduleInputKey=value['plan']['inputKeys']['orders'], contextHash=value['projectionContextHash'])
                    if reference is None:
                        reference = comparable
                    check(comparable == reference, 'Fresh-process source/full/normalized identity drift; no averaging incompatible data')
                    item.update(status='passed', finishedAt=now())
                    persist()
                    print('COMPLETE', pair, arm, value['pipelineWallMs'], flush=True)
                except BaseException as error:
                    item.update(status='failed', error=repr(error), finishedAt=now())
                    if process:
                        try:
                            item['cleanup'] = stop(process)
                        except BaseException as cleanup:
                            item['cleanupError'] = repr(cleanup)
                    if (out / 'result.json').exists():
                        item['result'] = read(out / 'result.json')
                    persist()
                    raise
            pairs = []
            for pair in [1, 2, 3]:
                values = {run['arm']: run['result'] for run in report['runs'] if run['pair'] == pair}
                pairs.append({'pair': pair, 'fullPipelineMs': values['A']['pipelineWallMs'], 'fullSchemaReadyPipelineMs': values['B']['pipelineWallMs'],
                              'addedPipelineMs': values['B']['pipelineWallMs'] - values['A']['pipelineWallMs'],
                              'fullGzipBytes': values['A']['output']['selectedGzipBytes'], 'readyGzipBytes': values['B']['output']['selectedGzipBytes'],
                              'fullJsonBytes': values['A']['output']['selectedJsonBytes'], 'readyJsonBytes': values['B']['output']['selectedJsonBytes']})
            report['pairs'] = pairs
            report['medians'] = {key: sorted(pair[key] for pair in pairs)[1] for key in pairs[0] if key != 'pair'}
            report['status'] = 'completed-cost-evidence'
            report['interpretation'] = 'No acceptance or application latency claim. Report every native admission, pipeline/schema/ready/IPC cost and full-source setup. Full graph materialization/verification is not thin-client savings. Old f4a or transport-only timings are not comparable.'
        except BaseException as error:
            report.update(status='failed', error=repr(error))
            raise
        finally:
            report['finishedAt'] = now()
            persist()


if __name__ == '__main__':
    main()
