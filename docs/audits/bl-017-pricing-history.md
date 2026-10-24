# BL-017 — pricing history and executable contract boundary

Status: first correctness slice on a draft stacked on BL-013. This is not certification of the whole BL-017 package. Full regression and merge remain deferred to the final integrated backlog, as requested by the user. No TEST/STABLE publication or publisher dispatch.

## Confirmed defect and correction

CP inline Supp. FOB edits previously saved only numeric history. Undo returned the old amount while retaining manual metadata and its persisted override. Licensor history similarly retained manual selection. Five focused RED cases reproduced these defects before implementation; a separate real durable-store RED reproduced absence being replaced by a null/manual override.

History now captures pricing metadata and whether each canonical line-level override existed. Undo/Redo restores that intent; automatic intent recalculates with the currently loaded rule. Explicitly applied rule entries, imported CP-update provenance, manual values and absent entries remain distinct. Original order-level fallback entries and other model/colour lines are preserved. The same canonical identity and session owner guards from BL-013 still apply. Price history also checks current shared edit capability.

`pricingRestore` accompanies the ordinary `licensor`/`suppFob` payload fields. The backend rejects malformed descriptors before mutation. Ordinary order authorization, shared ownership, order and Supp. FOB CAS, durable storage and shared delta mirroring continue to run. Missing entries mirror as null field tombstones. The marker is deliberately outside the existing incremental-patch whitelist, requiring projection invalidation rather than applying an incomplete client patch.

A bounded independent review found three additional defects: consuming restore intent before ACK; recreating legacy line entries during later ordinary saves; and sending unnecessary shared price fields with Licensor Undo. All three were reproduced in new RED tests and corrected. Restore intent survives transient errors, successful ACK consumes only its own immutable intent, and late ACK cannot erase newer intent. Licensor Undo does not introduce shared price/sub-manufacturer writes; explicit later price/sub-manufacturer edits are still included. The reviewer did not execute tests; no second review round was requested.

## Existing financial decisions preserved

These are observed, executable contracts, not newly approved finance policy:

| Decision | Current contract | Evidence |
|---|---|---|
| Rule dates | The current Collection rule selector chooses the latest matching contract, including a future contract; Collection OPD does not filter it | `collection-pricing-engine.test.js` |
| FX fallback | Exact requested month, otherwise nearest previous, otherwise earliest available; no newly invented maximum age | `collection-pricing-engine.test.js`, `fx-calculation-engine.js` |
| FX evidence | Server calculation exposes requested/applied month and exactness; manual rate remains distinct | `collection-pricing-service.js`, existing native UI/server parity tests |
| Country commissions | TR and overseas use their own commission; missing TR rule stops TR landed without stopping overseas | `tr-landed-royalty-country-rule.test.js` |
| Rounding | CP/Collection Final FOB uses exact decimal fractions and half-up at the final two-decimal boundary; `1.005` and fractional royalty vectors remain covered | `royalty-two-way-fob-v593.test.js`, `royalty-precision-license-cards-v20261021.test.js`, `collection-pricing-engine.test.js` |
| 100% royalty | Final FOB inverse is invalid; the opposite direction intentionally permits zero | `royalty-two-way-fob-v593.test.js` |
| Deliberate differences | DTR and authorized CP fallback may have distinct Final FOB and overseas costed FOB | `collection-pricing-engine.test.js` |
| Group inheritance | Variant overrides replace inherited values without mutating the source projection | `collection-pricing-engine.test.js` |
| Open Costing | Cost lines and compound waste/overhead/finance/profit preserve their native order; missing currencies remain explicit | `open-costing-native-engine.test.js` |
| Endeksmatik | Real TL templates and historical legacy snapshots have separate versioned contracts | merged PR #700 and its audit; not re-certified here |

No arbitrary FX expiry threshold, future-contract prohibition or global formula unification is introduced by this change. Remaining BL-017 work includes a shared golden-vector matrix across all report/export surfaces, date-only roundtrips in the requested time zones and explicit resolution of any requested policy change before arithmetic is changed. Broader price/source presentation remains BL-024.

## Verification and limits

The final focused group contains 19 files, 144 passing tests, zero failures/skips. It covers actual durable override writes and CAS, shared-patch generation, real mutation-queue retry/late ACK, CP editing/history/canonical guards, native Collection parity, royalty precision, country rules, Excel date handling and Open Costing. Counts from earlier groups overlap and are not summed.

Real full Buyer Log in Windows Edge, using isolated synthetic IAM/ASAS/Non-DTR contract data and unmocked HTTP, starts at automatic 4.00; the actual price input saves manual 12.50; Undo restores automatic 4.00 and removes the durable manual line entries; a real `/api/data/cp` projection still reports rule provenance; Redo and a second Undo also persist. Genuine TR/EN post-change screenshots were inspected. Synthetic fixture setup initially lacked an explicit source licensor and therefore produced DTR; the fixture was corrected before assertions passed. The socket-restricted first launch could not start the fixture; the authorized local run succeeded.

Transient network failure, late ACK, legacy fallback and capability revocation are targeted controlled tests, not claimed as observed corporate outages. No full test, real company data, SMB/OneDrive, Excel COM, Outlook or production publication was exercised in this slice.
