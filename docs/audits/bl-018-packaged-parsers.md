# BL-018 — packaged dependencies and bounded file readers

Implemented on the server/security stack after BL-016. Final integrated full
regression, CI and merge remain pending. No release workflow was dispatched.

## Shipped dependency evidence

The reproducible [CycloneDX inventory](../dependencies/sbom.cdx.json) covers
**86 components and 302 vendored/runtime files**, including Node lock entries,
portable runtime data/DLLs/locales, Cesium's full tree, map data, font subsets
and adapted UI assets. Every component has license, source/version evidence,
hashes, owner and an update method. Unknown/unversioned provenance is labeled,
not replaced with a guessed version. The executable is intentionally excluded
from source Git; this is not certification of a published binary.

Official archive comparisons verified exact bytes for ExcelJS, JSZip, jsPDF,
PDF.js's **legacy** pair and xlsx-js-style's **bundle**; selecting a different
build file would have produced false mismatch reports. Vendor/OFL license
notices were added. Text notice line endings are deterministic across platforms.

The scoped Node upgrade pins Express 4.22.3 with compatible patched body-parser,
proxy-addr and qs lock entries, and vendors the official SheetJS 0.20.3 tarball
with integrity. The dated npm report has zero findings. See the dependency
[advisory triage](../dependencies/README.md) for the separate browser/runtime
dispositions and update boundaries; npm audit does not cover those bundles.

## Runtime behavior

- All application browser workbook imports use the patched reader in a Web
  Worker. Existing xlsx-js-style remains a writer and utility library. Dates,
  cached values, formula text and formats retain their existing import contract.
- Generic untrusted workbooks, report PDF/MSG/EML, IAM user workbooks, Merch
  Calendar and connection-discovery metadata use isolated reading boundaries.
  New server import processes are disposable, queued, byte bounded and killed
  on timeout/cancel; a slot is released only after child teardown. IAM imports
  parse before entering their mutation transaction and refresh session authority
  afterward. Other parent mutations also recheck authority and CAS before writes.
- Existing source Excel workers retain their admission/queue protocol and gain
  workbook preflight plus a V8 heap limit. General browser readers are worker
  isolated; no browser hard heap/RSS cap is claimed.
- ZIP preflight checks central **and local** allocation metadata, names, offsets,
  flags, compression, descriptors, overlap and unsupported ZIP64 overrides.
  Actual DEFLATE output is stream-counted in the browser and native-output-bound
  on Node before SheetJS can inflate from untrusted declarations. A matching pair
  of false size headers is insufficient to pass validation.
- Report evidence staged in a child is verified and remapped to the parent
  namespace, including `sources[].fileId`, `stagingId` and `uploadId`. A parser
  failure drops its temporary session and does not commit business state.
- PDF application entries use `isEvalSupported:false`; raster paths retain byte,
  page and image bounds. A small original PDF is preserved when rasterization
  would increase its size. The vendored PDF.js version itself was not upgraded
  or labeled as a patched release.

Generic limits and the dedicated Endeksmatik profile are documented in the
dependency README. Existing original Endeksmatik inputs are 36–49 MB, with up to
462 MB declared expansion. A one-size 40 MB / 200 MB limit would reject supported
templates; their serialized server process therefore uses 64 MB / 512 MB and
768 MiB V8 heap. Other new parser children use 256 MiB, source Excel workers
512 MiB. Heap caps do not bound all native memory, and process separation is not
an OS filesystem/network sandbox.

## Validation

The companion JSON records final focused log/source hashes, native phases,
dependency report and review findings. This package did **not** run a full suite.

- Actual Edge, full production server, synthetic CP import preview in TR/EN;
  compressed 10,000-row workbook read in a real Web Worker while the UI timer
  advanced, with exact formula, cached value, serial and number-format checks.
  The preview was not applied to business rows.
- Actual browser worker rejection of a small underdeclared ZIP, cancellation,
  PDF reading/raster output and preservation of the smaller original PDF.
- All **seven original Desktop workbooks** (five USD and both TL templates)
  accepted through the new isolated child with signature/reconciliation behavior
  and source-specific warnings retained. Their hashes matched the earlier
  read-only evidence before and after. No workbook bytes or business cell values
  were copied to Git. Acceptance does not invent missing S7 cached samples or
  repair the W6 malformed date already documented in the earlier financial audit.
- Timeout, queued cancellation, byte admission, child exit/recovery, actual
  inflate bounds, streamed descriptors, ZIP64 rejection, no silent truncation,
  real child model parity and report evidence-ID resolution have regressions.
- The SheetJS upgrade changed its fixture writer to normalize dimensions to A1.
  The offset TL regression now sets the actual OOXML dimension explicitly and
  retains the original V/B origin and exact domain-value assertions.
- Existing KUR VM tests now provide the separate current reader while keeping
  the main writer unloaded for their lazy-loading regression. A pre-existing
  checklist test was corrected to await BL-008's asynchronous durable writes;
  its data and invalid-evidence assertions were retained.

One bounded independent review found two P1 issues: missing parent `fileId`
remapping and trusting ZIP allocation metadata/declared expansion. Both were
reproduced and fixed with targeted tests; no second review round occurred. The
reviewer used small harmless ZIP examples, not large allocations or external
services. Codebase Memory transport was unavailable; critical paths were read
and runtime-verified directly.
