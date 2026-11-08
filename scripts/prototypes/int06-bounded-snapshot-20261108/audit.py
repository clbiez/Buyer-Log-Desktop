"""Read-only preservation/scope checks; write only new task evidence."""
import hashlib
import json
import subprocess
from pathlib import Path

repo = Path(__file__).resolve().parents[3]
out = repo / 'docs/performance-program/contrib-int06-bounded-snapshot-20261108'
delivery = '392cc5574464690423e6e9cf6f9031549bae6188'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=repo, text=True).strip()
assert subprocess.run(['git', 'merge-base', '--is-ancestor', delivery, 'HEAD'], cwd=repo).returncode == 0
preserved = json.loads((out / 'preserved-inputs.json').read_text())
for item in preserved['files']:
    assert sha(repo / item['path']) == item['sha256'], item['path']
protected = json.loads((repo / 'docs/performance-program/contrib-int06-checkpoint-journal-20261108/protected-source-audit.json').read_text())
for item in protected['files']:
    assert sha(repo / item['path']) == item['sha256'], item['path']
baseline = json.loads((repo / 'resources/app/tests/fixtures/i18n-coverage-baseline.json').read_text())
assert baseline['files'] == {}, 'i18n baseline must remain empty'
changes = sorted(set(filter(None, git('diff', '--name-only', delivery).splitlines()
                            + git('ls-files', '--others', '--exclude-standard').splitlines())))
helper = 'resources/app/server/lib/power-bi-checkpoint-journal.js'
scripts = 'scripts/prototypes/int06-bounded-snapshot-20261108/'
docs = str(out.relative_to(repo)) + '/'
new_tests = {
    'resources/app/tests/int06-checkpoint-journal-bounded.test.js',
    'resources/app/tests/int06-checkpoint-journal-bounded-metrics.test.js',
    'resources/app/tests/fixtures/int06-checkpoint-journal/bounded-crash.cjs',
}
assert all(p == helper or p in new_tests or p.startswith((scripts, docs)) for p in changes), changes
# Every previously delivered INT-06 test/fixture byte stays frozen.
old_tests = git('ls-tree', '-r', '--name-only', delivery, 'resources/app/tests').splitlines()
old_tests = [p for p in old_tests if 'int06-checkpoint-journal' in p]
for file in old_tests:
    expected = subprocess.check_output(['git', 'show', f'{delivery}:{file}'], cwd=repo)
    assert (repo / file).read_bytes() == expected, file
assert not git('diff', '--check')
result = {
    'delivery': delivery, 'deliveryIsAncestor': True, 'mainAtStart': preserved['mainAtStart'],
    'preservedArtifactAndInheritedFiles': len(preserved['files']),
    'protectedProductionFiles': len(protected['files']), 'unchangedExistingInt06TestFixtureFiles': len(old_tests),
    'i18nBaselineEmpty': True, 'changedPaths': changes,
    'productionIntegrated': False, 'productionGainAccepted': False, 'rssRegressionAccepted': False,
}
with (out / 'preservation-audit.json').open('x') as f:
    json.dump(result, f, indent=2); f.write('\n')
(out / 'file-list.txt').write_text('\n'.join(changes + [str((out / 'preservation-audit.json').relative_to(repo)),
                                                         str((out / 'file-list.txt').relative_to(repo)),
                                                         str((out / 'evidence-manifest.json').relative_to(repo))]) + '\n')
