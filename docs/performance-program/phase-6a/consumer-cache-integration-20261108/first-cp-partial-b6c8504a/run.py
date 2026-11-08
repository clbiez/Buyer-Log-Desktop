#!/usr/bin/env python3
"""Preparation only: root must review and supply its green receipt before running."""
import argparse
import ctypes
import datetime
import fcntl
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import time

PACKET = Path(__file__).resolve().parent
NODE = '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node'
LOCK = Path('/tmp/buyerlog-performance-measurement.lock')
MANIFEST = Path('/tmp/buyerlog-908-orders-regression-trace/prepared-manifest.json')
OBSERVER = Path('/tmp/buyerlog-908-firstcp-final-after917/observer.cjs')
CONTRACT = Path('/tmp/buyerlog-908-firstcp-final-after917/predeclared-equivalence.json')
INPUT = Path('/tmp/buyerlog-startup-shellpost901-20261107T201347-after-3/measurement.json')
ANCHOR = Path('/tmp/buyerlog-first-transition-Hxb1BB')
ANCHOR_RECEIPT = Path('/tmp/buyerlog-phase6a-shadow-live-smoke/first/receipt.json')
ARMS = {'A': Path('/workspace/buyerlog-analytics904'), 'B': Path('/workspace/buyerlog-post-main-acceptance')}
BASE = '1796193f0a57c7785e7bf9fdb3557e33c550b25e'
CANDIDATE = '9a294b09f40c542b869e5996296393b6978e9f16'
PINS = {
    OBSERVER: '1b0301d765ae8970917430c95dabe113749b76815bc2d115a5e59a273f2fe451',
    CONTRACT: '0b67cf8b9f0fa02c7a1f5ab7b379803899e1cf8795fa5958124f31f955c9f3f9',
    INPUT: '932e3e2e2c75d1b780f654ce4d13d7725a51ed35a78c949357a9e7e3a5a540b3',
}
NATIVE_PINS = {
    'scripts/benchmark-first-transitions.js': 'bd746f1a38b692223b8f62b88aa4e3355932714e01fde4ca8fbd4f41d0025cd1',
    'scripts/lib/first-transition-probe.js': '403fd707ded5af40409e64baeae4f6b10d4fbd9c1f35dad82e9a76beb6b607cb',
    'scripts/lib/startup-benchmark.js': 'fefbd5ec7ca9cef7769d0695348461c145fc0eb37292eea976f4fe6fd12d1ca7',
}
NAMES = {'ASAS - Demo.xlsx', 'Antrepo - Demo.xlsx', 'LFL - Demo.xlsx'}
ORDER = [(1, 'A'), (1, 'B'), (2, 'B'), (2, 'A'), (3, 'A'), (3, 'B')]
MIB = 1024 * 1024
ADMIT = 192 * MIB
EMERGENCY = 96 * MIB
ARM_TIMEOUT = 2400  # Includes two native transitions and post-timing captures.
POLL_SECONDS = .1


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def read(path):
    return json.loads(Path(path).read_text())


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(MIB), b''):
            h.update(block)
    return h.hexdigest()


def compact(value):
    # All values hashed this way are arrays of string IDs and string cell text.
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def save(path, value):
    path = Path(path)
    tmp = path.with_name(path.name + '.writing')
    with tmp.open('w') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, path)


def git(tree, *args):
    return subprocess.check_output(['git', '--no-optional-locks', *args], cwd=tree, text=True).strip()


def identity(pid):
    try:
        raw = Path('/proc', str(pid), 'stat').read_text()
    except FileNotFoundError:
        return None
    # comm can contain spaces and parentheses; field 22 is starttime.
    fields = raw[raw.rfind(') ') + 2:].split()
    require(len(fields) >= 20, 'Malformed /proc stat for ' + str(pid))
    return {'pid': pid, 'state': fields[0], 'ppid': int(fields[1]),
            'pgrp': int(fields[2]), 'session': int(fields[3]), 'startTicks': fields[19]}


def snapshot():
    found = {}
    for entry in Path('/proc').iterdir():
        if entry.name.isdecimal():
            value = identity(int(entry.name))  # EACCES is a failure, never an empty child list.
            if value is not None:
                found[value['pid']] = value
    require(os.getpid() in found, 'Cannot inspect own process identity')
    return found


class Tracker:
    def __init__(self, process, output):
        self.process, self.output = process, output
        self.records = {}
        self.events = output / 'child-process-events.jsonl'
        self.scan()
        require(any(x['pid'] == process.pid for x in self.records.values()), 'Launcher identity not observable')

    def event(self, value):
        with self.events.open('a') as stream:
            stream.write(json.dumps(value) + '\n')

    def scan(self):
        table = snapshot()
        matched = {pid for pid, p in table.items()
                   if (pid == self.process.pid and not self.records) or p['pgrp'] == self.process.pid or p['session'] == self.process.pid
                   or (pid, p['startTicks']) in self.records}
        # Subreaper-adopted descendants remain attributable even after their parent exits.
        matched.update(pid for pid, p in table.items() if p['ppid'] == os.getpid())
        changed = True
        while changed:
            more = {pid for pid, p in table.items() if p['ppid'] in matched}
            changed = not more.issubset(matched)
            matched.update(more)
        live = []
        for pid in matched:
            p = table[pid]
            key = (pid, p['startTicks'])
            if key not in self.records:
                p = dict(p, firstSeenAt=now(), lastSeenAt=now(), exitedAt=None)
                self.records[key] = p
                self.event(dict(p, event='first-seen'))
            self.records[key]['lastSeenAt'] = now()
            live.append(table[pid])
        for key, p in self.records.items():
            current = table.get(key[0])
            if not p['exitedAt'] and (current is None or current['startTicks'] != key[1]):
                p['exitedAt'] = now()
                self.event({'event': 'identity-gone', 'pid': key[0], 'startTicks': key[1], 'at': p['exitedAt']})
        # Check task children recursively as a second visibility path. An unreadable
        # file fails the run; an empty file alone never proves that children exited.
        for p in live:
            try:
                task_root = Path('/proc', str(p['pid']), 'task')
                for task in task_root.iterdir():
                    children = (task / 'children').read_text().split()
                    for child in children:
                        child_id = identity(int(child))
                        if child_id and (child_id['pid'], child_id['startTicks']) not in self.records:
                            self.records[(child_id['pid'], child_id['startTicks'])] = dict(
                                child_id, firstSeenAt=now(), lastSeenAt=now(), exitedAt=None)
                            self.event(dict(child_id, event='task-child-first-seen', at=now()))
                            live.append(child_id)
            except FileNotFoundError:
                pass  # Process/task exited during enumeration; next scan proves identity gone.
        # Reap only adopted zombies; Popen retains ownership of the native launcher.
        for p in live:
            if p['pid'] != self.process.pid and p['ppid'] == os.getpid() and p['state'] == 'Z':
                try:
                    waited, status = os.waitpid(p['pid'], os.WNOHANG)
                    if waited:
                        self.event({'event': 'adopted-reaped', 'pid': waited, 'startTicks': p['startTicks'], 'status': status, 'at': now()})
                except ChildProcessError:
                    pass
        return live

    def finish_record(self):
        save(self.output / 'child-processes.json', list(self.records.values()))

    def terminate(self, cause):
        self.event({'event': 'emergency-cleanup', 'cause': str(cause), 'at': now()})
        for sig, grace in [(signal.SIGTERM, 10), (signal.SIGKILL, 10)]:
            live = self.scan()
            group = [p for p in live if p['pgrp'] == self.process.pid]
            if group:
                try:
                    os.killpg(self.process.pid, sig)
                except ProcessLookupError:
                    pass
            for p in live:
                current = identity(p['pid'])
                if current and current['startTicks'] == p['startTicks']:
                    try:
                        os.kill(p['pid'], sig)
                    except ProcessLookupError:
                        pass
            until = time.monotonic() + grace
            while time.monotonic() < until:
                self.process.poll()
                if not self.scan():
                    self.finish_record()
                    return
                time.sleep(POLL_SECONDS)
        self.finish_record()
        require(not self.scan(), 'CHILD: identity remains after emergency cleanup; root must inspect')


def free_bytes():
    return shutil.disk_usage('/tmp').free


def copied_size(root):
    total = 4096
    for path in root.rglob('*'):
        relative = path.relative_to(root)
        if str(relative) == 'server.log' or relative.parts[:2] == ('local', 'logs') or (len(relative.parts) == 1 and path.name.endswith('.png')):
            continue
        require(not path.is_symlink(), 'Input contains symlink: ' + str(relative))
        info = path.stat()
        require(path.is_dir() or stat.S_ISREG(info.st_mode), 'Input contains special file')
        total += 4096 if path.is_dir() else max(4096, ((info.st_size + 4095) // 4096) * 4096)
    return total


def preflight(receipt, heads):
    require(receipt.get('status') == 'passed' and receipt.get('exclusiveExecutionConfirmed') is True,
            'Root green/exclusive execution receipt required')
    suite = receipt['fullSuite']
    require(suite['status'] == 'passed', 'Root full suite is not green')
    require(suite['batches'] == [{'batch': i, 'status': 'passed'} for i in range(1, 11)], 'All 10 root batches must pass')
    require(sha(suite['evidencePath']) == suite['evidenceSha256'], 'Root raw suite evidence changed')
    require(receipt['sourcePins']['B']['head'] == suite['candidateHead'], 'Suite does not bind candidate HEAD')
    for arm, tree in ARMS.items():
        pin = receipt['sourcePins'][arm]
        require(pin['head'] == heads[arm] == git(tree, 'rev-parse', 'HEAD'), 'Explicit HEAD mismatch: ' + arm)
        require(pin['appTree'] == git(tree, 'rev-parse', 'HEAD:resources/app'), 'Root app tree pin mismatch: ' + arm)
        require(not git(tree, 'diff', '--name-only', 'HEAD', '--', 'resources/app'), 'Tracked app dirty: ' + arm)
        require(not git(tree, 'ls-files', '--others', '--exclude-standard', 'resources/app'), 'Untracked app files: ' + arm)
        for relative, expected in NATIVE_PINS.items():
            require(sha(tree / 'resources/app' / relative) == expected, 'Native benchmark changed: ' + arm + ':' + relative)
    for path, expected in PINS.items():
        require(sha(path) == expected, 'Pinned evidence changed: ' + str(path))
    manifest = read(MANIFEST)
    require(manifest['timezone'] == 'Europe/Istanbul', 'Timezone pin changed')
    require(manifest['playwrightActual'] == '/opt/codex/cua_node/lib/node_modules/playwright', 'Playwright pin changed')
    require(manifest['chromium'] == '/usr/bin/chromium', 'Chromium pin changed')
    require(Path(NODE).is_file() and Path(manifest['chromium']).is_file(), 'Runtime unavailable')
    original = read(INPUT)
    require(original['status'] == 'passed' and original['synthetic'] is True and original['schemaVersion'] == 3
            and len(original['measurements']) == 4 and original['requestedRows'] == 30000, 'Genuine Phase 0 input required')
    source = Path(original['fixtureRoot'])
    require(source == INPUT.parent and source.resolve() == source, 'Unexpected original fixture path')
    marker = read(source / 'source/benchmark-fixture.json')
    require(marker == original['fixture'] and marker['rows'] == 30000 and marker['seed'] == 7, 'Source metadata mismatch')
    require(set(marker['hashes']) == NAMES, 'Expected exactly three source XLSX hashes')
    for root in [source, ANCHOR]:
        require(root.resolve() == root, 'Fixture root alias forbidden')
        actual = {p.name for p in (root / 'source').iterdir() if p.suffix.lower() == '.xlsx'}
        require(actual == NAMES, 'Source XLSX file count/name mismatch')
        for name, expected in marker['hashes'].items():
            file = root / 'source' / name
            require(not file.is_symlink() and stat.S_ISREG(file.stat().st_mode), 'Regular immutable XLSX required')
            require(sha(file) == expected, 'Source XLSX SHA mismatch: ' + str(file))
    require(ANCHOR_RECEIPT.is_file(), 'Completed anchor receipt unavailable')
    # Root supplies the completion proof explicitly, including the original receipt SHA.
    anchor = receipt['completedAnchor']
    require(anchor['path'] == str(ANCHOR) and anchor['receiptPath'] == str(ANCHOR_RECEIPT)
            and anchor['childrenExited'] is True and anchor['liveAfterExit'] == []
            and sha(ANCHOR_RECEIPT) == anchor['receiptSha256'], 'Anchor completion proof mismatch')
    return original, marker, manifest, copied_size(source)


def validate(out, original):
    report = read(out / 'measurement.json')
    contract = read(CONTRACT)
    require(contract['declaredBeforeRuns'] is True, 'Predeclared contract missing')
    require(report['status'] == 'passed' and report['input'] == str(INPUT), 'Native measurement failed')
    require(report['sourceRows'] == 30000 and report['fixtureHashes'] == original['fixture']['hashes'], 'Native source mismatch')
    require(report['expected'] == original['expected'] and report['rendererErrors'] == [], 'Expected metadata/errors mismatch')
    require([t['module'] for t in report['transitions']] == ['cp', 'orders'], 'Native cp+orders sequence changed')
    captures = read(out / 'post-timing-data.json')
    require([(c['stage'], c['module']) for c in captures] == [('initial', 'cp'), ('initial', 'orders')], 'Extra/missing observer navigation')
    fixture = Path(report['fixtureRoot'])
    require(fixture.parent == Path('/tmp') and fixture.name.startswith('buyerlog-first-transition-')
            and fixture.resolve() == fixture and fixture not in [INPUT.parent, ANCHOR], 'Unexpected fresh fixture')
    disk = read(fixture / 'local/page-cache/moderator/manifest.json')
    require(disk['activeGeneration'] == original['expected']['generation']
            and disk['sourceRevisionKey'] == original['expected']['sourceRevision'], 'Disk generation/revision mismatch')
    initial = next(x for x in original['measurements'] if x['module'] == 'overview')['initialGeneration']
    metrics = {}
    variants = {}
    for transition, capture in zip(report['transitions'], captures):
        module = transition['module']
        require(transition['status'] == 'passed' and transition['visibilityProbeVersion'] == 2
                and transition['rowVisibilityVerified'] is True and transition['canAccess'] is True, 'Native row readiness failed')
        require(transition['errors'] == [] and transition['initialGeneration'] == initial, 'Initial generation/errors mismatch')
        require(transition['revisions'] == original['expected']['revisions'], 'Store revision mismatch')
        generations = transition['projectionGenerations']
        require(generations and all(g == original['expected']['generation'] for g in generations), 'Projection generation mismatch')
        require(capture['unobscured'] is True and capture['timezone'] == 'Europe/Istanbul', 'Covered row or timezone mismatch')
        require(capture['rows'] == transition['rows'] == original['expected']['rows'][module], 'Row count mismatch')
        expected_rows = contract['fullNormalizedRows'][module]
        require(capture['normalizedRowsSha256'] == expected_rows, 'Full normalized-row SHA mismatch')
        h = hashlib.sha256()
        with gzip.open(out / ('initial-' + module + '-normalized-rows.json.gz'), 'rb') as stream:
            for block in iter(lambda: stream.read(MIB), b''):
                h.update(block)
        require(h.hexdigest() == expected_rows, 'Saved full normalized rows differ from observer SHA')
        schema = read(out / ('initial-' + module + '-schema-cells.json'))
        cells = schema['cells']  # Every row, every cell, unchanged order. Never slice/sort/normalize.
        require(len(cells) == transition['domRows'] == 50, 'Unexpected visible row count')
        counts = [len(row['cells']) for row in cells]
        require(counts == capture['cellsPerRow'] and len(set(counts)) == 1, 'Nonuniform/inconsistent visible cells')
        variant = str(counts[0])
        if module == 'orders':
            require(variant in ('53', '60'), 'Unregistered Orders schema variant')
            expected_cells = contract['ordersFullVisibleCellsByObservedBaselineVariant'][variant]
            expected_header = contract['ordersHeaders'][variant]
        else:
            expected_cells = contract['cpFullVisibleCellsSha256']
            expected_header = contract['cpHeader']
        require(schema['schemas'][module]['header'] == expected_header, 'Full header mismatch: ' + module)
        exact_cells = [{'id': row['id'], 'cells': [cell['text'] for cell in row['cells']]} for row in cells]
        require(hashlib.sha256(compact(exact_cells)).hexdigest() == expected_cells == capture['visibleCellsSha256'], 'Full visible-cell SHA mismatch')
        variants[module] = int(variant)
        metrics[module] = {key: transition[key] for key in ['elapsedMs', 'firstRowsPaintedMs', 'dataReadyMs', 'observationEndMs', 'maxPollGapMs']}
        metrics[module].update(startupReadyMs=transition['startup']['startupReadyMs'],
                               startupUserWaitMs=transition['startup']['userWaitMs'],
                               systemToStablePaintMs=transition['paintedAtMs'] - transition['startup']['userWaitMs'])
        require(all(isinstance(v, (int, float)) and math.isfinite(v) and v >= 0 for v in metrics[module].values()), 'Invalid time metric')
        png = fixture / (module + '.png')
        with png.open('rb') as stream:
            require(stream.read(8) == b'\x89PNG\r\n\x1a\n', 'Real native PNG missing')
    return report, fixture, metrics, variants


def metadata(file):
    info = file.stat()
    return {'device': info.st_dev, 'inode': info.st_ino, 'mode': stat.S_IMODE(info.st_mode),
            'uid': info.st_uid, 'gid': info.st_gid, 'bytes': info.st_size, 'nlink': info.st_nlink,
            'ctimeNs': info.st_ctime_ns, 'mtimeNs': info.st_mtime_ns}


def dedup(out, fixture, marker, tracker):
    require(not tracker.scan(), 'CHILD: no artifact mutation while descendants exist')
    require((fixture / 'source').resolve() == fixture / 'source'
            and (ANCHOR / 'source').resolve() == ANCHOR / 'source', 'Source directory alias forbidden')
    require({p.name for p in (fixture / 'source').iterdir() if p.suffix.lower() == '.xlsx'} == NAMES,
            'Expected exactly three completed-fixture XLSX files')
    changes = []
    for name, expected in marker['hashes'].items():
        original, target = ANCHOR / 'source' / name, fixture / 'source' / name
        require(not original.is_symlink() and not target.is_symlink(), 'Hardlink target alias forbidden')
        before, original_before = metadata(target), metadata(original)
        require(before['mode'] == original_before['mode'] and before['device'] == original_before['device'], 'Hardlink mode/device mismatch')
        require(sha(original) == sha(target) == expected, 'Hardlink byte equality failed')
        temporary = target.with_name(target.name + '.completed-hardlink')
        require(not temporary.exists(), 'Hardlink temporary path already exists')
        record = {'path': str(target), 'anchor': str(original), 'sha256': expected, 'before': before,
                  'anchorBefore': original_before, 'status': 'prepared'}
        changes.append(record)
        save(out / 'post-exit-source-hardlink.json', {'onlyAfterAllChildIdentitiesGone': True, 'changes': changes})
        os.link(original, temporary)
        os.replace(temporary, target)
        after, original_after = metadata(target), metadata(original)
        require(after['inode'] == original_after['inode'] and after['mode'] == before['mode'], 'Hardlink identity/mode changed')
        require(sha(original) == sha(target) == expected, 'Hardlink verification failed')
        record.update(after=after, anchorAfter=original_after, status='completed')
        save(out / 'post-exit-source-hardlink.json', {'onlyAfterAllChildIdentitiesGone': True, 'changes': changes,
             'effects': 'Only the three source XLSX directory entries replaced. Bytes/paths/modes identical; inode, ctime, nlink and possibly target mtime/ownership change to anchor values. No chmod/chown; all JSON/log/profile/PNG files retained.'})


def summarize(runs):
    summary, failures = {}, []
    for module in ['cp', 'orders']:
        summary[module] = {}
        for metric in ['elapsedMs', 'firstRowsPaintedMs', 'dataReadyMs']:
            pairs = []
            for pair in [1, 2, 3]:
                values = {r['arm']: r['metrics'][module][metric] for r in runs if r['pair'] == pair}
                pairs.append({'pair': pair, **values, 'deltaMs': values['B'] - values['A'],
                              'percent': (values['B'] / values['A'] - 1) * 100 if values['A'] else None})
            medians = {arm: sorted(p[arm] for p in pairs)[1] for arm in ['A', 'B']}
            regression = medians['B'] > medians['A'] or any(p['deltaMs'] > 0 for p in pairs)
            summary[module][metric] = {'pairs': pairs, 'medians': medians, 'anyPairOrMedianRegression': regression}
            if regression:
                failures.append(module + ':' + metric)
    return summary, failures


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root-green-receipt', required=True)
    parser.add_argument('--candidate-head', default=CANDIDATE)
    args = parser.parse_args()
    def interrupted(signum, frame):
        raise InterruptedError('Root interrupted wrapper: signal ' + str(signum))
    signal.signal(signal.SIGTERM, interrupted)
    require(re.fullmatch('[0-9a-f]{40}', args.candidate_head), 'Explicit full candidate SHA required')
    require(os.environ.get('PYTHONOPTIMIZE', '') == '', 'Do not run an optimized/unreviewed wrapper')
    blocked = [k for k, v in os.environ.items() if v and (k.startswith('BUYER_LOG_') or k.startswith('BL_')
               or k.startswith('FIRST_TRANSITION_') or k.startswith('ORDERS_DIAGNOSTIC_') or k in ['NODE_OPTIONS', 'NODE_PATH', 'PLAYWRIGHT_MODULE', 'CHROMIUM_PATH'])]
    require(not blocked, 'Ambient overrides present (names only): ' + ','.join(blocked))
    require(LOCK.is_file() and not LOCK.is_symlink(), 'Existing common lock required')
    with LOCK.open('r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        # Inherited by native launcher; descendants cannot make the lock vanish if
        # this wrapper is killed. Never unlink or truncate the common lock file.
        receipt_path = Path(args.root_green_receipt).resolve()
        receipt = read(receipt_path)
        heads = {'A': BASE, 'B': args.candidate_head}
        original, marker, manifest, copy_bytes = preflight(receipt, heads)
        require(ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0, 'Linux child-subreaper unavailable')
        snapshot()  # Check process visibility before creating/launching anything.
        root = PACKET / 'runs'
        root.mkdir(exist_ok=False)  # No reuse/retry/overwrite of an earlier cohort.
        report = {'status': 'running', 'formalAcceptance': False, 'startedAt': now(), 'order': ORDER,
                  'rootReceipt': str(receipt_path), 'rootReceiptSha256': sha(receipt_path), 'sourcePins': receipt['sourcePins'],
                  'nativePins': NATIVE_PINS, 'observerSha256': PINS[OBSERVER], 'contractSha256': PINS[CONTRACT],
                  'input': str(INPUT), 'inputSha256': PINS[INPUT], 'sourceMetadata': marker,
                  'anchor': receipt['completedAnchor'], 'timezone': 'Europe/Istanbul', 'chromium': manifest['chromium'],
                  'playwrightActual': manifest['playwrightActual'], 'playwrightModule': str(OBSERVER),
                  'copyAllocatedEstimateBytes': copy_bytes, 'admissionBytes': max(ADMIT, copy_bytes + 89 * MIB),
                  'emergencyFreeBytes': EMERGENCY, 'timeoutSecondsPerArm': ARM_TIMEOUT, 'pollSeconds': POLL_SECONDS,
                  'processAccounting': 'PID+startTicks; recursive /proc tasks, session/group scan and child subreaper; observed lifetimes retained. Polling cannot enumerate a grandchild born and reaped entirely between scans.',
                  'runs': []}
        def persist():
            save(root / 'series.json', report)
        persist()
        try:
            for pair, arm in ORDER:
                require(sha(receipt_path) == report['rootReceiptSha256'], 'Root receipt changed')
                preflight(receipt, heads)
                available = free_bytes()
                report.setdefault('admissions', []).append({'pair': pair, 'arm': arm, 'at': now(), 'freeBytes': available,
                                                            'requiredBytes': report['admissionBytes']})
                persist()
                require(available >= report['admissionBytes'], 'DISK: per-arm admission refused; all prior artifacts retained')
                out = root / ('p' + str(pair) + arm)
                out.mkdir()
                app = ARMS[arm] / 'resources/app'
                command = [NODE, str(app / 'scripts/benchmark-first-transitions.js'), '--app-root', str(app),
                           '--measurement', str(INPUT), '--out', str(out / 'measurement.json')]
                item = {'pair': pair, 'arm': arm, 'head': heads[arm], 'status': 'running', 'startedAt': now(),
                        'command': command, 'output': str(out), 'freeBeforeBytes': available}
                report['runs'].append(item)
                persist()
                env = dict(os.environ, TZ='Europe/Istanbul', TMPDIR='/tmp', TMP='/tmp', TEMP='/tmp',
                           CHROMIUM_PATH=manifest['chromium'], PLAYWRIGHT_MODULE=str(OBSERVER),
                           FIRST_TRANSITION_EXTRA=str(out / 'post-timing-data.json'))
                process = tracker = None
                try:
                    with (out / 'benchmark.log').open('x') as log:
                        process = subprocess.Popen(command, cwd=app, env=env, stdout=log, stderr=subprocess.STDOUT,
                                                   start_new_session=True, pass_fds=(lock.fileno(),))
                        tracker = Tracker(process, out)
                        item['launcherPid'] = process.pid
                        persist()
                        started = time.monotonic()
                        child_grace = None
                        min_free = available
                        while True:
                            code = process.poll()
                            live = tracker.scan()
                            disk_free = free_bytes()
                            min_free = min(min_free, disk_free)
                            require(disk_free >= EMERGENCY, 'DISK: below 96 MiB; emergency stop, retain failed artifacts')
                            require(time.monotonic() - started <= ARM_TIMEOUT, 'TIMEOUT: native arm exceeded wall clock budget')
                            if code is not None:
                                if not live:
                                    break
                                if child_grace is None:
                                    child_grace = time.monotonic()
                                require(time.monotonic() - child_grace <= 15, 'CHILD: descendants remain after native launcher exit')
                            time.sleep(POLL_SECONDS)
                        item.update(returncode=code, minimumFreeBytes=min_free, childrenExitedBeforeArtifactMutation=True)
                        tracker.finish_record()
                    require(code == 0, 'Native command failed; no retry')
                    measurement, fixture, metrics, variants = validate(out, original)
                    item.update(fixtureRoot=str(fixture), metrics=metrics, schemaVariants=variants, dataEq='passed')
                    # No dedup on failed or indeterminate data equivalence.
                    dedup(out, fixture, marker, tracker)
                    item.update(status='passed', finishedAt=now(), freeAfterBytes=free_bytes())
                    persist()
                    print('COMPLETE', pair, arm, json.dumps(metrics), flush=True)
                except BaseException as error:
                    item.update(status='failed', error=repr(error), finishedAt=now())
                    if tracker:
                        try:
                            tracker.terminate(error)
                        except BaseException as cleanup_error:
                            item['childCleanupError'] = repr(cleanup_error)
                    elif process:
                        # Tracker setup itself failed: kill only this newly created session.
                        for sig in [signal.SIGTERM, signal.SIGKILL]:
                            try:
                                os.killpg(process.pid, sig)
                            except ProcessLookupError:
                                pass
                        process.wait(timeout=15)
                        item['childrenExitedBeforeArtifactMutation'] = False
                    persist()
                    raise
            report['summary'], regressions = summarize(report['runs'])
            report['regressions'] = regressions
            report['cpAnyPairOrMedianRegression'] = any(x.startswith('cp:') for x in regressions)
            report['status'] = 'failed-regression' if regressions else 'completed-no-observed-regression'
            report['interpretation'] = 'Three fixed pairs only. Any positive pair or median latency delta fails; no automatic acceptance, phase completion, Windows/Electron claim, or merge authorization.'
            persist()
            if regressions:
                raise RuntimeError('Measured regression: ' + ', '.join(regressions))
        except BaseException as error:
            if report['status'] == 'running':
                report['status'] = 'failed'
            report['error'] = repr(error)
            raise
        finally:
            report['finishedAt'] = now()
            persist()


if __name__ == '__main__':
    main()
