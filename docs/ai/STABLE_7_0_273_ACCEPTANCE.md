# Buyer Log 7.0.273 — release gate continuation

TR: 7.0.272 kaynak dalı değişmezdir. Windows regresyonu başarısız olduğu için bu adayın TEST paketi üretilmedi ve STABLE terfisi yapılmadı. Düzeltmeler yeni 7.0.273 kaynak sürümünde doğrulanır. Yayın sonrası Agent Capability projesinin kalan paketlerine ek kullanıcı onayı beklenmeden devam edilir.

EN: The 7.0.272 source branch is immutable. Its failed Windows regression produced no TEST artifact and no STABLE promotion. The fixes are validated against a new 7.0.273 source version. Remaining Agent Capability packets continue after publication without waiting for additional user approval.

## Evidence and preserved controls

- Existing implementation, visual evidence, native acceptance and corporate/physical Windows limitations are documented in `STABLE_7_0_272_ACCEPTANCE.md`; none of those limitations is declared resolved here.
- Windows run 38461445827 stopped after batch 1: 1,296 passed, three failed. Reservation reconciliation legitimately included another expired fixture owner's reservation; two correct numeric/UTF-8 results exceeded hardware-sensitive wall-clock thresholds. The failed run is not counted as successful.
- Reconciliation checks now select the current fixture owner's runs while also requiring unique receipts and no second replay. The native reconciliation implementation is unchanged.
- The 50,001-row test preserves all exact numeric checks and uses passthrough native-reader instrumentation to bound index construction and cell reads linearly. The Unicode preview test preserves its byte/omission checks, bounds serialization passes and verifies the complete native evidence hash is unchanged. Timings remain diagnostics, not claimed benchmark passes.
- The Windows job has 60 minutes to execute the complete nine batches; no test, IAM assertion, approval gate or production algorithm is removed.
- The canonical CI publisher in PR #558 preserves signing and local/remote/public SHA-256 checks. Archives above GitHub's 100 MiB Git blob limit use the already-supported public release-asset provider rather than a rejected raw Git mirror. This does not publish an unverified archive.
- Independent focused review found no open P0/P1 in the test-only fixes. Final-source Windows full regression, release model-image acceptance, signing, public byte verification and identical-byte STABLE promotion remain mandatory and pending until the workflows actually succeed.
- Final local targeted rerun: all 107 automation/Collection/Quality cases passed with zero skips; all 10 distribution/workflow cases passed. Version assertion resolved canonical `7.0.273`; pending release-note validation accepted all 172 bilingual visual entries.
