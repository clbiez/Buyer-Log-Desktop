"""Render a reviewable unified patch without writing patched source copies."""
import difflib
import json
import pathlib
import subprocess

here = pathlib.Path(__file__).resolve().parent
root = here.parents[2]
code = "process.stdout.write(JSON.stringify(require(process.argv[1]).materialize()))"
sources = json.loads(subprocess.check_output(["node", "-e", code, str(here / "route-recipe.cjs")]))
for file, after in sources.items():
    before = (root / file).read_text()
    print("".join(difflib.unified_diff(before.splitlines(True), after.splitlines(True),
                                    fromfile="a/" + file, tofile="b/" + file, n=0)), end="")
