# INT-06 test fixture

`inherited/` contains the nine original preparation files from PR [#890](https://github.com/clbiez/Buyer-Log-Desktop/pull/890),
revision `65074a21d7ae8fcadd6dc1628550b3ae4ed8eacf`. They were read with
`git show REV:path`, not regenerated. The `.source` suffix prevents recursive
native test discovery from executing the originals in the wrong directory.
`provenance.json` records original paths, stored paths and SHA-256 hashes.

The inherited wrapper verifies every byte, restores the original paths in an
isolated temporary overlay, and runs the unchanged preparation and crash/resume
tests against read-only links to this checkout's server/public files. Its `.git`
link permits the original ancestry/provenance assertions. It never edits those
production trees. All 17 original tests and their validators/timeouts remain intact.

`adapter.cjs` and `process.cjs` are new test-only seams for the independent helper.
The production connector still constructs full checkpoints. The adapter extracts
the batch delta, verifies the complete persisted manifest against that checkpoint,
and uses the inherited independent oracle without altering its assertions.
These processes do not introduce an application worker mechanism.

`measure.cjs` replays the inherited mock transport trace into either the original
store or the journal, using a fresh process per sample. Input trace generation,
legacy input counters and compatibility sets are outside checkpoint timing;
legacy full copies/list copies/serialization/writes and journal initialization,
commit/counters/snapshot/final compaction are inside it. It measures logical
payload bytes with the unchanged #890 observer, separate checkpoint CPU/wall,
and OS process-lifetime peak RSS before load/oracle allocation. It is a prototype
store comparison, not a measurement of an integrated production refresh. The
legacy store has no fsync, so the arms also differ in durability guarantees.

Every invocation of tests or measurements on this VM must be enclosed by:

```sh
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock COMMAND...
```

Exit 75 means another owner holds the lock: stop; do not remove it or start
another run. The originals also retain their own older preparation lock.

Example campaign, from the repository root (fresh output directory required):

```sh
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  node resources/app/tests/fixtures/int06-checkpoint-journal/cohort.cjs \
  docs/performance-program/contrib-int06-checkpoint-journal-20261108/measurements
```

The full inherited end-to-end benchmark remains unchanged and separate. Its
historical results are not relabelled as measurements of this branch.
