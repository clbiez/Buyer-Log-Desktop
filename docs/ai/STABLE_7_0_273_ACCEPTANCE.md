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

## Actual publication — 2026-10-14 (Europe/Istanbul)

- TEST run https://github.com/clbiez/Buyer-Log-Desktop/actions/runs/38467281188 succeeded against source `012c2e1366e987c8f5815686fdc0d1672c2f0104`.
- The full Windows sweep executed all 988 files / nine batches: 7,583 cases, 7,581 passes, zero failures and two pre-existing platform/opt-in skips (OneDrive symlink/reparse acceptance and the optional 20,000-operation soak). Skips are not credited as passes. All nine mandatory model-image return scenarios passed in the release's actual Chromium environment.
- STABLE run https://github.com/clbiez/Buyer-Log-Desktop/actions/runs/38477382069 succeeded. The TEST and STABLE manifests have identical size `206524426`, SHA-256 `910add9d321d9080c67305ebfb132140fe19c8710efc26ed9561270920755c49` and Ed25519 signature. The application's real trusted-key verifier returned `verified:true`, `enforced:true`, key ID `c4b9c0d6f8a4be0d`.
- https://github.com/clbiez/Buyer-Log-Releases/releases/tag/stable-v7.0.273 contains the update ZIP and signed manifest. New-user installer run 38477474636 succeeded and uploaded `BuyerLog-Kurulum-7.0.273.zip` plus its checksum. No ZIP used Actions artifact storage.
- Main archive commit `caf4bbefbb27416dd0d2eb5fac6e81d39147c7b7` persisted the 172 bilingual real-image visual notes under immutable `7.0.273/` and reset pending notes. The failed 7.0.272 run remains a failed candidate and was not promoted.
- Remaining Agent Capability development continues under the user's existing instruction. Later receipt/publication and Landed changes are separate future packets, not changes to this immutable release. Corporate PLM/LCW AI/SSO/share-folder and physical packaged Windows/GPU acceptance limitations are unchanged.
