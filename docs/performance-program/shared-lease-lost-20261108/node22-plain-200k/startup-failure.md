# Başlatma hatası / Startup failure

İlk deneme ölçüm başlamadan başarısız oldu. / The initial attempt failed before
starting the measurement worker.

Command (shared flock was acquired by `run.sh`):

```sh
DIAG_NODE=/workspace/.buyerlog-tools/node_modules/node/bin/node \
  bash scripts/prototypes/shared-lease-lost-20261108/run.sh \
  node22-plain-200k 200000 plain
```

Tool invocation exited 1. No child workload stdout/stderr existed. The setup
error was returned in the execution tool transcript (not redirected to a file).
The material error/stack is retained here; the verbose Node Buffer rendering of
the `git show` source output is not duplicated:

```text
Error: spawnSync git EPERM
    at Object.spawnSync (node:internal/child_process:1120:20)
    at spawnSync (node:child_process:902:24)
    at execFileSync (node:child_process:945:15)
    at .../scripts/prototypes/shared-lease-lost-20261108/run.cjs:24:15
errno: -1
code: EPERM
syscall: spawnSync git
path: git
spawnargs: show abc683e4bcc247a7e8e412c07532bc8059fe3adb:resources/app/server/lib/local-db.js
status: 0
signal: null
Node.js v22.23.4
```

An empty synthetic root was allocated before the failure. Nothing was deleted.
The run directory is deliberately retained, never overwritten. A separately
named retry used the same unmodified harness outside the subprocess-restricting
sandbox, under the same flock, with a fresh synthetic data root. This setup
failure is not SHARED_LEASE_LOST and is not counted as a 200k trial.
