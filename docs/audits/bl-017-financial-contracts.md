# BL-017 — executable current financial contracts

Implementation and focused verification complete for the existing business policy. Final integrated full regression and batch merge remain pending. This extends the pricing-history slice documented separately in `bl-017-pricing-history.md`; it does not replace that slice's pinned evidence.

## Decisions and test vectors

The contract table in the first-slice audit remains the observed policy: latest matching Collection contract may be future-dated; FX falls back to the nearest previous month and then the earliest available month, with no invented expiry threshold; manual FX, country commissions, inheritance and DTR/CP-fallback differences remain explicit. No new finance policy is asserted or silently substituted. A new policy such as rejecting every old FX month would require a concrete product decision before arithmetic is changed.

`tests/fixtures/financial-contract-vectors.json` is the shared vector catalogue. CP/Collection Final FOB agrees for zero, fractional royalty, hologram, 1.005/24.925 half-cent boundaries, and invalid negative/100%/over-100% royalties. Open Costing agrees where the arithmetic is the same (zero-rate final rounding); its independent compound-cost order remains covered by its native fixture, rather than being forced into the royalty formula. TR/EN grouped and ungrouped money inputs are covered. Malformed grouping remains invalid; a single separator keeps its historical interpretation.

Three child-process time zones (Europe/Istanbul, UTC, America/Los_Angeles) each verify five date-only source/Excel-serial roundtrips including leap day, year boundaries and daylight-saving dates. These are calendar dates, not interchangeable UTC instants. Requested/applied FX month, manual rates, missing FX and earliest fallback are covered explicitly.

The focused matrix also includes actual installed UI/server calculation parity with invalid rates/holograms; inherited variants; ambiguous/missing licensors; separate country commission; Endeksmatik S7/W6 versioned TL formula/FX/provenance and legacy-snapshot contracts; native Open Costing; Collection numeric export, clipboard/summary projections and calculation notes. Endeksmatik is not the FOB royalty formula: its own reconciled workbook contracts remain authoritative.

## Confirmed corrections

Four initial RED cases demonstrated grouped TR/EN amounts rejected by Collection and invalid negative royalty yielding a royalty-free amount while CP refused calculation. Collection's parser now accepts correctly grouped mixed separators and preserves invalid text. The calculator refuses invalid effective royalty instead of converting it to zero. Both warning cells and the existing price drawer expose the blocker with TR/EN and accessible text.

One bounded independent review found the analogous invalid hologram case: CP returned null while Collection treated malformed/negative hologram cost as zero. Two additional RED vectors reproduced it; effective hologram validity is now included. Blank/default zero remains valid through the existing business normalization. DTR Final FOB validity is checked separately without changing its intentional landed-cost treatment. The reviewer did not rerun the final fix; no second review round was requested.

Source discovery also established that the only tracked direct import of `collection-pricing-service` is its test. Native Collection runs the installed `license-royalty-commissions.js`/shared engine path. BL-014 will therefore measure the actual client path, not present unused server-constructor improvements as desktop gains. The codebase graph was restored, but fast indexing excludes `public/`; these client findings rely on targeted source reads, Git references and native execution, not a completeness claim from the graph.

## Verification

Final relevant group: **28 files, 211 pass, zero failures/skips** (`work/bl017-contracts-final-target.log`). An initial expanded run found one pre-existing test-harness gap from BL-013: the extracted Supp. FOB template lacked `editorIdentity`. The fixture now supplies the bound identity and asserts that it survives rendering; existing warning assertions were retained.

Real full Buyer Log + Windows Edge loads persisted isolated synthetic Collection data, parses `1.234,56` as1234.56 and calculates Final FOB1543.20 under the valid demo rule. Ordinary hydration already rejects the synthetic invalid legacy rule as missing, so no claim is made that this path admitted it. A separately labelled controlled invalid input to the actual loaded client calculator verifies invalid flags, no numeric output, and the real TR/EN warning drawer. Genuine screenshots were inspected. The acceptance fixture initially used the wrong drawer selector; it now uses the actual `.cpdDrawer`.

Corporate Excel/Outlook, populated Electron performance, real shared storage and final full regression remain separate acceptance work. No TEST/STABLE publication, signing workflow dispatch or real business data was used.
