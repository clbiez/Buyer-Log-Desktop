#!/usr/bin/env python3
"""Offline-only Buyer Log 7.0.293 -> pinned-main application hotfix packager."""
from __future__ import annotations
import datetime as dt
import difflib
import hashlib
import json
import pathlib
import subprocess
import zipfile

BASE = "6501210b7faf051e4d8f2997dd0d48f0c9b64647"
HEAD = "d6149bcb440530a20c30adecf201d1d989afd507"
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "BuyerLog-7.0.293-Sonrasi-MiniPatch-20261021.zip"

def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], cwd=ROOT)

def blob(ref: str, path: str) -> bytes:
    return git("show", f"{ref}:{path}")

def digest(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()

def apply(lines: list[str], edits: list[list]) -> list[str]:
    lines = list(lines)
    for at, count, insert in reversed(edits):
        lines[at:at + count] = insert
    return lines

assert json.loads(blob(BASE, "resources/app/package.json"))["version"] == "7.0.293"
assert json.loads(blob(HEAD, "resources/app/package.json"))["version"] == "7.0.293"
names = git("diff", "--name-only", "--diff-filter=AM", BASE, HEAD, "--",
            "resources/app/public", "resources/app/server").decode().splitlines()
entries = []
for name in names:
    if name.startswith("resources/app/public/release-notes/"):
        continue
    if name.lower().endswith((".png", ".jpg", ".webp", ".gif", ".svg", ".map")):
        continue
    if not name.startswith(("resources/app/public/", "resources/app/server/")):
        raise RuntimeError(f"unexpected patch path: {name}")
    before, after = blob(BASE, name), blob(HEAD, name)
    original = before.decode("utf-8").splitlines(keepends=True)
    updated = after.decode("utf-8").splitlines(keepends=True)
    edits = [
        [i1, i2 - i1, updated[j1:j2]]
        for tag, i1, i2, j1, j2
        in difflib.SequenceMatcher(a=original, b=updated, autojunk=True).get_opcodes()
        if tag != "equal"
    ]
    if "".join(apply(original, edits)).encode("utf-8") != after:
        raise RuntimeError(f"round-trip validation failed: {name}")
    entries.append({
        "path": name.removeprefix("resources/app/"),
        "before_sha256": digest(before),
        "after_sha256": digest(after),
        "edits": edits,
    })
if len(entries) != 23:
    raise RuntimeError(f"expected 23 runtime file changes, got {len(entries)}")
for e in entries:
    if e["path"].startswith(("electron/", "scripts/")) or "update" in e["path"].lower():
        raise RuntimeError(f"updater-safety violation: {e['path']}")
manifest = {
    "schema": 1,
    "product": "Buyer Log Desktop",
    "base_version": "7.0.293",
    "base_commit": BASE,
    "target_commit": HEAD,
    "updated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
    "mode": "app-runtime-only-no-version-change",
    "note": "Not an official signed STABLE release. Only verified 7.0.293 app-core files are edited.",
    "files": entries,
}
payload = json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
guide = """BUYER LOG 7.0.293 SONRASI MINI PATCH - 21.10.2026

Bu ZIP internetsiz calisir; GitHub, Python veya Git kurulumu istemez.
7.0.293 kurulumunun uzerine, sadece uygulama kodundaki 23 dosyanin
7.0.293 -> belirtilen kaynak commit degisikliklerini uygular.

KULLANIM:
1. ZIP'i yerel bir klasore cikarin.
2. BuyerLog.exe'yi tamamen kapatin.
3. UYGULA.cmd dosyasina cift tiklayin.
4. BuyerLog.exe'nin bulundugu klasorun TAM YOLUNU girin.
5. On kontrol temizse E yazarak onaylayin.

GUVELIK:
- Ilk once surum ve her dosyanin SHA256 kimligi dogrulanir.
- Dosyalar yazilmadan yeni hallerinin SHA256 kimligi de test edilir.
- Tum dosyalarin yedegi alinir, islem hatasinda geri alma denenir.
- Resmi updater, launcher, version, config, veritabani, veri, log ve
  STABLE / TEST kaynagi dosyalari degistirilmez.
- Resmi sonraki surum geldiğinde normal updater kullanilabilir.
- Kontrol hatasinda zorlamayin: bu paket sadece eslesen 7.0.293 icindir.
- Bu paket resmi, imzali STABLE surumu degildir; manuel hotfix'tir.

KONTROL: KONTROL.cmd
GERI AL: GERI_AL.cmd
"""
cmds = {
    "UYGULA.cmd": "@echo off\r\nchcp 65001 >nul\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%~dp0Apply-MiniPatch.ps1\"\r\npause\r\n",
    "KONTROL.cmd": "@echo off\r\nchcp 65001 >nul\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%~dp0Apply-MiniPatch.ps1\" -Check\r\npause\r\n",
    "GERI_AL.cmd": "@echo off\r\nchcp 65001 >nul\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%~dp0Apply-MiniPatch.ps1\" -Rollback\r\npause\r\n",
}
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    archive.writestr("patch-manifest.json", payload)
    archive.write(ROOT / "scripts" / "mini_patch_installer.ps1", "Apply-MiniPatch.ps1")
    archive.writestr("README.txt", guide)
    for name, content in cmds.items():
        archive.writestr(name, content)
print(f"created: {OUTPUT}")
print(f"files: {len(entries)}; payload: {len(payload)} bytes; ZIP: {OUTPUT.stat().st_size} bytes")
print(f"sha256: {digest(OUTPUT.read_bytes())}")
