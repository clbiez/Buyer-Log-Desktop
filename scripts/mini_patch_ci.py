#!/usr/bin/env python3
"""Windows integration tests for the offline mini patch, including prior patch compatibility."""
import hashlib
import json
import pathlib
import subprocess
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
ARCHIVES = sorted((ROOT / "dist").glob("BuyerLog-7.0.293-MiniPatch-*.zip"))
assert len(ARCHIVES) == 1, ARCHIVES
ARCHIVE = ARCHIVES[0]
BASE = "6501210b7faf051e4d8f2997dd0d48f0c9b64647"
PREVIOUS = "d6149bcb440530a20c30adecf201d1d989afd507"
PREVIOUS2 = "e54ba4eb8dfcc677907ed023955c7490de15fcd8"
PREVIOUS3 = "920082a0c970a5c31d95627dc5cdb5e82c15ef71"
PREVIOUS4 = "de123d59d39464e296ea9b535d652920173217a5"
PREVIOUS5 = "ae0e375ed577ff3d47d796dbd60f5575afd260e7"
PREVIOUS6 = "9c9f369140a27456e5b0ac97ae98ee541304f213"
HEAD = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip()

def sha(b):
    return hashlib.sha256(b).hexdigest()

def git_file(ref, path):
    return subprocess.check_output(["git", "show", f"{ref}:resources/app/{path}"], cwd=ROOT)

def git_file_or_none(ref, path):
    result = subprocess.run(["git", "show", f"{ref}:resources/app/{path}"], cwd=ROOT,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    return result.stdout if result.returncode == 0 else None

def run_ps(script, root, *extra, user_input="", expect_success=True):
    c = subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
                        "-File", str(script), "-InstallPath", str(root), *extra],
                       text=True, input=user_input, capture_output=True, timeout=120)
    if (c.returncode == 0) != expect_success:
        raise AssertionError(f"PowerShell returned {c.returncode} (success={expect_success})\n{c.stdout}\n{c.stderr}")
    return c.stdout

with tempfile.TemporaryDirectory() as td:
    tmp = pathlib.Path(td)
    with zipfile.ZipFile(ARCHIVE) as z:
        z.extractall(tmp / "patch")
        manifest = json.loads(z.read("patch-manifest.json"))
    files = manifest["files"]
    assert manifest["schema"] == 2 and 1 <= len(files) <= 200
    assert sum(f["kind"] == "modified" for f in files) + sum(f["kind"] == "added" for f in files) == len(files)
    assert sum(f["kind"] == "added" for f in files) == 4
    assert manifest["target_commit"] == HEAD
    assert not any("electron/" in f["path"] or "update" in f["path"].lower() for f in files)
    script = tmp / "patch" / "Apply-MiniPatch.ps1"

    for stage, ref in [("clean-7293", BASE), ("previous-mini-patch", PREVIOUS),
                       ("22-oct-R2-prior-patch", PREVIOUS2),
                       ("r2-prior", PREVIOUS3),
                       ("r3-prior", PREVIOUS4),
                       ("r4-prior", PREVIOUS5),
                       ("r5-prior", PREVIOUS6)]:
        installation = tmp / stage
        installation.mkdir(parents=True, exist_ok=True)
        core = installation / "resources" / "app"
        (installation / "BuyerLog.exe").write_bytes(b"fixture")
        (core / "package.json").parent.mkdir(parents=True, exist_ok=True)
        (core / "package.json").write_bytes(git_file(BASE, "package.json"))
        cfg = installation / "config.json"
        cfg.write_bytes(b'{"custom":true}')
        state = installation / "data" / "local" / "updater"
        state.mkdir(parents=True)
        (state / "current.json").write_text(json.dumps({
            "schemaVersion": 1, "version": "7.0.293", "appCoreRoot": str(core),
        }), encoding="utf-8")
        (state / "state.json").write_text(json.dumps({
            "schemaVersion": 1, "state": "IDLE", "pending": None, "activation": None
        }), encoding="utf-8")
        db = installation / "data" / "local" / "BuyerLogLocal.db"
        db.write_bytes(b"PRIVATE_LOCAL_DATA_DO_NOT_TOUCH")
        reserved_hashes = {str(p.relative_to(installation)): sha(p.read_bytes()) for p in
            [*state.iterdir(), cfg, db, core / "package.json", installation / "BuyerLog.exe"]}

        initial_files = {}
        for f in files:
            target = core / f["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            source = git_file_or_none(ref, f["path"])
            initial_files[f["path"]] = source
            if source is not None:
                assert sha(source) in ([v["before_sha256"] for v in f["variants"]] +
                                       [f["after_sha256"]]), f["path"]
                target.write_bytes(source)
            else:
                assert f["kind"] == "added", f["path"]

        out = run_ps(script, installation, "-Check")
        assert "Kontrol basarili" in out, out

        # Hash mismatch fails before ANY file changes.
        modified = next(f for f in files if f["kind"] == "modified")
        target = core / modified["path"]
        before = target.read_bytes()
        target.write_bytes(b"WRONG_RUNTIME_FILE")
        out = run_ps(script, installation, "-Check", expect_success=False)
        assert "PATCH DURDURULDU" in out, out
        assert all((core / f["path"]).exists() == (initial_files[f["path"]] is not None)
                   for f in files if f["kind"] == "added")
        target.write_bytes(before)

        out = run_ps(script, installation, user_input="E\n")
        already = sum(source is not None and sha(source) == f["after_sha256"]
                      for f in files for source in [initial_files[f["path"]]])
        assert f"BASARILI: {len(files) - already} dosya guncellendi." in out, out
        for f in files:
            assert sha((core / f["path"]).read_bytes()) == f["after_sha256"], (stage, f["path"])
        out = run_ps(script, installation, "-Check")
        assert f"Yazilacak dosya: 0; zaten guncel: {len(files)}" in out, out
        out = run_ps(script, installation, "-Rollback", user_input="E\n")
        assert "Geri alma tamamlandi" in out, out
        for f in files:
            target = core / f["path"]
            expected = initial_files[f["path"]]
            if expected is None:
                assert not target.exists(), (stage, f["path"])
            else:
                assert target.read_bytes() == expected, (stage, f["path"])
        assert {str(p.relative_to(installation)): sha(p.read_bytes()) for p in
            [*state.iterdir(), cfg, db, core / "package.json", installation / "BuyerLog.exe"]} == reserved_hashes
        print("PASS", stage, "- check, tamper protection, apply, idempotence, rollback, updater/data preserved")
print("ALL OFFLINE PATCH WINDOWS TESTS PASS")

# Check that the click-to-update manager parses on Windows PowerShell 5.1.
check = subprocess.run(["powershell.exe","-NoProfile","-Command",
 "foreach($f in @('scripts/BuyerLog-OtoPatch.ps1','scripts/mini_patch_installer.ps1')) { $t=$null; $err=$null; [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $f),[ref]$t,[ref]$err); if ($err.Count -gt 0) { $err | Out-String | Write-Host; exit 1 } }"],
 cwd=ROOT,capture_output=True,text=True)
assert check.returncode == 0, check.stdout + check.stderr
print("PASS: Windows PowerShell scripts parse correctly")
