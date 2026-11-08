# Orders UI command gates / Orders UI komut kapıları

Local Phase 6a integration, public thin still OFF. This is not final phase
acceptance, a performance gain claim or an independent P1 review.

**[Doğrulandı]** Orders filtre, sıralama, başlık, boyut, kısmi görünüm ve seçim
başlatıcıları, ince veri varsa gerçek full promotion'ı bekliyor. Kaynak/oturum,
aktif sekme ve hedef kontrolün değeri/bağlantısı beklemeden sonra tekrar
doğrulanıyor. Eski tuşlama sessizce eleniyor; native event tekrar oynatılmıyor.
Tam veri ve CP dalları önceki senkron gövdelerini koruyor.

Private source guards are distinct from the earlier accepted DOM/demand capture:
pending input legitimately changes that demand. The existing native promotion
and its real source/session epochs remain responsible for full publication.
Selection mapping uses original row references and the native ordinal receipt,
including duplicate business IDs and sparse 0/false/null fields. An old Undo
cannot relink another source by business ID. Public managed snapshot remains
synchronous and rejects thin before reading rows.

## Evidence / Doğrulama

- First V3 setup failed because Git's captured 3 MB app exceeded Node's default
  child-process output buffer. This is not behavioral RED; it is retained.
- First corrected setup: baseline **14 PASS / 40 FAIL**, candidate **53/1**.
  One failure came from a fixture returning Array.push's count as renderOrders'
  result. The actual product function returns undefined. The fixture now runs
  that exact real function against its observable defer sink; all original
  assertions remain unchanged.
- Correct behavioral comparison: baseline **15 PASS / 39 FAIL**, same candidate
  assertions **54 PASS**. Exact actual product mode **54 PASS**.
- These 54 cases are in the normal npm runner. A portable replay uses the
  existing frozen app fixture plus exact reviewed deltas; no new whole-app
  snapshot or historical Git checkout is required in shallow CI.
- First wider package **531 PASS / 2 FAIL** found missing real guard dependencies
  in the old compact-selection fixture. It now executes real guard functions;
  a new case verifies thin fails before filtered/copy source reads.
- Final related package **534 PASS / 0 FAIL / 0 SKIP / 0 CANCEL**; exact #916 fast
  step **23 PASS**; syntax and i18n **0/0**; **50** unchanged notes validate.

The exact incremental composition starts at `5829fcf4` / `d088…` and produces
app SHA `46a05e7073a761a7f311457e94ea7afc022c0b37b24d1b60398d41870b235f5a`.
`source-pin-review.json` records unchanged CP loader, clipboard, normalizer,
switchTab and corrected profile/source functions. Original pins and every
failed output remain with their raw SHA-256 hashes.

**Kalan / Remaining:** actual finite client/controller installation, strict
QFG extra demand capture/editor gates, configuration/SSE writers and remaining
full-before-use consumers. The UI helper is not eagerly loaded or activated.
Final browser/TR+EN/theme checks, real post-change release PNG, first-CP cohort
with #916 on both arms, current full regression, CI and one P1 review remain
required before acceptance/merge. No PR, merge, TEST or STABLE here.
