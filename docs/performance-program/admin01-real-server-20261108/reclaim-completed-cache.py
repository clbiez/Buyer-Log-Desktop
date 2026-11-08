"""Retain bytes; advise away only this diagnostic's completed runtime file cache."""
import json
import os
import pathlib
import sys

doc = pathlib.Path(__file__).resolve().parent
runtime = doc / 'runtime'
cohort = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else doc / 'cohort-v3'
output = pathlib.Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else doc / 'cache-admission.json'
assert cohort.parent == doc
assert output.is_relative_to(doc) and not output.exists()
before = int(pathlib.Path('/sys/fs/cgroup/memory.current').read_text())
files = []
for report in sorted(cohort.glob('*/report.json')):
    value = json.loads(report.read_text())
    if value['status'] != 'passed':
        continue
    root = pathlib.Path(value['root'])
    assert root.resolve().parent == runtime.resolve()
    assert root.name.startswith(cohort.name + '-')
    for file in root.rglob('*'):
        if file.is_symlink() or not file.is_file():
            continue
        fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            stat = os.fstat(fd)
            os.fsync(fd)
            os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
            assert (os.fstat(fd).st_size, os.fstat(fd).st_mtime_ns) == (stat.st_size, stat.st_mtime_ns)
            files.append({'path': str(file), 'size': stat.st_size})
        finally:
            os.close(fd)
after = int(pathlib.Path('/sys/fs/cgroup/memory.current').read_text())
output.write_text(json.dumps({
    'beforeMemoryCurrentBytes': before, 'afterMemoryCurrentBytes': after,
    'advice': 'POSIX_FADV_DONTNEED after fsync; completed diagnostic runtime files only',
    'filesDeleted': 0, 'files': files,
    'seedAndFutureRunCacheUntouched': True,
}, indent=2) + '\n')
print(json.dumps({'beforeMemoryCurrentBytes': before, 'afterMemoryCurrentBytes': after, 'files': len(files)}))
