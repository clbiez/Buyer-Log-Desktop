# Evidence sealing failure (not a workload failure)

Command, under the shared measurement flock:

```sh
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  /workspace/.buyerlog-tools/node_modules/node/bin/node \
  scripts/prototypes/shared-lease-lost-20261108/seal-evidence.cjs
```

Exit code 1; stdout empty. The tool returned this stderr:

```text
node:internal/errors:540
      throw error;
      ^

TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined
    at Object.readdirSync (node:fs:1581:10)
    at walk (/workspace/buyerlog-diag-shared-lease-lost-20261108/scripts/prototypes/shared-lease-lost-20261108/seal-evidence.cjs:56:24)
    at Object.<anonymous> (/workspace/buyerlog-diag-shared-lease-lost-20261108/scripts/prototypes/shared-lease-lost-20261108/seal-evidence.cjs:62:3)
    at Module._compile (node:internal/modules/cjs/loader:1781:14)
    at Object..js (node:internal/modules/cjs/loader:1913:10)
    at Module.load (node:internal/modules/cjs/loader:1505:32)
    at Function._load (node:internal/modules/cjs/loader:1309:12)
    at wrapModuleLoad (node:internal/modules/cjs/loader:254:19)
    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:171:5)
    at node:internal/main/run_main_module:36:49 {
  code: 'ERR_INVALID_ARG_TYPE'
}

Node.js v22.23.4
```

TR: Toplayıcı iki manifest şemasını aynı saydı: 200k sürücüsü veri kökünü
`preflight.dataRoot`, kontrol sürücüsü `dataRoot` alanına yazar. Yanlış yol
seçimi yalnız disk kanıtını paketleyen bu yardımcıyı durdurdu; senaryoların
assertion'ları veya 109 mevcut test etkilenmedi. Ham kanıtlar değiştirilmedi.

EN: The sealer incorrectly assumed both manifest schemas stored `dataRoot` at
the top level. This stopped only disk-evidence packaging; trials and tests had
already passed. `seal-evidence-v2.cjs` accepts the two explicit recorded paths
and still asserts their type, every recorded source/harness pin, exact stream
bytes and ACK/reopen equality. No assertion was removed or relaxed.

The failed v1 helper is retained byte-for-byte because one run manifest records
its hash (`64d3e2a16c39ce5c78a1cdce495cfb8939ef1d8093749be2a4fc8c04c39a881e`).
Use v2 for evidence generation. No measurement rerun was needed for this
post-processing-only correction.
