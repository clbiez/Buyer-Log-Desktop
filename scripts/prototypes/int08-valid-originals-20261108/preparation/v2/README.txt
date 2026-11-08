INT-08 preparation v2 — NOT EXECUTED / NO APPROVED RUN REVISION FROZEN

Everything here is new preparation under v2/. The v1 files, pins and source
snapshots remain unchanged. v1-reference-sha.json records their original hashes.
No app/browser/test/probe/fixture generator or performance cohort has run.
No original image or frozen application has been generated/staged by this task.
No producer or checkout file was edited and no optimization was implemented.

REVISION / CP ACCEPTANCE RULES
Do not stage the historical6b or0dc labels as the forthcoming approved Main.
--revision is mandatory. Resolve the final approved Main AFTER908 is accepted
and merged; pass its full commit explicitly. prepare.py freezes that full commit,
resources/app tree, nine relevant image-path blob IDs+SHA-256 values, selected
authoritative INT-08 document, and exact application source in a revision-tagged
stage. It verifies the frozen nine files again after archive extraction.

review-context-pins.json is historical read-only context at0dc9f0947cf5c38be3b8281eca6743a532e99eab,
NOT a selected or approved run revision. Changes from those nine contextual
blobs are recorded in each future stage. Future stages are never relabeled with
the old6b revision; partial and completed stages are never silently overwritten.

The selected revision must descend from916's0c85445f1989cafbae4f104c13ddf5d8f0b84c6c.
Four additional source/test pins and their916 reference hashes are recorded:
  public/checklist-components-engine.js — withRowCache
  public/cp-overview-assistant.js — applyPersonalLayer
  public/checklist-supplier-sync.js — refreshColumns
  tests/checklist-components-row-cache.test.js
Changed guard-file paths are explicit in source-pins.json. This preparation
does not weaken those cache guards or replace their tests. The required fast
step "CP checklist pass caches..." and checklist-components-row-cache.test.js
must pass in the final producer acceptance workflow. No such test ran here.

If a later INT-08 optimization touches the CP path, its BEFORE/AFTER acceptance
must ALSO contain three paired first-CP-intent measurements with916 present
on BOTH arms. This baseline's direct CP navigation is not mislabeled as that
intent measurement. Adding a preview optimization is a later task, after cost
measurement. Existing32-image/180-frame/two-scroll-pass/three-pair workloads
and their functional assertions remain unchanged in v2.

IMMUTABLE INPUT / PRIVATE MUTABLE DATA
Use the same30k seed7 source/cache root read only:
  /tmp/buyerlog-startup-shared908-main5b8-20261107
Each case freshly copies ONLY mutable app/data/local privately (about30MiB in
the current root). Only the three XLSX files declared by benchmark-fixture.json
are hardlinked, after streaming SHA-256 verification of each source. A hash of
the linked file and same-inode check follows every link. EXDEV fails; there is
no hidden full-source-copy fallback. Small metadata JSON is privately copied.
No other fixture, image, app, or output file is hardlinked.

The source files are never chmod/chown/touched. Creating hardlinks necessarily
changes inode link counts; source CONTENT and modes stay unchanged. A private
source-directory mode and probe-only fs write guard block source writes without
changing the source inode's permissions. The guard covers both private hardlink
paths and the source-cache path and is inherited by Node children. All mutable
image/auth/cache roots remain private. Before/after source hashes, mode, device
and inode are recorded and must match. Any source-write attempt invalidates a
sample. The existing loopback-only network guard applies identically to arms.

EXACT ORIGINAL FIXTURE / UPLOAD LIMIT CHECK
The v1 seed7 garment/seam/texture recipe, all32 images, three size strata, JPEG24
and PNG8 remain intact. fixture_recipe.py changes only encoding to a RAM buffer
before disk admission. Pillow verify()+load(), dimensions and per-image SHA-256
are still required. No sample is dropped or replaced to fit storage or limits.

Static source inspection found:
  server/user-data.js RAW_COLLECTION_IMAGE_MAX_BYTES =50*1024*1024.
  server/server.js global express.json100mb parser precedes both image routes.
  collection-image-routes.js declares a nominal70mb JSON parser, but the earlier
  global parser has already set req._body; body-parser jsonParser skips it.
  Therefore both actual routes use the earlier100MiB JSON body limit today.
  bytes/index.js maps mb to1<<20. No parser limit is changed by v2.

Largest RGB PNG is3072x4096. Its raw filtered scanlines are37,752,832 bytes.
The conservative zlib/framing/IDAT bound in upload-static-review.json is below
50MiB. JPEG quality alone cannot prove an encoded-size upper bound; no such
claim is made. Generation validates EVERY actual JPEG/PNG file below50MiB.
At the50MiB raw cap, base64 is69,905,068 bytes (about66.667MiB); adding4KiB JSON
identity/header allowance still fits the nominal70MiB and effective100MiB
budgets. Each generated file's actual size/body upper bound is frozen before
any app starts. The native CP upload payload's exact UTF-8 JSON size is checked
again before upload and retained with its attached-image mapping.

DISK ADMISSION / EVIDENCE RETENTION
Current root preflight supplied by the parent: about1GiB free; frozen app about
208MiB; source workbooks about71MiB; mutable data/local about29MiB. These are
planning facts, not a promise that a complete cohort fits. No full repository,
node_modules or workbook copy is made. prepare.py streams git archive extraction
and symlinks the installed dependencies, with an admission check before staging
and an actual-byte admission check before each original file is written.

run-cohort.py calculates actual mutable-copy bytes, all32 original bytes and
the six representative XLSX media-byte estimate. Before ANY app start it admits
the WHOLE FIXED PLAN against current free disk, including already retained runs,
future private copies/uploads/export outputs, raw trace, worst-case transient
gzip output, logs, runtime temporary space and a free-space reserve. It checks
again before each private copy and immediately before the actual server spawn.
The input workbook-copy budget is exactly zero. An insufficient plan fails
before starting an app; it does not reduce samples/repetitions or delete evidence.

Default estimated budgets: raw trace/memory128MiB, retained trace/memory32MiB,
runtime temporary64MiB, log growth16MiB, mutable growth16MiB, free reserve128MiB.
These are admission estimates, never trace/event/sample/time caps. A successful
SAME-STAGE smoke can supply twice its observed raw/gzip trace-memory sizes
(floors64MiB/8MiB) for better evidence-based admission. No measurement workload
is changed. If real output exceeds an estimate, preserve it and stop before the
next app start. About1GiB may correctly admit a smoke and decline the full plan;
more disk is required if the recorded plan does not fit. No unrelated artifact
cleanup is authorized or performed by these scripts.

After each probe process and its app server exit, on success OR failure:
  - Keep raw trace/memory/large JSON/log artifacts intact initially.
  - Stream gzip into a new file; record raw byte count+SHA-256 and gzip count+SHA.
  - Independently decompress the gzip and compare every raw byte via length/hash.
  - fsync a manifest proving the round trip BEFORE releasing the raw file.
  - Retain the gzip and artifact-compression-manifest.json permanently.
  - Leave an existing gzip/raw/partial representation untouched on a failure.
Mutable large fixture JSON can be packed after server exit too. XLSX, original
rasters, existing gzip and source hardlinks are retained unchanged. Unknown
server exit means stop and keep raw evidence; no unrelated PID is signaled.
No trace compression runs concurrently with a measurement. A disk failure
during packing preserves raw data and prevents further app starts.

COMMANDS — PREPARE ONLY NOW; EXECUTE ONLY AFTER FINAL APPROVED MAIN908 EXISTS
The examples below intentionally contain no guessed approved revision. Supply
the actual FULL40-hex final commit, including916 ancestry. Run launch commands
outside the command sandbox under the normal approval rules. Each uses the
existing /tmp/buyerlog-performance-measurement.lock nonblockingly. A held or
missing lock aborts before archive/generation/copy/app/browser activity.

  INT08_APPROVED_REV='<full40hex-final-approved-Main908-commit>'
  /usr/bin/python3 /tmp/buyerlog-int08-preparation/v2/prepare.py --revision "$INT08_APPROVED_REV" --stage-tag original-baseline-01

  INT08_STAGE="/tmp/buyerlog-int08-preparation/v2/stages/${INT08_APPROVED_REV}-original-baseline-01"
  /usr/bin/python3 /tmp/buyerlog-int08-preparation/v2/run-cohort.py --stage-root "$INT08_STAGE" --smoke --label int08v2-smoke-01

  /usr/bin/python3 /tmp/buyerlog-int08-preparation/v2/run-cohort.py --stage-root "$INT08_STAGE" --budget-from-smoke /tmp/buyerlog-int08-preparation/v2/runs/int08v2-smoke-01/smoke-originals --repeats 3 --label int08v2-original-baseline-01

Preserve the actual printed stageRoot/revision/appTree, source-pins.json,
fixture-manifest.json, disk admission records, whole-plan cohort.json, per-run
results (possibly.json.gz), original export XLSX, input/source audits and all
lossless compression manifests. A fresh stage-tag/label is required for another
authorized attempt; no overwrite/relabel/reduction flow is built in.

UNCHANGED PROBE PATH / LIMITS
Real cpSaveRowImage→POST cp-images→PATCH overrides/canonical registry, both
original GET aliases, fresh Chromium after upload warming, actual CP cell
bindings/scroll/hover, production BLDetailDrawer, original clipboard and Excel
preparation, plus actual XLSX embedded media hashes are still exercised.
Decoded-image allocator attribution remains a required analysis step; RSS,
JS heap, natural-size RGBA estimates and encoded warm-cache budgets are not
renamed decoded memory. Trace/memory allocator evidence is preserved losslessly.
96/192/384 preview quality review and production pixel/byte distribution remain
open. There is no render-time canvas path, preview storage or new worker here.

V2 scripts were statically prepared/reviewed only. They have NOT been executed,
syntax-checked by a runtime, or smoke-validated. First execution must validate
source staging, hardlink guard behavior, actual upload sizes, cache reuse,
selectors, tracing schema/allocator availability and post-exit packing before
any counted cohort. No performance or functional pass is claimed.
