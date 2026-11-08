# Main179 INT-08 diagnostic executable copy

This directory adapts the unexecuted, immutable `../preparation/v2` packet.
The historical README's post-908 final-acceptance rule is unchanged. The user
separately authorized diagnosis at Main
`1796193f0a57c7785e7bf9fdb3557e33c550b25e`. No result here is post-908 acceptance.
No production preview implementation is included.

Every invocation requires explicit local inputs. Historical `/workspace` and
`/tmp` defaults are not inputs. `prepare.py` requires `--repo`, `--dependencies`,
`--source-cache`, `--work-root`, `--revision`; `run-cohort.py` requires
`--stage-root`, `--source-cache`, `--work-root`, `--playwright-module`, `--chromium`,
`--module`. Pass an absolute path for every path argument. Stages/runs must be
new; existing successful or failed evidence is never overwritten.

Launch tests, preparation, bootstrap and cohorts with:

```sh
flock -n -E 75 -F /tmp/buyerlog-performance-measurement.lock COMMAND ARGUMENTS
```

`-F` passes the lock descriptor to the command. Python entry points require an
inherited descriptor for that same inode. No lock is removed or bypassed.

The fixed workload remains 32 originals, three size strata, 24 JPEG + 8 PNG,
seed7 garment/seam/fine texture, 180 frames per pass, two passes, and three
independent alternating control/original pairs. It runs separately for CP and
Orders. Controls have no attached originals; they are comparison arms, never
evidence that valid originals are cheap. Each original arm uses native
`cpSaveRowImage`, original GET aliases, canonical refs, hover/drawer,
clipboard/Excel preparation and an actual six-representative XLSX.

Main179 lazy initialization means the inactive module may have no renderer
rows. Assert 24,982 CP rows or 30,000 Orders rows in the active renderer, and
both exact counts/checksums in the input and post-ingest disk projections.
`mode=initial` intentionally returns no generation; assert the actual
projection response headers against the frozen measurement generation.

Each native image PATCH increments the Orders revision. Warm the real CP,
Orders and collection-catalog projection GETs identically on both arms. Require
all three GETs on a second pass to return one stable generation, then freeze the post-ingest
generation/checksums and require unchanged source revision, then start a fresh
Chromium. Assert the expected +32 Orders revision on original arms and +0 on
controls, unchanged Supp. FOB, exact renderer revisions and canonical DOM
model/colour keys for loaded originals. Original input
generation evidence is retained separately. No production guard is relaxed.

The shared immutable source folder remains the explicitly supplied cache's
`source` directory so that the source-folder-dependent projection scope stays
valid. Three verified source workbooks are also hardlinked into each private
fixture, checked for SHA/device/inode/mode before and after. No source file's
mode or content is changed. Missing optional `app` data is an empty private
directory; mutable data is never hardlinked. The probe-only write/network
guards apply to both arms and inherited Node children.

Chromium's Unix socket path limit is handled with a short `/proc/<probe>/fd/N`
alias for an open descriptor to the run's own private temp directory. This
does not create a second temp root or require another chat's files.

Disk admission covers the complete task, including bootstrap, two successful
smokes, twelve counted runs, outputs, gzip transients and reserves. Per-cohort
and per-start admission remains in place. Memory/inode admission is sequential
peak admission, not the sum of simultaneously running workloads. A trace that
exceeds its admitted estimate is retained and stops subsequent starts.

Packing is post-exit only. Raw files can be released only after gzip SHA and
independent decompression length/SHA validation are recorded and fsynced.
No XLSX, raster or immutable workbook link is recompressed or discarded.

`dur` in a trace is elapsed duration; only `tdur`, when present, is reported as
thread CPU. RSS, V8 heap/backing storage, encoded cache and RGBA size estimates
are distinct from attributed decoded-image allocator memory. First canonical
ref, image load, curtain removal and observed viewport visibility are distinct.

See the contributed diagnostic report for exact commands, failures, evidence,
analysis and decision boundaries. This is not integrated full regression or
Windows/Electron acceptance; PR/merge/release are outside this task.
