#!/usr/bin/env python3
"""Build version-preserving offline mini patches for the current official STABLE.

Supported input files: exact STABLE and compatible patches for the same base version.
Detects file identity by SHA256; never touches the updater.
"""
from __future__ import annotations
import base64
import datetime as dt
import difflib
import hashlib
import json
import os
import re
import pathlib
import subprocess
import zipfile

BASE = os.environ.get("BUYER_LOG_PATCH_BASE_COMMIT", "").strip()
PREVIOUS_PATCHES = ("d6149bcb440530a20c30adecf201d1d989afd507",
                    "e54ba4eb8dfcc677907ed023955c7490de15fcd8",
                    "920082a0c970a5c31d95627dc5cdb5e82c15ef71",
                    "de123d59d39464e296ea9b535d652920173217a5",
                    "ae0e375ed577ff3d47d796dbd60f5575afd260e7",
                    "9c9f369140a27456e5b0ac97ae98ee541304f213")
VERSION = os.environ.get("BUYER_LOG_PATCH_BASE_VERSION", "").strip()
HEAD = subprocess.check_output(["git", "rev-parse", "HEAD"],
                              cwd=pathlib.Path(__file__).resolve().parents[1]).decode().strip()
ROOT = pathlib.Path(__file__).resolve().parents[1]
if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", VERSION):
    raise RuntimeError("BUYER_LOG_PATCH_BASE_VERSION must be the official STABLE version.")
if not re.fullmatch(r"[0-9a-f]{40}", BASE):
    raise RuntimeError("BUYER_LOG_PATCH_BASE_COMMIT must be the pinned official STABLE source commit.")
OUTPUT = ROOT / "dist" / f"BuyerLog-{VERSION}-MiniPatch-{HEAD[:12]}.zip"

def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], cwd=ROOT)

def blob(ref: str, path: str) -> bytes:
    return git("show", f"{ref}:{path}")

def digest(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()

def create_edits(before: bytes, after: bytes, name: str) -> list:
    original = before.decode("utf-8").splitlines(keepends=True)
    updated = after.decode("utf-8").splitlines(keepends=True)
    changes = [
        [i1, i2 - i1, updated[j1:j2]]
        for tag, i1, i2, j1, j2
        in difflib.SequenceMatcher(a=original, b=updated, autojunk=True).get_opcodes()
        if tag != "equal"
    ]
    result = list(original)
    for at, count, insert in reversed(changes):
        result[at:at + count] = insert
    if "".join(result).encode("utf-8") != after:
        raise RuntimeError(f"round-trip diff validation failed: {name}")
    return changes

assert json.loads(blob(BASE, "resources/app/package.json"))["version"] == VERSION, BASE
assert json.loads(blob(HEAD, "resources/app/package.json"))["version"] == VERSION, HEAD
# Never accept patched files from an older official STABLE version.
PREVIOUS_PATCHES = tuple(ref for ref in PREVIOUS_PATCHES
    if json.loads(blob(ref, "resources/app/package.json"))["version"] == VERSION)
status_rows = git("diff", "--no-renames", "--name-status", "--diff-filter=AMDR", BASE, HEAD,
                  "--", "resources/app/public", "resources/app/server").decode().splitlines()
entries = []
for row in status_rows:
    status, name = row.split("\t", 1)
    if name.startswith("resources/app/public/release-notes/"):
        continue
    if name.lower().endswith((".png", ".jpg", ".webp", ".gif", ".svg", ".map")):
        continue
    if not name.startswith(("resources/app/public/", "resources/app/server/")):
        raise RuntimeError(f"unexpected patch path: {name}")
    relative = name.removeprefix("resources/app/")
    if ("update" in relative.lower() or relative.startswith(("electron/", "scripts/"))
            or "package.json" in relative or "config.json" in relative):
        raise RuntimeError(f"updater protection blocked: {name}")
    after = blob(HEAD, name)
    record = {"path": relative, "after_sha256": digest(after)}
    if status == "A":
        record.update(kind="added", payload_b64=base64.b64encode(after).decode("ascii"), variants=[])
    elif status == "M":
        original = blob(BASE, name)
        record.update(kind="modified", variants=[{
            "before_sha256": digest(original),
            "edits": create_edits(original, after, name)
        }])
    else:
        raise RuntimeError(f"unsupported change: {status} {name}")
    seen = {v["before_sha256"] for v in record["variants"]}
    # Every prior published main commit is supported: path history includes
    # only commits where this file actually changed, avoiding O(commits*files)
    # expensive diffs and keeping future hotfix upgrades maintenance-free.
    history = git("log", "--first-parent", "--format=%H",
                  f"{BASE}..{HEAD}", "--", name).decode().splitlines()
    candidate_refs = list(dict.fromkeys([*PREVIOUS_PATCHES, *history]))
    for ref in candidate_refs:
        if subprocess.run(["git", "cat-file", "-e", f"{ref}:{name}"], cwd=ROOT,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
            continue
        older = blob(ref, name)
        if digest(older) not in ({digest(after)} | seen):
            record["variants"].append({
                "before_sha256": digest(older),
                "edits": create_edits(older, after, name)
            })
            seen.add(digest(older))
    entries.append(record)
if not (1 <= len(entries) <= 200):
    raise RuntimeError(f"unexpected number of runtime changes: {len(entries)}")

manifest = {
    "schema": 2,
    "product": "Buyer Log Desktop",
    "base_version": VERSION,
    "base_commit": BASE,
    "previous_patch_commits": list(PREVIOUS_PATCHES),
    "target_commit": HEAD,
    "created_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
    "mode": "offline-app-runtime-only-no-version-change",
    "note": "Unofficial manually-applied hotfix, not a signed STABLE release. Update mechanism is not changed.",
    "files": entries,
}
payload = json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
guide = f"""BUYER LOG {VERSION} SONRASI OTOMATIK MINI PATCH
HEDEF COMMIT: {HEAD}

Bu ZIP internetsiz calisir. GitHub, Python, Node.js veya Git istemez.
{VERSION} STABLE veya bu STABLE temeline ait onceki mini patch'li
kurulumlara en guncel runtime degisikliklerini uygular.
Uygulama dosyalarinin SHA256 dogrulamali kümülatif degisiklikleri.
Kod/yayin kanali/surum/updater/launcher/konfigurasyon bozulmaz.

1) ZIP'i bir klasore cikarin, BuyerLog.exe'yi tamamen kapatin.
2) KONTROL.cmd ile uyumlulugu ve SHA256 denetimini test edin.
3) UYGULA.cmd dosyasini calistirin.
4) BuyerLog.exe'nin yer aldigi kurulum klasorunu girin.
5) Once dosyalar denetlenir, sonra E ile onay verirseniz uygulanir.
6) Sorun olursa GERI_AL.cmd ile onceki dosyalara donebilirsiniz.

- Paket hicbir harici dosya indirmez.
- Uygulama dosyalari degismeden tum dosyalarin SHA256 kontrolu yapilir.
- Her dosyanin sonucu SHA256 ile dogrulanir.
- Degisen dosyalar yedeklenir; yeni eklenen dosyalar geri almada silinir.
- Veritabani, profil, kullanici verileri, updater ve STABLE kanali korunur.
- Paket temel dosyayi tanimazsa durur; zorlayarak degistirmez.
- Resmi STABLE yayin degildir. Bazi runtime degisiklikleri test ediliyor
  olabilir. Once pilot bilgisayarda dogrulayin.
- Resmi yeni surum geldiginde normal otomatik guncelleme devam eder.

KONTROL.cmd = Yalnizca denetim
UYGULA.cmd = Uygulama
GERI_AL.cmd = Son uygulamayi geri alma
"""
cmds = {
    "UYGULA.cmd": '@echo off\r\nchcp 65001 >nul\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Apply-MiniPatch.ps1"\r\npause\r\n',
    "KONTROL.cmd": '@echo off\r\nchcp 65001 >nul\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Apply-MiniPatch.ps1" -Check\r\npause\r\n',
    "GERI_AL.cmd": '@echo off\r\nchcp 65001 >nul\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Apply-MiniPatch.ps1" -Rollback\r\npause\r\n',
}
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    archive.writestr("patch-manifest.json", payload)
    archive.write(ROOT / "scripts" / "mini_patch_installer.ps1", "Apply-MiniPatch.ps1")
    archive.write(ROOT / "scripts" / "BuyerLog-OtoPatch.ps1", "BuyerLog-OtoPatch.ps1")
    archive.write(ROOT / "scripts" / "BuyerLog-OtoPatch.cmd", "BuyerLog-OtoPatch.cmd")
    archive.writestr("README.txt", guide)
    for name, content in cmds.items():
        archive.writestr(name, content)
print(f"created: {OUTPUT}")
print(f"files: {len(entries)}, modified: {sum(e['kind'] == 'modified' for e in entries)}, added: {sum(e['kind'] == 'added' for e in entries)}")
print(f"manifest: {len(payload)} bytes, ZIP: {OUTPUT.stat().st_size} bytes")
print(f"sha256: {digest(OUTPUT.read_bytes())}")
index = {
    "schema": 1, "kind": "buyerlog-manual-hotfix",
    "base_version": VERSION,
    "base_commit": BASE,
    "target_commit": HEAD,
    "asset": OUTPUT.name,
    "sha256": digest(OUTPUT.read_bytes()),
    "size": OUTPUT.stat().st_size,
    "published_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
    "message": "This is NOT a signed official STABLE update. The native updater is unchanged."
}
(ROOT / "dist" / "mini-patch-latest.json").write_text(
    json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("index:", ROOT / "dist" / "mini-patch-latest.json")
