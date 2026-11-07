# ADMIN-03 — 2026-11-07 sonuç / result

**[Doğrulandı] DUR:** Mevcut üretim modüllerindeki bekleyen-istek kapısı, `USER.GRANT` iptali sonrası eski seçilmiş profille `next()` çağırıyor. Yerel ve merkezi senaryoların ikisi de RED. Üretim optimizasyonu, indeks/cache uygulaması veya entegrasyon yapılmadı. Bu paket yalnız tanı ve test hazırlığıdır; merge'e hazır değildir.

**EN: STOP.** Both local and central pending-request authorization tests fail. A revoked grant survives in the previously selected request profile. Production implementation and acceptance are blocked. No optimization, cache or integration was implemented.

## Güvenlik kanıtı / security evidence

`pending-request.test.cjs` gerçek login, HMAC cookie, `requireSelection`, `saveStore` veya merkezi `commit` ve `requireCapability` işlevlerini kullanır. Yalnız sentetik profiller/credential vardır. Seçimden sonra kontrollü bir Promise ile istek bekletilir; izin kalıcı dizinden kaldırılır; sonra kapı devam ettirilir. Güncel DTO'da izin yoktur ve aynı cookie ile yeni seçilmiş istek 403 alır. Eski istekte kapı `next()` çağırır. Testteki 200 değeri bu devamın sentinel'idir; gerçek HTTP route veya mutasyon çalıştırılmadı. Canlı endpoint istismarı kanıtlandığı iddia edilmez.

| Senaryo / scenario | Revizyon | Yeni istek / fresh gate | Bekleyen / resumed gate | Kabul |
| --- | --- | --- | --- | --- |
| Yerel / local | 7 → 8 | 403, denied | `next()`, allowed | RED |
| Merkezi / central | 1 → 2 | 403, denied | `next()`, allowed | RED |

Kaynak: `user-access.js:1319–1333` profil kopyası; `1499–1525` `req.currentUser` önceliği. Kanıtlar: `artifacts/pending-local.json`, `pending-central.json`, `pending-request-red.log.gz`. Test dosyası mevcut runner'ın yalnız `.test.js` toplama kuralını değiştirmeden ayrı `.test.cjs` kabul kapısıdır; komutu `acceptance.json.securityGate` içindedir. Çalıştırılmış ve başarısızdır; skip/todo/xfail olarak yeşile çevrilmedi. Hedefli paket veya GitHub fast checks bu kapının yerine geçmez.

EN: Real auth middleware and real local/central persistence were exercised around an explicit await. Fresh requests deny the revoked capability; the resumed request continues using its old selected profile. This proves the middleware acceptance failure, not an exploit of a particular deployed HTTP route. The explicit standalone security test is mandatory, has run and remains RED; no existing test, assertion or validator was weakened.

## Ölçüm / measurement

Node 24.19.0, Linux x64, dört CPU kotası, 16 GiB bellek kotası. Aynı `#892` içeren baz `5a1656e9`, aynı iki üretim dosyası SHA'sı, aynı harness/fixture SHA'ları; üç taze süreç/kolda AB/BA/AB. Zaman aralıklarının çakışmadığı validator ile doğrulandı. Bütün dört senaryoda tüm kolların public DTO/admin response hash'leri birebir aynı. **A/A hazırlık kıyasıdır; optimize edilmiş önce/sonra veya hızlanma iddiası değildir.** Faz 7 resmî optimize kıyas pending.

Üç koşunun p50/p95 medyanı, ms (kullanıcı sayısına moderatör ilave):

| Kullanıcı / fanout / derinlik | publicProfile baz p50/p95 | publicProfile hazırlık p50/p95 | Admin baz p50/p95 | Admin hazırlık p50/p95 |
| --- | ---: | ---: | ---: | ---: |
| 30 / 3 / 4 | 4.05 / 4.91 | 3.77 / 4.48 | 4.92 / 6.18 | 5.01 / 6.74 |
| 100 / 4 / 5 | 27.44 / 30.33 | 28.65 / 31.64 | 32.48 / 36.41 | 33.27 / 39.06 |
| 300 / 6 / 5 | 217.76 / 235.98 | 217.53 / 244.00 | 256.13 / 275.04 | 254.07 / 270.32 |
| 100 / 1 / 100 | 27.88 / 31.33 | 27.33 / 29.68 | 45.17 / 51.77 | 44.57 / 50.79 |

Kaynak ve metod: `summary.json`, `before/after-{1,2,3}.json`, README. Ölçülen admin gerçek `adminListHandler`; JSON serialization/network hariç. Üretim UI, Windows/Electron, SMB veya genel refresh sonucu değildir. Refresh POST/retry yok; worker yok. Hiç örnek atılmadı.

Node CPU izi **önce** alındı. 100 kullanıcıda tek publicProfile: 6 IAM haritası, 3 legacy haritası, 5 effective-permission türetimi, 500 assigned-permission hesabı. Gerçek admin listesi: 208 IAM haritası ve 11.397 assigned hesabı. Sayaçlar yalnız ayrı instrument geçişine aittir, ölçülen zamanlar instrument edilmemiş kaynaktan gelir. 1.411 ms CPU örnek penceresinde `effectiveDataScope` altında yaklaşık 962 ms, `effectivePermissionDetails` altında 236 ms görünür. Inclusive süreler iç içedir ve toplanmaz; saf map kurma maliyeti ayrıştırılmış sayılmaz. Tekrar haritalar kanıtlıdır ama bu fixture'da büyüyen TEAM scope dizilerinin tekrar locale-normalize/unique edilmesi daha büyük adaydır. **Yalnız WeakMap indekslemesi yeterli kabul edilemez.**

EN: The unmodified Node CPU profile and separate call counters prove repeated derivations. In this TEAM fixture, repeatedly normalizing/deduplicating growing scope arrays is also material. Index reuse alone is not an established solution. Raw traces and all six runs are retained; the A/A cohort measures preparation reproducibility only.

## Doğrulama ve başarısız kanıtlar / validation and retained failures

- Yeni yedi hazırlık testi ve mevcut ilgili on dosya: **11 dosya / 77 PASS**, fail/skip/cancel 0. Tam public DTO ve gerçek admin yanıtı dondurulmuş #892 fixture'ıyla sıra dahil karşılaştırılır. Grant başlangıç/bitişi hem direct hem temporary için aynı store nesnesinde; aynı revision'da iptal; rol nesnesi değişimi; manager/team mirası ve reparent; security/shared-settings miras dışılığı; iki parent önceliği; döngü; collection fail-closed; gerçek merkezi commit geçişi kapsanır.
- Ayrı zorunlu bekleyen istek kapısı: **0 PASS / 2 FAIL**, yerel ve merkezi. Kabul **RED**. Ürün değişikliği olmadığı için GREEN uygulaması yapılmadı.
- `npm run i18n:check`: yeni 0 / baseline 0. Baseline değiştirilmedi. `npm run release:notes:validate`: mevcut 32 kayıt PASS. Görünür ürün değişikliği ve yeni sürüm kaydı/PNG yok.
- İlk yeni central test ham, migrate edilmemiş ve verifier'sız fixture verdi: `IAM_WRITE_FAILED`. Fixture kurulumu merkezi sözleşmeye uygun hale getirildi; assertion ve üretim kodu değiştirilmedi. İlk log `preparation-test-initial.log.gz`, düzeltilmiş kurulum `preparation-test.log.gz` içinde.
- İlk paket wrapper'ı AUTH kökünü sabitlerken eski `iam-v672` kendi SERVER/app/local kökünü değiştiriyordu: **75 PASS / 2 FAIL**, `targeted-test.log.gz` saklandı. Wrapper'dan AUTH override kaldırıldı; böylece eski testin AUTH→SERVER varsayılanı korundu. Aynı sabit bazda `iam-v672` **5 PASS** (`baseline-iam-v672.log.gz`), sonra aynı 11 dosyalı paket **77 PASS** (`targeted-correct-roots.log.gz`). Test dosyaları/validator gevşetilmedi. Tüm kökler yine `/tmp` altında sentetik.
- Filtresiz tam `npm test` bu hazırlıkta çalıştırılmadı. Faz 6 / son program PR'ı için zorunlu ve pending; sonuç etkileyen kod değişirse ilgili kontroller ve gereken tam suite yenilenecek. 77 PASS, kırmızı güvenlik kapısını kapatmaz ve tam regresyonun yerine geçmez.

EN: Targeted regression: 77 pass, zero failure/skip/cancel. Mandatory resumed-request gate: two failures. i18n: 0/0; existing visual-note validator: 32 pass. Initial invalid-fixture and mixed-root harness failures are retained, corrected without changing assertions or production. Full unfiltered regression remains required at Phase 6/final program closure and has not run here.

## Ana sohbet / main-chat decision

Önce stale `req.currentUser` ile bekleyen istek yetkilendirmesi için sorumluluk ve entegrasyon kararı gerekir. Yetki yeniden kontrolü güncel store'daki güncel kullanıcıyı bulmalı; iptal/pasiflik/silinme/rol/merkezi değişimi ve grant zaman sınırını yeniden değerlendirmeli. Burada düzeltme yapılmadı. Faz 7'de bu RED testler üretim düzeltmesinin RED→GREEN kapısı olarak korunmalı; ardından aynı fixture ile üç yeni gerçek baz/aday koşusu alınmalı.

İndeks/istek bağlamı tasarımı yalnız öneridir: store nesnesi kimliğine bağlı iki ayrı hiyerarşi indeksi; DTO içindeki permission/scopes türetimini paylaşma; admin aktörünü profil başına tekrar hesaplamama; TEAM unique işlemini sıra koruyan tek geçişe indirmenin eşdeğerliğini sınama. Uzun ömürlü revision-only permission cache yok. `server.js`, `app-main.js`, ortak compute ve Claude'un #894 dosyasına dokunulmadı. `coordination.json` kilit kontrolünü kaydeder. Bağımsız Claude incelemesi kullanıcı üzerinden en fazla tek tur için README'de hazır; henüz yapılmadı.

**Merge: dur. TEST: yayınlanmadı. STABLE: yayınlanmadı.** / Stop before merge. No TEST or STABLE publication.
