"""Verify the protected delivery and unchanged production/preparation bytes."""
import hashlib
import json
import subprocess
from pathlib import Path

out = Path(__file__).resolve().parent
repo = out.parents[3]
delivery = "9e966b1fcbe6974b60def70503aae13ff56c7319"


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


subprocess.run(["git", "merge-base", "--is-ancestor", delivery, "HEAD"], cwd=repo, check=True)
original = json.loads((out.parent / "evidence-manifest.json").read_text())
for item in original["artifacts"]:
    file = out.parent / item["path"]
    assert file.stat().st_size == item["bytes"] and sha(file) == item["sha256"], str(file)
protected = json.loads((out.parent / "protected-source-audit.json").read_text())
for item in protected["files"]:
    assert sha(repo / item["path"]) == item["sha256"], item["path"]
fixtures = repo / "resources/app/tests/fixtures/int06-checkpoint-journal"
preparation = json.loads((fixtures / "provenance.json").read_text())
for item in preparation["files"]:
    assert sha(fixtures / item["storedPath"]) == item["sha256"], item["path"]
changed = subprocess.check_output(["git", "diff", "--name-only", delivery, "HEAD"], cwd=repo, text=True).splitlines()
allowed = {
    "resources/app/server/lib/power-bi-checkpoint-journal.js",
    "resources/app/tests/int06-checkpoint-journal-unit.test.js",
    "resources/app/tests/fixtures/int06-checkpoint-journal/profile.cjs",
}
assert all(p in allowed or p.startswith(str(out.relative_to(repo)) + "/") for p in changed), changed
assert not subprocess.check_output(["git", "diff", "--check"], cwd=repo)
with (out / "preservation-audit.json").open("x") as target:
    json.dump({"protectedDelivery": delivery, "deliveryIsAncestor": True,
               "originalArtifactHashesVerified": len(original["artifacts"]),
               "protectedProductionHashesVerified": len(protected["files"]),
               "inheritedPreparationHashesVerified": len(preparation["files"]),
               "committedChangedPaths": changed,
               "productionIntegrated": False, "productionGainAccepted": False,
               "rssRegressionAccepted": False}, target, indent=2)
    target.write("\n")
