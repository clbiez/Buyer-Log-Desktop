# Faz 6a — gerçek ortak worker hazırlık maliyeti / native shared-worker preparation cost

[Doğrulandı / Verified] Kaynak `7f8adc97e1b26276cd849cdd34a6dada142779e9`, app tree `b6d4a17129c2e9ef6e4c67ce86f02a3b43319929`. Gerçek 30k seed7 snapshot, gerçek parser, paylaşılan üretim havuzu/admission varsayılanları; iki ek üretilmiş model alanı ASAS kaynağına projeksiyondan önce eklenir. A/B–B/A–A/B, her kol taze süreç. B tam çıktıya ek own şema ve ready JSON üretir. Bütün tam çıktılar, ordinal restorasyonu, tarih normalizasyonu ve hash eşdeğerlikleri geçti. Bu, UI/refresh/ilk CP kabulü değildir.

| Medyan | Full | Full + own schema + ready |
| --- | ---: | ---: |
| Worker pipeline ms | 5396.013 | 11164.817 |
| JSON bayt | 83579517 | 73148212 |
| Gzip bayt | 6251899 | 5676999 |

Eşli ek pipeline süresi medyanı **5272.366 ms**. İlk A diğer A'lardan belirgin yavaştır (12108/5396/5339 ms); silinmedi. İlave ready işi 5252/5125/5333 ms. Kaynak yükleme, V8 kodlama, seed-source, projection-plan, sonradan eşdeğerlik kontrolü ve post-timing heap gözlemi ayrı kayıtlardadır. Seed kaynak gönderimi senkron `postMessage` 557–944 ms aldı; bu gerçek Excel worker sonuç alım süresi değildir. `roundTripMinusWorkerExecutionMs` IPC/planlama farkıdır, saf deserialize ölçümü sayılamaz.

**Karar:** Soğuk ilk görünümü ek ready üretimine bağlama. İnce hazır bayt yalnız güncel owner/access/generation/plan için hazırsa kullanılmalı; hazır değilse mevcut full veri güvenle döner. Varsayılan ürün yolu hâlâ full; HTTP ve istemci entegrasyonu tamamlanmadı. Bu ölçüm bütün uygulamada hızlanma iddiası değildir.

V1'in ilk çocuğu 0 ile sonuç yazmadan çıkmıştır. Ayrı gerçek havuz health probunda idle/unref worker üzerinde `getHeapStatistics` await'i iki kez süreci sonuçtan önce bitirmiş; yalnız o post-timing gözlemde ref/unref kullanımı tamamlanmıştır. V2 sadece ölçüm aracındaki bu liveness hatasını düzeltir. Üretim timeout/bütçe/validator değişmedi. V1 başarısız kanıtları korunur; yetim 148 MB özel replica özgün geçici dizinde korunur. Başarılı V2 her kol havuz/worker/lease kapanışını doğruladı.

Son aynı kaynak tam regresyon: tek varsayılan `npm test`, bütün 10 batch, **9261 PASS / 0 FAIL / 65 mevcut SKIP / 0 CANCEL**; i18n 0/0, 50 release note geçerli. Bunlar foundation testleridir; final thin uygulama, ilk CP 3 çift, gerçek browser payload/parse/heap, Phase0 refresh, CI ve bağımsız inceleme açık.

EN: This serial native-worker experiment preserves all six observations, source topology, production admission and exact output equality. Ready bytes save payload but add about 5.3 seconds of producer CPU; they must not block a cold first view. Full fallback stays required. Source setup, sender postMessage time and post-timing validation are separate from the measured pipeline; none is an actual Excel-result receive or end-user latency measurement. The first failed harness is retained, and V2 fixes only post-timing worker-statistics liveness. Default public thin remains disabled; no phase completion, merge or publication is claimed.
