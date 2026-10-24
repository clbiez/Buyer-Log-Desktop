# Packaged dependency inventory

`sbom.cdx.json` is an offline, reproducible CycloneDX 1.6 inventory of the locked
Node dependencies and all checked-out vendored/runtime artifacts. Its artifact
manifest records individual paths, byte sizes and SHA-256 hashes. Each component
has an owner, source, license, version evidence and update method. The opaque
runtime executable is intentionally excluded from source Git; this inventory
does **not** certify the identity of an installed or published release.

From `resources/app`, regenerate with `node scripts/dependency-inventory.js` and
verify with `node scripts/dependency-inventory.js --check`. The focused/full test
runner checks freshness. Update `scripts/dependency-catalog.json` when adding a
vendor; unclassified files fail generation. The advisory lookup date is a dated
human/agent review, not a continuously updated vulnerability feed.

The 2026-10-25 Node audit after the scoped upgrades reports zero findings.
Express is 4.22.3; its compatible patched dependencies include body-parser
1.20.9, proxy-addr 2.0.8 and qs 6.16.1. The official SheetJS 0.20.3 tarball is
vendored with lock integrity; browser reads use its separate worker bundle.
The old xlsx-js-style 1.2.0 / SheetJS 0.18.5 bundle remains a **writer only**.
Application read-call guards prevent routing arbitrary files back to that fork.
Node audit does not scan these separate browser vendors or the portable runtime.

Exact upstream artifact bytes were verified for ExcelJS 4.4.0, jsPDF 2.5.2,
JSZip 3.10.1, the PDF.js 3.11.174 **legacy** library/worker pair and the
xlsx-js-style **bundle**. The comparison report identifies the exact archive
entries; comparing the wrong build variant would incorrectly report tampering.
The legacy compatibility shim and unversioned font/data adaptations are labeled
honestly; no guessed upstream version or byte-equivalence claim is made. Added
licenses include the official vendor licenses and both Barlow OFL notices.
Cesium's complete bundled license/third-party notices remain in its distribution.

## Advisory triage and update boundaries

| Component | Reviewed evidence and current disposition |
|---|---|
| SheetJS | [CVE-2023-30533](https://cdn.sheetjs.com/advisories/CVE-2023-30533) and [CVE-2024-22363](https://cdn.sheetjs.com/advisories/CVE-2024-22363): untrusted reads upgraded to 0.20.3, with independent process/worker limits. The upstream advisories distinguish reading from export-only workflows. |
| Express/transitives | [body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828), [proxy-addr](https://github.com/advisories/GHSA-jqcg-44mw-7w3h), [qs](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g): compatible patched lock entries installed; npm advisory report zero after the change. No broad Express major upgrade. |
| PDF.js 3.11.174 | [GHSA-wgrm-67xf-hhpq](https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq) documents `isEvalSupported:false` as a workaround. Every application entry uses that setting; server extraction runs in a disposable process, browser PDF.js uses its worker. The library is not represented as a patched release. A newer ESM major needs a separate compatibility migration. |
| jsPDF 2.5.2 | [Upstream advisories](https://github.com/parallax/jsPDF/security) include HTML/new-window output, AcroForm/addJS, GIF/BMP and Node file loading. Current application usage is canvas JPEG `addImage` plus `output('blob')`; those affected APIs are not used. This is bounded reachability triage, not a clean-library claim. Keep the UMD upgrade owner and raster fixture gate. |
| Electron declared 44.3.0 | [44.3.0 upstream identity](https://releases.electronjs.org/release/v44.3.0) and [44.9.3 maintenance release](https://releases.electronjs.org/release/v44.9.3) reviewed. A newer maintenance build is available. No partial runtime replacement was made; a future upgrade must replace executable and runtime as one verified distribution and pass populated Electron acceptance. Age alone is not an exploit finding, and source hashes do not certify a release binary. |

Embedded dependencies within a browser bundle are covered by its exact verified
artifact and retained upstream notices, rather than invented independent package
versions. A fresh release security review must revisit dated reachability and
upstream updates. No TEST/STABLE release or publishing workflow was dispatched.

## Import limits

Generic workbook reads allow 40 MiB compressed / 200 MiB expanded, 64 sheets,
200,000 rows, 512 columns and 10 million rectangular cells, with a 60s deadline.
They reject instead of silently truncating. ZIP preflight checks local/central
headers, descriptor sizes, overlap, encryption and unsupported ZIP64 overrides;
actual streamed/bounded DEFLATE expansion must match declarations **before**
SheetJS allocates from those declarations.

Known Endeksmatik workbooks use a dedicated serialized server profile: 64 MiB /
512 MiB expanded, 20 million rectangular cells and a 768 MiB V8 heap cap. All
seven inspected original Desktop workbooks (including both TL templates) were
accepted without changing their hashes. Other disposable parser processes use a
256 MiB V8 cap. Source Excel worker threads use 512 MiB. The caps bound V8 heap,
not total RSS or native allocation; input, expansion, queue and lifetime bounds
are separate controls. Browser Web Workers have no claimed hard V8/RSS limit.
Isolation is not an OS filesystem/network sandbox.
