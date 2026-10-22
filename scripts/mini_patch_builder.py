#!/usr/bin/env python3
"""Build a version-preserving, offline-only Buyer Log 7.0.293 mini patch.

Supported input files: original 7.0.293 STABLE and compatible earlier mini patches.
Detects file identity by SHA256; never touches the updater.
"""
from __future__ import annotations
import base64
import datetime as dt
import difflib
import hashlib
import json
import pathlib
import subprocess
import zipfile

BASE = "6501210b7faf051e4d8f2997dd0d48f0c9b64647"
PREVIOUS_PATCHES = ("d6149bcb440530a20c30adecf201d1d989afd507",
                    "e54ba4eb8dfcc677907ed023955c7490de15fcd8")
HEAD = "920082a0c970a5c31d95627dc5cdb5e82c15ef71"
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "BuyerLog-7.0.293-MiniPatch-Son-Guncel-20261022-R2.zip"

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

for ref in (BASE, *PREVIOUS_PATCHES, HEAD):
    assert json.loads(blob(ref, "resources/app/package.json"))["version"] == "7.0.293", ref
status_rows = git("diff", "--name-status", "--diff-filter=AM", BASE, HEAD,
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
    for ref in PREVIOUS_PATCHES:
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
    else:
        raise RuntimeError(f"unsupported change: {status} {name}")
    entries.append(record)
if len(entries) != 50:
    raise RuntimeError(f"expected 50 application files, got {len(entries)}")

manifest = {
    "schema": 2,
    "product": "Buyer Log Desktop",
    "base_version": "7.0.293",
    "base_commit": BASE,
    "previous_patch_commits": list(PREVIOUS_PATCHES),
    "target_commit": HEAD,
    "created_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
    "mode": "offline-app-runtime-only-no-version-change",
    "note": "Unofficial manually-applied hotfix, not a signed STABLE release. Update mechanism is not changed.",
    "files": entries,
}
payload = json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
guide = """BUYER LOG 7.0.293 SONRASI MINI PATCH - GUNCEL 22.10.2026
HEDEF COMMIT: 920082a0c970a5c31d95627dc5cdb5e82c15ef71

Bu ZIP internetsiz calisir. GitHub, Python, Node.js veya Git istemez.
7.0.293 STABLE veya onceki 21.10.2026 ve 22.10.2026 mini patch'li
7.0.293 uzerine en guncel runtime degisikliklerini uygular.
50 uygulama dosyasi (46 degisen dosya + 4 yeni JS dosyasi).
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
    archive.writestr("README.txt", guide)
    for name, content in cmds.items():
        archive.writestr(name, content)
print(f"created: {OUTPUT}")
print(f"files: {len(entries)}, modified: {sum(e['kind'] == 'modified' for e in entries)}, added: {sum(e['kind'] == 'added' for e in entries)}")
print(f"manifest: {len(payload)} bytes, ZIP: {OUTPUT.stat().st_size} bytes")
print(f"sha256: {digest(OUTPUT.read_bytes())}")
