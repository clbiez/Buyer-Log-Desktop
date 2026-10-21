#!/usr/bin/env python3
"""Prove that the offline ZIP applies and rolls back without touching updater files."""
import hashlib
import json
import pathlib
import subprocess
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "dist" / "BuyerLog-7.0.293-Sonrasi-MiniPatch-20261021.zip"
BASE = "6501210b7faf051e4d8f2997dd0d48f0c9b64647"

def sha(b):
    return hashlib.sha256(b).hexdigest()

def run_ps(script, root, *extra, user_input=""):
    c = subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
                        "-File", str(script), "-InstallPath", str(root), *extra],
                       text=True, input=user_input, capture_output=True)
    print(c.stdout)
    if c.returncode:
        raise AssertionError(f"PowerShell exit {c.returncode}: {c.stderr}")
    return c.stdout

with tempfile.TemporaryDirectory() as td:
    tmp = pathlib.Path(td)
    with zipfile.ZipFile(ARCHIVE) as z:
        z.extractall(tmp / "patch")
        manifest = json.loads(z.read("patch-manifest.json"))
    assert len(manifest["files"]) == 23
    assert manifest["base_version"] == "7.0.293"
    assert not any("electron/" in f["path"] or "update" in f["path"].lower() for f in manifest["files"])
    installation = tmp / "buyer-log-fixture"
    installation.mkdir(parents=True, exist_ok=True)
    core = installation / "resources" / "app"
    (installation / "BuyerLog.exe").write_bytes(b"test only")
    (core / "package.json").parent.mkdir(parents=True, exist_ok=True)
    (core / "package.json").write_bytes(subprocess.check_output(
        ["git", "show", f"{BASE}:resources/app/package.json"], cwd=ROOT))
    state = installation / "data" / "local" / "updater"
    state.mkdir(parents=True)
    (state / "current.json").write_text(json.dumps({
        "schemaVersion": 1, "version": "7.0.293", "appCoreRoot": str(core),
    }), encoding="utf-8")
    (state / "state.json").write_text(json.dumps({
        "schemaVersion": 1, "state": "IDLE", "pending": None, "activation": None
    }), encoding="utf-8")
    reserved_hashes = {p.name: sha(p.read_bytes()) for p in state.iterdir()}
    for f in manifest["files"]:
        target = core / pathlib.Path(f["path"])
        target.parent.mkdir(parents=True, exist_ok=True)
        original = subprocess.check_output(
            ["git", "show", f"{BASE}:resources/app/{f['path']}"], cwd=ROOT)
        assert sha(original) == f["before_sha256"]
        target.write_bytes(original)

    script = tmp / "patch" / "Apply-MiniPatch.ps1"
    out = run_ps(script, installation, "-Check")
    assert "Kontrol basarili" in out
    out = run_ps(script, installation, user_input="E\n")
    assert "BASARILI:" in out
    for f in manifest["files"]:
        assert sha((core / f["path"]).read_bytes()) == f["after_sha256"], f["path"]
    out = run_ps(script, installation, "-Check")
    assert "Patch" in out
    out = run_ps(script, installation, "-Rollback", user_input="E\n")
    assert "Geri alma tamamlandi" in out
    for f in manifest["files"]:
        assert sha((core / f["path"]).read_bytes()) == f["before_sha256"], f["path"]
    assert {p.name: sha(p.read_bytes()) for p in state.iterdir()} == reserved_hashes
print("PASS: offline PowerShell check, apply, idempotence and rollback verified.")
