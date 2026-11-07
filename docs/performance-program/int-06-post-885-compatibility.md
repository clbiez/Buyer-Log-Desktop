# INT-06 — #885 sonrası Main uyumluluğu / post-#885 Main compatibility

TR: **INT-06 açık; yalnız hazırlık uyumu.** Mevcut #890 dalına güncel Main
`63159fb32ff3d5bdc5f142b4a8f16ca6a3983240` (#902) normal merge ile alındı.
#885 merge SHA'sı `76ddbaf4a2a85132d2ad9dff8d1465377e1f81aa` geçmişte doğrulandı.
Devralınan head `be2f0636d340fffb7c11d6573694b4c354a33d6b`; merge commit'i
`d58d85f2048462484455ae2cc9f5cd7c21f55709`. İkinci PR, rebase veya force-push yok.
Üretim dosyalarına özgün değişiklik eklenmedi; server/public ağaçları Main ile aynı.
Üretim uygulaması programın **Faz 7 sırasını bekler**.

EN: **INT-06 remains open; preparation compatibility only.** Normally merged
current Main `63159fb32ff3d5bdc5f142b4a8f16ca6a3983240` (#902) into the existing
#890 branch. Verified #885 merge `76ddbaf4a2a85132d2ad9dff8d1465377e1f81aa`
in its ancestry. Inherited head: `be2f0636d340fffb7c11d6573694b4c354a33d6b`;
merge: `d58d85f2048462484455ae2cc9f5cd7c21f55709`. No second PR, rebase,
force-push or original production edits. Server/public trees equal Main.
Production implementation waits for the program's **Phase 7 sequence**.

## Kaynak, provenance ve ankorlar / source, provenance and anchors

TR: Hash değişiklikleri kabul listesine eklenmedi; provenance/test kodu değişmedi.
Ölçülen `power-bi-import-dashboard.js` ve canonical dosyaları byte olarak aynı.
Modül SHA-256: `5ed838337012f63ffe2ad93bb1e26333f345ef822bcc261b5738dac6792e80d2`.
Harness, fixture/oracle, crash helper ve assertion'lar devralınan head ile birebir.
V1 fixture SHA-256: `8cb6fc65977e761d6ba75c3f7958dfa22d59ef8bab2fe16690e5c1b58a2c4840`.

EN: No changed hashes were whitelisted; provenance/test code is unchanged.
The measured module and canonical files are byte-identical. Module SHA-256:
`5ed838337012f63ffe2ad93bb1e26333f345ef822bcc261b5738dac6792e80d2`.
Harness, fixture/oracle, crash helper and assertions equal the inherited head.
Frozen v1 SHA-256: `8cb6fc65977e761d6ba75c3f7958dfa22d59ef8bab2fe16690e5c1b58a2c4840`.

TR: `server.js` hash'i Main'in compute entegrasyonuyla değişti; Dashboard yükleyici
gövdesi `loadAntrepoFromDashboard` birebir aynı (SHA-256
`c5493d9bff3a30720216d4f5fb13798c7338f1b523b47fd6bc6289aa8220f633`).
Checkpoint callback, telemetry `lastBatch`, progress atama/yanıt alanı ve nihai
`orderStates` tüketimi ayrı ayrı okundu. `app-main.js` diff'i Backlog chart query
hazırlığı/pending-row koordinasyonu; #892 karar-revizyon bölümü ve diğer üç #892
modülü değişmedi. Tam dosya hash değişiklikleri kaydedildi, eski raporlara taşınmadı.

EN: The server hash changed with Main's compute integration; the entire Dashboard
loader block is byte-identical (hash above). Reviewed checkpoint forwarding,
telemetry `lastBatch`, progress assignment/response and final `orderStates`
consumption individually. The app-main diff concerns Backlog chart preparation
and pending-row coordination; the #892 revision block and other three #892
modules are unchanged. Recorded full-file hash changes without relabelling old reports.

| Ankor / anchor | Önce / before | Güncel / current |
|---|---:|---:|
| `loadAntrepoFromDashboard` | 7226 | 7284 |
| telemetry `event.lastBatch` | 7251 | 7309 |
| `checkpointStore.save(valueToSave)` callback | 7261 | 7319 |
| final `orderStates[identity] === 'SUCCESS'` | 7276 | 7334 |
| `current.dashboard = progress` | 9227 | 9263 |
| `dashboard: job.dashboard` | 9162 | 9198 |

[Tam eski/yeni hash'ler ve uyum denetimi / full hashes and audit](int-06-post-885-artifacts/source-audit.json).

## Yenilenen doğrulama / renewed validation

```bash
cd resources/app
BUYER_LOG_DATA_ROOT=/tmp/int06-post885-data \
BUYER_LOG_LOCAL_DATA_ROOT=/tmp/int06-post885-local \
BUYER_LOG_SERVER_DATA_ROOT=/tmp/int06-post885-server \
npm test -- powerbi-checkpoint power-bi-import-dashboard powerbi-dashboard
npm run i18n:check
npm run release:notes:validate
```

TR: **4 dosya / 100 test PASS; fail/skip/cancel 0.** Hazırlığın 17 testi dahil:
normal 3 ve split 7 committed batch sınırının her birinde SIGKILL + yalnız diskten
resume, aynı refresh'te art arda crash, SUCCESS/NOT_FOUND/FAILED, split retry,
iptal, çok satırlı sipariş, sıra/null/Unicode ve frozen-v1 devamı. Bağımsız oracle
ve dönen/diskten yüklenen çıktı eşdeğerliği korunur. i18n **0 yeni / 0 baseline**;
mevcut **38 release note PASS**. Üretim ve UI değişikliği yok; yeni release note
ve PNG gerekmedi. Mevcut notlar ve boş i18n baseline aynen korundu.

EN: **4 files / 100 tests passed; zero failures/skips/cancellations**, including
17 preparation tests: every small-fixture committed boundary, repeated crashes,
terminal states, split retry, cancellation, multi-row orders, order/null/Unicode
and frozen-v1 resume. Independent oracle and returned/reloaded output parity
remain intact. i18n **0 new / 0 baseline**; **38 existing release notes pass**.
No production/UI change or new release note/PNG. Existing notes and empty baseline
are preserved. [Logs and manifest](int-06-post-885-artifacts/manifest.json).

## Tarihsel ölçümler / historical measurements

TR: **Yeni benchmark veya A/A kampanyası başlatılmadı.** Ölçülen yol/harness
değişmedi. Hazırlık testleri yalnız mevcut 12 siparişlik CLI regression'larını
çalıştırır; bunlar yeni performans serisi değildir. Tarihsel 14 seçili ölçümün
fixture/çıktı oracle SHA'ları ve kendi revision'ındaki kaynak hash'leri yeniden
doğrulandı. İki tarihsel final cohort'un mevcut medyanları yalnız kayıtlı JSON'dan
kontrol edildi; ölçüm için yeni refresh/sorgu çalıştırılmadı. Her iki eski artifact dizini ve
manifestindeki tüm dosya hash'leri aynen korundu; başarısız kanıtlar silinmedi.

EN: **No new benchmark or A/A campaign.** The measured path/harness is unchanged.
Preparation tests run only their existing 12-order CLI regressions. Revalidated
fixture/output oracle hashes and source hashes at the original revisions for 14
selected historical samples. Checked the two existing final-cohort summaries from
stored JSON only. No new measurement refresh/query. Both historical artifact trees
and all manifest file hashes, including failure evidence, are unchanged.

| Tarihsel seri / historical series | Kaynak SHA / source SHA | Durum / status |
|---|---|---|
| 30k/100k steady, birer örnek / one each | `1d8e8d39257b66443fad8e80739261b4f0a82227` | İlk hazırlık / initial preparation |
| 3k steady ve split/retry, before 3'er / three each | `5a1656e98deeb573f6245f4b24a8135cc77a0d7b` | Aynı kod kontrolü / unchanged-code control |
| 3k steady ve split/retry, after 3'er / three each | `aef416e5db3560990116da9661d7ef8b7eeb9a33` | Aynı kod kontrolü / unchanged-code control |

TR: İlk serinin harness SHA'sı `948b6a366e520956a0f29d558c938f0ee4d689bb11d702c2f88678caa9c2e577`;
son kontrol serisinin `ede593d1ea89843b09b177a381923fb284d51340fd4157a08ee22b2000713a43`.
Eski sonuçlar güncel Main ölçümü sayılmaz; birleştirilmez ve yeni kaynak SHA'sıyla
etiketlenmez. Toplam connector refresh CPU/süresi checkpoint'e atfedilmez;
store-save ayrı, sayaç/kopya/satır normalizasyonu toplam kapsamındadır.

EN: Initial and final-control harness hashes are listed above. Historical results
are not current-Main measurements and are neither pooled nor relabelled. Total
connector refresh CPU/wall cannot be attributed to checkpointing; store-save is
separate, while counting/copying/normalization remain in the total.

| Tarihsel koşu / historical run | Toplam CPU / wall (s) | Store CPU / wall (s) |
|---|---:|---:|
| 30k steady, `1d8e8d39`, tek / single | 146.816 / 146.624 | 3.658 / 3.654 |
| 100k steady, `1d8e8d39`, tek / single | 621.357 / 620.658 | 47.834 / 47.762 |
| 3k steady before, `5a1656e9`, medyan / median | 14.637 / 14.535 | 0.046 / 0.046 |
| 3k steady after, `aef416e5`, medyan / median | 15.603 / 15.495 | 0.044 / 0.044 |
| 3k split before, `5a1656e9`, medyan / median | 25.846 / 27.385 | 3.347 / 3.330 |
| 3k split after, `aef416e5`, medyan / median | 26.931 / 28.485 | 3.524 / 3.506 |

TR: Bayt/RSS/aralık ve ham JSON/log'lar [ilk hazırlıkta](int-06-preparation.md)
ve [tarihsel #892 uyum raporunda](int-06-source-alignment.md); kazanım kabulü yok.
EN: Bytes/RSS/ranges and raw evidence remain in the linked historical reports;
there is no accepted speedup.

## Açık kapılar ve inceleme deltası / open gates and review delta

TR: **INT-06 kapanmadı.** Faz 7'de artımlı sayaç, batch journal ve periyodik atomik
snapshot; partial-tail/duplicate replay, snapshot write/rename ve compaction
kesintileri; eski checkpoint okuma ve yeni formattan güvenli geri dönüş;
tam final manifest/orderStates eşdeğerliği hâlâ açık. Güncel iki kol aynı #892
kodunu içerecek şekilde 30k/100k × steady/split-retry için gerçek en az 3+3
önce/sonra ölçümü ve medyan/aralık gerekir. Mevcut testler başarılı kayıt
sınırlarını keser; journal/compaction crash güvenliğini kanıtlamaz.

EN: **INT-06 stays open.** Phase 7 still requires incremental counters, journal,
periodic atomic snapshots; partial-tail/duplicate replay, snapshot write/rename
and compaction interruptions; old-checkpoint reading and safe new-format rollback;
complete final manifest/orderStates parity. Genuine fresh 3+3 before/after runs
for 30k/100k × steady/split-retry must use identical current #892 code in both arms.
Existing tests interrupt successful save boundaries, not journal/compaction internals.

TR: Önceki bağımsız hazırlık incelemesi yeni tool/provenance/lock/test deltasını
[`3766f49e..aef416e5`](https://github.com/clbiez/Buyer-Log-Desktop/compare/3766f49e59180b1a4443bd40a7e3998d3d2e562a...aef416e5db3560990116da9661d7ef8b7eeb9a33)
kapsamaz. Bu turdaki `be2f0636..d58d85f2` yalnız Main normal merge'i; sonraki
özgün delta yalnız bu rapor/bağlantılar ve doğrulama kayıtlarıdır. Yeni bağımsız
tur yapılmadı. Kullanıcı üzerinden en fazla bir Claude statik inceleme paketi
bu rapor + önceki delta + yeni source-audit/log/manifesttir; önceki inceleme
günlüğü değişmedi. İncelemeye hazır olmak merge veya ürün uygulaması kabulü değildir.

EN: The earlier independent preparation review does not cover the linked
tool/provenance/lock/test delta. This turn's `be2f0636..d58d85f2` only merges Main;
original follow-up edits are this report/links and validation evidence. No new
independent round. At most one user-mediated Claude static review can cover this
report, previous delta and new audit/log/manifest. Earlier review evidence is
unchanged. Review readiness does not approve merge or production implementation.

TR: **Faz 6 / son program PR'ında** sabitlenmiş baz + uygulama SHA'sında
`resources/app` içinden filtresiz `npm test` zorunlu; bu tur çalıştırılmadı.
Hedefli testler/fast checks tam regresyonun yerine geçmez. Sonucu etkileyen kod
değişirse kontroller yenilenir. Son head'in gerçek GitHub sonucu PR gövdesinde
tutulur; #890 yalnız yeşilken incelemeye hazır yapılır.

EN: **Phase 6 / final program PR** still requires unfiltered `npm test` from
`resources/app` on pinned base + implementation SHAs; not run here. Targeted tests
and fast checks do not replace full regression. Repeat affected checks after code
changes. The PR body records actual final-head CI; mark #890 ready only when green.

TR/EN: **Merge yok / no merge. TEST yayımlanmadı / not published. STABLE yayımlanmadı / not published.**
