#!/usr/bin/env python3
"""Read-only patch coverage audit: no signing, installation or publication."""
import datetime as dt
import json
import os
import pathlib
import subprocess
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
BINARY = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico",
          ".woff", ".woff2", ".ttf", ".pdf", ".map")
PROTECTED = {"server/lib/update-trial-backend.js",
             "server/lib/shared-file-transaction.js",
             "server/lib/lease-worker-registry.js"}


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT).decode("utf8", "replace").strip()


def fetch_json(url, optional=False):
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "BuyerLog-Coverage-Audit"})
        with urllib.request.urlopen(request, timeout=25) as result:
            return json.load(result)
    except Exception:
        if optional:
            return {}
        raise


def changed(base, target):
    parts = subprocess.check_output(["git", "diff", "--no-renames",
                                     "--name-status", "-z", base, target, "--"],
                                    cwd=ROOT).decode("utf8", "replace").split("\0")
    return [(parts[i], parts[i+1]) for i in range(0, len(parts)-1, 2)
            if parts[i] and parts[i+1]]


def classification(status, name):
    if not name.startswith("resources/app/"):
        return "repo_only"
    rel = name[len("resources/app/"):]
    if rel.startswith("public/release-notes/"):
        return "release_notes"
    if not rel.startswith(("public/", "server/")):
        return "full_install"
    if rel in PROTECTED or "update" in rel.lower() or "config.json" in rel.lower():
        return "protected"
    if status == "D":
        return "deletions"
    if rel.lower().endswith(BINARY):
        return "omitted_assets"
    return "legacy_candidate"


def main():
    head = git("rev-parse", "HEAD")
    base = os.environ["BUYER_LOG_STABLE_SOURCE_SHA"]
    stable = fetch_json("https://raw.githubusercontent.com/clbiez/Buyer-Log-Releases/main/stable/latest.json")
    feed = fetch_json("https://raw.githubusercontent.com/clbiez/Buyer-Log-Releases/main/mini-patch/latest.json", True)
    published = str(feed.get("target_commit", ""))
    for value in [base, published] if published else [base]:
        if subprocess.run(["git", "merge-base", "--is-ancestor", value, head],
                          cwd=ROOT).returncode != 0:
            raise RuntimeError("Source SHA not an ancestor of main: " + value)
    baseline_changes = changed(base, head)
    uncovered = changed(published, head) if published else baseline_changes
    categories = {
        "legacy_candidate": "Legacy candidate runtime files (NOT currently published)",
        "omitted_assets": "Runtime images/fonts omitted by legacy packager",
        "deletions": "Deleted runtime files unsupported by legacy packager",
        "protected": "Updater / protected runtime paths",
        "full_install": "Electron, dependencies, scripts and other full-install files",
        "release_notes": "Release notes and visual assets",
        "repo_only": "Repository docs, test files and tools",
    }
    grouped = {key: [] for key in categories}
    for status, file in uncovered:
        grouped[classification(status, file)].append((status, file))
    merges = git("log", "--first-parent", "--merges", "--format=%h%x09%s",
                 (published or base) + ".." + head).splitlines()
    n_commits = int(git("rev-list", "--count", (published or base) + ".." + head))
    info = {
        "current_main": head, "official_stable": stable.get("version"),
        "stable_source": base, "unsigned_legacy_patch": published or None,
        "unsigned_patch_base": feed.get("base_version"),
        "commits_since_legacy_patch": n_commits,
        "merges_since_legacy_patch": len(merges),
        "files_changed_since_stable": len(baseline_changes),
        "files_changed_since_legacy_patch": len(uncovered),
        "category_counts": {key: len(grouped[key]) for key in categories},
        "legacy_publication_frozen": True,
        "signed_publication_requires_explicit_approval": True,
    }
    out = ROOT / "dist"
    out.mkdir(parents=True, exist_ok=True)
    (out / "patch-coverage-summary.json").write_text(
        json.dumps(info, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    lines = [
        "# Buyer Log — main / mini patch kapsama denetimi",
        "",
        "UTC: " + dt.datetime.now(dt.timezone.utc).isoformat(),
        "",
        "| Kaynak | Deger |", "|---|---|",
        "| main | " + head + " |",
        "| Resmi STABLE | " + str(stable.get("version")) + " / " + base + " |",
        "| Son imzasiz mini patch | " + (published or "YOK") + " |",
        "| Patch sonrasi commit / merge | " + str(n_commits) + " / " + str(len(merges)) + " |",
        "| Patch sonrasi degisen dosya | " + str(len(uncovered)) + " |",
        "",
        "**Uyari:** Eski imzasiz patch yayini guvenlik nedeniyle donduruldu.",
        "Imzali v3 yayin icin resmi tam bootstrap, kapsamli test ve her yayin icin acik onay gerekir.",
        "Bu kontrol sadece raporlar; kod, veri, installer veya yayin kanalini DEGISTIRMEZ.",
        "",
        "## Kategori ozeti",
        "| Kategori | Dosya |", "|---|---:|",
    ]
    for category, label in categories.items():
        lines.append("| " + label + " | " + str(len(grouped[category])) + " |")
    lines.extend(["", "## Merge kayitlari (son yayindan sonra)", ""])
    lines.extend(["- " + m for m in merges] or ["- Merge kaydi bulunamadi; squash ve dogrudan commitler olabilmektedir."])
    for category, label in categories.items():
        lines.extend(["", "## " + label, ""])
        lines.extend(["- " + s + " " + p for s, p in grouped[category]] or ["- Degisiklik yok."])
    (out / "patch-coverage-audit.md").write_text("\n".join(lines) + "\n", encoding="utf8")
    print(json.dumps(info, indent=2, ensure_ascii=False))
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(summary, "a", encoding="utf8") as handle:
            handle.write("\n".join(lines[:28]) + "\n\nFull report: patch-coverage-audit artifact.\n")


if __name__ == "__main__":
    main()
