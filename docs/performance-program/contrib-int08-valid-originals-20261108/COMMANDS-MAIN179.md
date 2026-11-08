# Main179 diagnostic commands

These are this execution's explicit local paths, not defaults or dependencies
on another chat's filesystem. All new runtime files are under the diagnostic
copy's `work/` directory. For a fresh execution, select fresh work/stage/run
labels and pass its own paths. Keep the original preparation directory intact.

```sh
git fetch origin main prep/int08-valid-images-packet-20261108
git fetch origin refs/heads/prep/int08-valid-images-packet-20261108:refs/remotes/origin/prep/int08-valid-images-packet-20261108
git rev-parse origin/prep/int08-valid-images-packet-20261108
# d4565563bc21eabc06fdb66d6251475bed5078e8
git switch -c diag/int08-valid-originals-20261108 d4565563bc21eabc06fdb66d6251475bed5078e8
```

The first fetch used `Main`, which does not exist remotely; the actual ref is
`main`. No source branch was rewritten. The explicit refspec above fetched and
verified the preparation SHA. All 12 raw v2 SHA-256 values were checked against
`preparation/portable-manifest.json` before making the executable copy.
Manifest SHA: `529dc8c652eab19db8ac436fc3e1536d1c1e4e59c0c2d2446dda0190d016aa05`.

```sh
int08_repo=/workspace/Buyer-Log-Desktop
int08_dir="$int08_repo/scripts/prototypes/int08-valid-originals-20261108/diagnostic-main179"
int08_work="$int08_dir/work"
int08_cache="$int08_work/temp/buyerlog-startup-main179"
int08_revision=1796193f0a57c7785e7bf9fdb3557e33c550b25e
int08_stage="$int08_work/stages/$int08_revision-main179-diag-01"
int08_playwright=/opt/codex/cua_node/lib/node_modules/playwright
int08_chromium=/usr/bin/chromium
```

The tracked demo tar was safely extracted into the new cache's `source/`.
Its four declared regular members and the three workbook SHA-256 values were
verified before use. No previous `/tmp` cache was consumed.

```sh
flock -n -E 75 -F /tmp/buyerlog-performance-measurement.lock \
  python3 "$int08_dir/prepare.py" --revision "$int08_revision" \
  --repo "$int08_repo" --dependencies "$int08_repo/resources/app/node_modules" \
  --source-cache "$int08_cache" --work-root "$int08_work" --stage-tag main179-diag-01
```

Before any app started, whole-task disk/memory/inode admission was recorded in
`whole-task-disk-admission.json` and `admission-whole-task.json`. After the first
full smoke exceeded its trace estimate, the fixed plan was readmitted with its
observed lossless evidence size (`revised-whole-task-admission.json`). These
are estimates/reserves, not event, frame, sample, timeout or file-size caps.

The unchanged Faz0 harness ran once, with the normal local-only guard and an
empty inherited service environment. Its refresh POST succeeded once. The
later browser launch failed on the Unix socket path limit. Do not repeat this
bootstrap on the existing root; its cache is already prepared and verified.

```sh
flock -n -E 75 -F /tmp/buyerlog-performance-measurement.lock \
  env -i PATH="$PATH" LANG=C.UTF-8 TZ=UTC TMPDIR="$int08_work/temp" \
  APPDATA="$int08_cache/appdata" LOCALAPPDATA="$int08_cache/localappdata" \
  PLAYWRIGHT_MODULE="$int08_playwright" CHROMIUM_PATH="$int08_chromium" \
  NODE_OPTIONS="--require=$int08_dir/local-only.cjs" \
  node resources/app/scripts/benchmark-startup-orders.js \
  --app-root "$int08_stage/pinned/resources/app" --fixture-root "$int08_cache" \
  --rows 30000 --module cp --skip-same-tab --out "$int08_work/phase0.json"
```

The source-pinned app tree is Main179. The Faz0 harness's separate `git HEAD`
field reports the containing preparation checkout (`d4565563`); that raw field
was not rewritten or relabeled. `source-pins.json` and the frozen app tree
establish the actual application revision.

Define this shell convenience function, then invoke it under the shared lock
(the real counted launch held one lock across both complete cohorts):

```sh
int08_run() {
  python3 "$int08_dir/run-cohort.py" \
    --stage-root "$int08_stage" --source-cache "$int08_cache" --work-root "$int08_work" \
    --playwright-module "$int08_playwright" --chromium "$int08_chromium" "$@"
}
```

Executed smoke labels include `cp-smoke-01` through `cp-smoke-08` and
`orders-smoke-01` / `orders-smoke-02`. The first six CP attempts are exploratory
evidence. `cp-pairs-01` completed, but `orders-pairs-01` stopped on the missing
catalog's generation publication. Both are retained under their original
labels. Final counted cohorts use the stricter common catalog-warm protocol
and fresh `*-pairs-02` labels. Each actual probe command and dispatcher
invocation is retained in its cohort JSON.

```sh
# Each following command ran inside flock -n -E 75 -F ... bash -c 'set -e; ...'.
int08_run --module cp --smoke --label cp-smoke-07 \
  --budget-from-smoke "$int08_work/runs/cp-smoke-06/smoke-originals"
int08_run --module orders --smoke --label orders-smoke-01 \
  --budget-from-smoke "$int08_work/runs/cp-smoke-07/smoke-originals"
int08_run --module cp --repeats 3 --label cp-pairs-01 \
  --budget-from-smoke "$int08_work/runs/cp-smoke-07/smoke-originals"
int08_run --module orders --repeats 3 --label orders-pairs-01 \
  --budget-from-smoke "$int08_work/runs/orders-smoke-01/smoke-originals"

# After the strict generation failure, the remaining full task was readmitted
# with a 12 GiB disk budget; no old evidence or workload was removed.
int08_run --module cp --smoke --label cp-smoke-08 \
  --budget-from-smoke "$int08_work/runs/cp-smoke-07/smoke-originals"
int08_run --module orders --smoke --label orders-smoke-02 \
  --budget-from-smoke "$int08_work/runs/orders-smoke-01/smoke-originals"
int08_run --module cp --repeats 3 --label cp-pairs-02 \
  --budget-from-smoke "$int08_work/runs/cp-smoke-08/smoke-originals"
int08_run --module orders --repeats 3 --label orders-pairs-02 \
  --budget-from-smoke "$int08_work/runs/orders-smoke-02/smoke-originals"
```

Analysis, representative derivative checks, targeted tests, source/lock checks
and evidence collection also run serially under the same nonblocking lock.
Their exact invocations and outputs accompany the contributed report.
No PR, merge, rebase, force-push, independent review or TEST/STABLE release is
part of these commands. Delivery uses a normal branch push plus remote SHA
verification.

## Analysis and delivery invocations

The following ran after the twelve final cases, under the same shared flock.
Variables have the explicit values defined above; `int08_docs` is
`$int08_repo/docs/performance-program/contrib-int08-valid-originals-20261108`.

```sh
python3 "$int08_dir/analyze.py" --work-root "$int08_work" \
  --output-dir "$int08_docs/analysis-main179" --cohort cp-pairs-02 --cohort orders-pairs-02
python3 "$int08_dir/summarize.py" --analysis "$int08_docs/analysis-main179/recomputed-analysis.json" \
  --output "$int08_docs/analysis-main179/paired-summary.json"
python3 "$int08_dir/representative-quality.py" --stage-root "$int08_stage" \
  --output-dir "$int08_docs/quality-main179"
node "$int08_dir/decode-representatives.cjs" --stage-root "$int08_stage" \
  --quality-root "$int08_docs/quality-main179" --output-dir "$int08_docs/quality-main179/native-decode" \
  --playwright-module "$int08_playwright" --chromium "$int08_chromium"
python3 "$int08_dir/validate-inputs.py" --repo "$int08_repo" --work-root "$int08_work" \
  --output-dir "$int08_docs/input-validation-main179-04"
```

The three preceding input-validator calibration attempts and the first test
launch are retained in the administrative logs. Production validators were not
changed. The baseline is a `note` plus empty `files` wrapper; Windows launchers
have declared CRLF checkout/archive attributes. Both representations were
checked against their exact normalized Git blob, without rewriting files.

The successful test launch used these explicit, private defaults (HOME was not
changed). The first launch without these roots failed before some test files
could import user-data; its log remains `targeted-tests.log`.

```sh
int08_defaults="$int08_work/test-defaults-02"
export TMPDIR="$int08_work/temp" npm_config_cache="$int08_work/npm-cache"
export BUYER_LOG_LOCAL_DATA_ROOT="$int08_defaults/local" BUYER_LOG_DATA_ROOT="$int08_defaults/app"
export BUYER_LOG_SERVER_DATA_ROOT="$int08_defaults/data" BUYER_LOG_AUTH_DATA_ROOT="$int08_defaults/data"
export BUYER_LOG_CONFIG_PATH="$int08_defaults/config.json" BUYER_LOG_LOCAL_DB="$int08_defaults/local/BuyerLogLocal.db"
export BUYER_LOG_PORTABLE_DATA_ROOT="$int08_defaults/portable" BUYER_LOG_TEMP_ROOT="$int08_defaults/tmp"
export BUYER_LOG_CENTRAL_IAM_ENABLED=0 BUYER_LOG_IAM_SHARED_ROOT="$int08_defaults/iam-disabled"
export APPDATA="$int08_defaults/appdata" LOCALAPPDATA="$int08_defaults/localappdata"
cd "$int08_repo/resources/app"
npm test -- image model-asset canonical-fields canonical-column iam-session-scope collection-private-replication startup-benchmark first-transition-benchmark i18n-coverage-guard
node --test tests/checklist-components-row-cache.test.js tests/cp-personal-layer-delta.test.js tests/checklist-columns-delta.test.js tests/checklist-summary-contribution-cache.test.js tests/checklist-applies-row-memo.test.js tests/checklist-answer-batch-notify.test.js tests/checklist-assistant-view-reuse.test.js tests/checklist-remote-merge-noop.test.js tests/checklist-components-count-lookups.test.js
npm run i18n:check
```

Test stdout/stderr is stored under `tests-main179/`; final results are
461/461, 23/23 and new i18n 0 / baseline 0. No full integrated regression or
Windows/Electron acceptance is claimed.

```sh
python3 "$int08_dir/collect-evidence.py" --work-root "$int08_work" \
  --output-dir "$int08_docs/evidence-main179"
python3 "$int08_dir/verify-portable-evidence.py" --evidence-root "$int08_docs/evidence-main179" \
  --output "$int08_docs/portable-archive-validation.json"
```

The collector's own administrative stdout was sealed after that process
exited, before portable verification. This changes no measurement or original
compression manifest. The copied evidence has 450 verified files and 27
independently decompressed gzip round trips; 29 private mutable fixture/auth
artifacts remain retained locally and are intentionally not republished.

`provenance/early-pre-catalog-probe.cjs` is a byte-exact recovery of the early
measured probe, verified against the original execution SHA
`b7f1319420a7405bee15c249c3f3fb9cf5f8a3c1d5ac213b3475eeb943a1a680`.
Final paired data uses the parent probe with the strict catalog preparation.
The broad nested elapsed-duration field in the earlier cp-smoke-06 is not used
as decoder CPU; final analysis uses `Decode Image` leaf `tdur` only.

Delivery uses a normal commit and normal push; pack worker memory is bounded
without changing evidence or sample counts:

```sh
git -c pack.threads=2 -c pack.windowMemory=64m push -u origin diag/int08-valid-originals-20261108
git ls-remote origin refs/heads/diag/int08-valid-originals-20261108
```

The exact delivered paths and SHA-256 values are in `DELIVERY-FILES.txt` and
`DELIVERY-SHA256.json`. The commit's own SHA and verified remote SHA are given
in the chat delivery; a commit cannot embed its own resulting hash.

## Recompute from a checkout of the delivered evidence only

No previous work root, cache, auth state or `/tmp` file is needed to read the
archived performance evidence. The portable mode first verifies every delivered
file and gzip, then parses the complete traces. Its private-fixture exclusion
is explicit; default local packing verification still checks all artifacts.

```sh
flock -n -E 75 -F /tmp/buyerlog-performance-measurement.lock \
  python3 "$int08_dir/analyze.py" --portable --work-root "$int08_docs/evidence-main179" \
  --output-dir "$int08_docs/analysis-portable-main179-checked" \
  --cohort cp-pairs-02 --cohort orders-pairs-02
```

The actual checked invocation added a Python `sys.addaudithook` that raises on
any `open` beneath the historical `diagnostic-main179/work` root. It completed
all twelve analyses, then compared every numeric/functional field to the local
analysis. Only current `run` path and the count of reverified private fixture
gzip artifacts differ. `portable-recompute-validation.json` records PASS.
The earlier portable-reader output remains with a README explaining its
transport-only counter correction. No raw measurement was edited or repeated.
