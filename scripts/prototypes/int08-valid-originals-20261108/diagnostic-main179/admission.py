"""Local diagnostic admission. Launch with flock -n -E 75 -F LOCK COMMAND."""
import fcntl
import os
import pathlib
import resource
from storage import atomic_json

LOCK = pathlib.Path('/tmp/buyerlog-performance-measurement.lock')

def require_flock():
    expected = LOCK.stat()
    for entry in pathlib.Path('/proc/self/fd').iterdir():
        try:
            fd = int(entry.name)
            if fd < 3 or not os.path.samestat(os.fstat(fd), expected):
                continue
            # An inherited flock descriptor refers to the same open file
            # description. Reasserting its lock succeeds without a second lock.
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return
        except (OSError, ValueError):
            continue
    raise RuntimeError('Launch with flock -n -E 75 -F /tmp/buyerlog-performance-measurement.lock')

def memory_admit(root, phase, required):
    cgroup = pathlib.Path('/sys/fs/cgroup')
    limit = (cgroup/'memory.max').read_text().strip()
    current = int((cgroup/'memory.current').read_text())
    host_available = int(next(line.split()[1] for line in pathlib.Path('/proc/meminfo').read_text().splitlines()
                              if line.startswith('MemAvailable:'))) * 1024
    available = min(host_available, int(limit)-current) if limit != 'max' else host_available
    disk = os.statvfs(root)
    record = dict(phase=phase, requiredMemoryBytes=required, availableMemoryBytes=available,
                  memoryLimitBytes=limit, memoryCurrentBytes=current,
                  availableInodes=disk.f_favail, requiredInodes=20000,
                  cpuQuota=(cgroup/'cpu.max').read_text().strip(),
                  estimate='9 GiB sequential peak: server 2 GiB, renderer 4 GiB, image/encoded/export/trace 2 GiB, reserve 1 GiB; no workload reductions',
                  sufficient=available >= required and disk.f_favail >= 20000)
    atomic_json(pathlib.Path(root)/('admission-'+phase+'.json'), record)
    if not record['sufficient']:
        raise RuntimeError('Memory/inode admission declined: '+str(record))
    return record
