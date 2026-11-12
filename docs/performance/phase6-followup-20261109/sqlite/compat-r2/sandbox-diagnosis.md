# Invalid sandbox full regression attempt

The initial official-runtime gates 8/8, prototype 4/4, behavior 12/12 and related
84/84 passed in overlayfs. These logs remain supplementary. The initial standard
npm test was terminated during batch 1, not counted as a completed full suite:
no isolated default user data roots had been set, producing ENOENT at the
sandboxed /home/agent/.buyer-log/write-recovery path. Independently, a minimal
spawnSync(process.execPath, ["-e", "console.log(123)"]) probe returned an
EPERM error together with status 0 and empty stdout. Default Node isolated test
reporting showed file-level passes rather than actual inner-test results.
That run is invalid and all output is preserved; no batch fragments are reused.

A fresh-child test is strengthened to require result.error === undefined, in
addition to status=0, a real output file, SQLite integrity and full-state parity.
Receipt and argument copies use structuredClone so undefined keys cannot be
silently dropped by the comparison harness. No original assertion changed.
Final official and full standard commands are rerun outside the restricted
child-process sandbox, with synthetic app/local/server/auth/config/temp roots
under this worktree. Concurrency, limits, runner and product sources unchanged.


The first unsandboxed full attempt stopped at batch 2 with 6 FAIL. Its explicit
BUYER_LOG_TEMP_ROOT narrowed TEMPORARY_WRITE_ROOT to one directory, while tests
created their own os.tmpdir fixtures elsewhere. Four restore tests raised
DATA_INTEGRITY_ERROR; two IAM tests then returned 500/undefined instead of their
expected user. This is a harness environment conflict, not a prototype change.
Keep npm-test-root-failed.log. Unset BUYER_LOG_TEMP_ROOT and set TMPDIR to the
worktree .scratch for the new complete attempt, preserving the default owned-temp
and test-created fixture rules. Target those same 5 files first, then restart
unfiltered npm test from batch 1. No test assertions, production guards or batch
settings are changed, and no batch results from attempts are combined.

The first targeted retest fixed all four restore tests but retained 2 IAM FAIL:
the inherited BUYER_LOG_AUTH_DATA_ROOT overrode iam-v672's own SERVER_DATA_ROOT
fixture and caused IAM_LOCAL_INVALID. That test intentionally relies on the
standard auth-root derivation. Unset AUTH_DATA_ROOT as well and use a fresh
synthetic default root; retain data-root-targeted-auth-failed.log. This is an
environment correction, not changing IAM, test fixtures or assertions.

All raw .log/.tap output is retained byte-for-byte as .gz archives; see log-hashes.json.
