# Native verifier validation prototype

Run from the repository root. Production and `preparation/` are read-only.
Packet commit: `82919980e3d2b4c29d05c1d2c27050448ab3e1f3`; contribution:
`7652f3d294f3a530a28938eff81cbe477c5a0884`. Staging checks native pins,
preserves original test bytes and refuses to overwrite changed staged files.
It never regenerates the preparation packet.

```sh
p="$PWD/scripts/prototypes/phase6c-native-verifier-validation-20261108"
(cd "$p/preparation" && sha256sum -c MANIFEST.portable.sha256)
node "$p/stage-committed-source.cjs"
export BL_NATIVE_VERIFIER_APP_ROOT="$PWD/resources/app"
export BL_NATIVE_VERIFIER_SOURCE="$p/candidate/local-db.js"

flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  node --test --test-reporter=tap \
  "$p/preparation/tests/local-db-private-durability.test.js" \
  "$p/integration-boundaries.test.cjs" \
  "$p"/committed-source/resources/app/tests/*.test.js

flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  node --require "$p/load-candidate.cjs" --test --test-reporter=tap \
  resources/app/tests/local-db-*.test.js \
  resources/app/tests/file-lease-integrity.test.js \
  resources/app/tests/file-lease-async-io.test.js \
  resources/app/tests/file-lease-context-lifetime.test.js \
  resources/app/tests/shared-lease-corrupt-owner-v20261009.test.js \
  resources/app/tests/durable-async-prior-intent.test.js

flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  node "$p/measure-verifier.cjs"
```

Capture stdout, stderr and exit codes in **new** evidence files. Do not overwrite
retained runs. Exit 75 means the lock is busy: do not start tests/measurement or
delete the lock. For controlled RED, select
`BL_NATIVE_VERIFIER_SOURCE="$p/preparation/local-db.js"` and run only the boundary
file under the same lock; three tests should fail. Base API absence is not RED.

Delegation uses the same actual DB/state inside native prepare. No Linux fixture
verifier or successful no-op proof is installed. Negative tests retain deliberate
invalid proof/error injections. Evidence and limitations are in the documentation
directory's README/FINDINGS. Linux validation and synthetic cost observation do
not establish Windows/Electron or power-loss support. Phase 6c stays inactive.

TR: Hazır paket değiştirilmedi. Katkı testleri aynı assertion'larla gerçek aday
API'ye bağlanır. Son-await düzeltmesi yalnız `candidate/` içindedir. Test/ölçümler
ortak kilitle çalışır; eski kanıtlar üzerine yazılmaz. Üretim entegrasyonu,
Windows/Electron politikası, tam regresyon ve P1 incelemesi ana sohbette kalır.
