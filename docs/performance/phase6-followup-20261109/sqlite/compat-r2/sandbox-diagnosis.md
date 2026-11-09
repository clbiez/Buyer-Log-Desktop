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
