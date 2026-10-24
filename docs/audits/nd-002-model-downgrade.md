# ND-002 — explicit USD and S7/W6 TL workbook contracts

The old generic upload path could reinterpret a failed USD formula signature as
TL when an extra V:W FX table happened to parse. The first draft required C1/C2
metadata and no formulas in C15:C19. A bounded independent review demonstrated
that erasing those five formulas still bypassed the draft. The user then supplied
two real TL files; both contain formulas there, so the draft also rejected valid
files. That draft was not merged.

## Final behavior

`endeksmatik-tl-model.js` positively matches 24 control formulas for each known TL
layout. Pivot lookup ranges may vary as in the supplied files, but component,
selection, order/depot month, weight, FX, total and target dependencies remain
bound to that layout. Significant string-literal spaces are preserved. Missing
USD formulas, a readable second FX table or forged legacy metadata cannot grant
a TL fallback. Unknown/data-only layouts fail with MODEL_SIGNATURE_MISMATCH.
The separate trusted raw legacy recovery API is retained; normal HTTP upload
uses the strict model entry point. No Excel macro or formula is executed.

| Contract | Control indices / weights | Source metadata / adjustment | Arithmetic |
|---|---|---|---|
| Existing USD | C15:C18 / E15:E18 | C2/C3 / B21 | Existing USD engine unchanged |
| S7 TL workbook v1 | C16:C19 / F16:F19 | C1/C2 / B22 | Fabric/accessory use order months; CMT/extra use depot months |
| W6 TL workbook v1 | C17:C20 / F17:F20 | C2/C3 / B23 | Same TL arithmetic, shifted control layout |
| Historical legacy snapshot | Existing stored values | Existing stored values | Existing legacy-v602 behavior preserved |

New TL uploads carry `endeksmatik-tl-workbook/v1`: each component target is
`(1 + index) * (1 - adjustment) - 1`, matching the actual source formulas for all
four components. TL totals are weight sums; USD conversion uses the exact old/new
depot FX months. Historical snapshots keep their former first-two-component
adjustment behavior and are not silently migrated. The synthetic 10% growth,
3% adjustment vector produces 6.7% for the workbook contract and preserves 7.69%
for the historical contract. Price precision and royalty/hologram rules are not
changed. Result provenance includes contract, layout, file/set/hash and exact FX
policy. Broader CP/Collection/Open Costing rule and rounding policies in BL-017
remain a separate unfinished package.

Numeric cached Excel results are compared with tolerance 1e-6. A mismatch, or
numeric results whose reference cannot be calculated, rejects the upload without
changing existing sets. A valid formula contract with an unavailable nonnumeric
sample is accepted with an explicit unverified-result warning. Invalid metadata
dates remain unknown; no date is guessed. Valid date-only metadata honors the
workbook's 1900/1904 date system. TR/EN set management distinguishes these states
and wraps details within the existing theme.

## Verification and limits

The user-provided desktop workbooks were read locally without importing company
data into the fixture or uploading workbook bytes. All five country USD files
passed their existing 13 numeric checks. The real W6 TL file passed 24 numeric
checks; its source date contains a doubled dot and is reported as unknown. S7's
formula contract passed, but its selected sample cannot be calculated and is not
certified as reconciled. Before/after SHA-256 values confirm all seven originals
were unchanged. The sanitized acceptance record contains no workbook cell values.

Regression coverage includes both layouts, changed formulas/caches/months,
significant string spaces, forged/erased USD formulas, malformed dates, leap day,
1904 dates, independent TL sets, original legacy preservation and unchanged USD
checks. The independent review found the draft bypass; the root implemented and
validated its correction, without a second review round. Windows Edge with the
actual server and synthetic data verified native uploads, rejection with HTTP422,
no set mutation, TR/EN rendering and genuine post-change PNGs. An initial capture
obscured by first-run notes was discarded and recaptured after closing that UI.

See `nd002-windows-acceptance-20261024.json` for exact final code, runner counts,
fixture scope and evidence. The first full run stopped at an ambient-Edge
assumption in the failed-discovery test. A synthetic valid localhost DevTools
endpoint reproduced the same failure: successful discovery correctly clears
cooldown. The test now compiles the actual state/functions with an explicitly
failed discovery dependency, checks suppression during cooldown and retry after
reset. It passes with that same ambient endpoint; production browser logic and
the other real socket tests are unchanged. The first failed log is retained.
The input inspection is a local parsing measurement,
not multi-user HTTP latency or corporate Excel/SMB acceptance. Large workbook
parsing still runs on the request process; parser isolation/bounds remain BL-018.
Only the known S7/W6 formula layouts are claimed; future variants fail closed.

Backend restart is required after deployment. The user authorized development
and merge; no manual patch, TEST or STABLE publication was requested or performed.

## Türkçe kısa kayıt

Eski taslağın hem USD düşürme açığı hem gerçek TL dosyalarını reddetmesi giderildi.
S7/W6 dosyaları ayrı ve sürümlü formül sözleşmesiyle tanınır. Yeni yüklemelerde
kaynak dosyanın dört bileşenli düzeltmesi uygulanır; geçmiş kayıtların hesabı
değişmez. W6'nın 24 sayısal sonucu eşleşti; S7'nin örnek sonucu ve W6'nın bozuk
tarihi doğrulanmış gösterilmez. Yedi asıl dosya değişmedi, şirket verisi depoya
eklenmedi. Projenin diğer paketleri ve yayın kabulü tamamlanmış sayılmaz.
