# Fiyatlama / Ön Maliyet istemci hesap maliyeti — 2026-11-07

CPR-05, CPR-06, CPR-07 ve CPR-12 **ölçülerek, dar kapsamda uygulandı**. Tamamen atlanan madde yok. Sayısal iş kuralları, kayıt/yetki yolları, maliyet motoru ve matrisin mevcut klavye/DOM düzeni değiştirilmedi.

Temel: `2083ffd73ba026067d92ccf257c4551afa2e5f00` (main üzerine rebase edildi; altı hedef dosyanın ilk ölçümdeki baytları bu temelle aynı). Linux, Node 24.19.0, Chromium 154.0.8037.57, AMD EPYC 9V74; CPU kotası 4, bellek sınırı 16 GiB. Windows/Electron ölçümü değildir.

## Sonuçlar

Her satır A/B, B/A, A/B sırasıyla **en az üç koşunun medyanıdır**. Küçük costing probunda her koşu aynı beş ardışık girişin ortalamasıdır. Başlangıç ölçümü uygulamadan önce alındı; finalist problar gerçek üretim fonksiyonlarını/motorlarını çalıştırır.

| Madde / ölçülen işlem | Hacim | Önce | Sonra | Azalma |
| --- | --- | ---: | ---: | ---: |
| CPR-05 sahip eşleme + etkin kategori okuma — temiz tekrar | 30.000 koleksiyon satırı, 2 buyer, 10.000 teklif satırı | 61.348 ms | 134 ms | %99,8 |
| CPR-06 ilk matris hesap hazırlığı | 1.000 model × 20 üretici | 898 ms | 722 ms | %19,6 |
| CPR-06 tek fiyat değişiminin hesap kısmı | aynı 20.000 teklif satırı | 548 ms | 284 ms | %48,1 |
| CPR-07 gerçek uygulamada `d → di → dis` araması | 200 talep, 30.000 teklif satırı | 4.472 ms | 356 ms | %92,0 |
| CPR-12 giriş başına güncelleme | 100 maliyet satırı | 2,90 ms | 0,48 ms | %83,4 |
| CPR-12 giriş başına güncelleme | 1.000 maliyet satırı | 15,22 ms | 1,48 ms | %90,3 |

Tablodaki bütün sayılar yalnız belirtilen istemci fonksiyonlarının/motor işlemlerinin süresidir. Ağ, sunucu veya tüm uygulamanın açılış hızlanması olarak yorumlanamaz. CPR-06 tablodaki sonuçları ayrı, ısınma sonrası motor koşusundandır. CPR-07 ve CPR-12'nin geçerli son ölçümleri bu takip tesliminde tekrarlanmadı.

### CPR-05 — çakışmasız tekrar, 2026-11-07

Aynı 30k fixture baytları, aynı `rows.json`, aynı dondurulmuş prob ve aynı üretim kaynak SHA-256 değerleriyle A/B–B/A–A/B sırası yeniden çalıştırıldı. Sonuçlar [`cpr05-isolated-rerun.json`](../performance-program/evidence/pricing-client-cost-20261107/cpr05-isolated-rerun.json) içinde komut, başlangıç/bitiş UTC zamanı, ortam, kaynak hash'leri ve süreç izolasyon kaydıyla tutulur. Çalıştırılan sarmalayıcı [`cpr05-isolated-rerun-runner.cjs`](../performance-program/evidence/pricing-client-cost-20261107/cpr05-isolated-rerun-runner.cjs) olarak donduruldu; üretim probu değiştirilmedi.

| Çift | Sıra | A / önce (ms) | B / sonra (ms) |
| --- | --- | ---: | ---: |
| 1 | A/B | 65.226,120 | 146,280 |
| 2 | B/A | 60.794,077 | 134,471 |
| 3 | A/B | 61.348,452 | 124,173 |

Altı çıktının SHA-256 değeri aynı: `6af1ab72471d55b855e5f1e88f4075aa80121f820c479c8d5f3cd0539f8e8f68`. İstemci işlemi medyanı 61.348,452 → 134,471 ms (%99,781 azalma). Aynı anda başka benchmark çalıştırılmadı; sınır ve saniyelik süreç kontrollerindeki 198 gözlemde beklenmeyen aktif Node/Chromium süreci yok. Zombi süreçler çalışan yük sayılmadı.

İlk iki çifti tarayıcı denemesiyle örtüşen **eski** 66.717 → 176 ms turu, [`collection-results.json`](../performance-program/evidence/pricing-client-cost-20261107/collection-results.json) dosyasında baytları değişmeden korundu. Bu tur yeni ana medyana karıştırılmaz. Önceki kayıt SHA-256 değeri yeni tekrar manifestinde doğrulanır. Diğer maddelerin ham kanıtları ve medyanları aynen korunur.


## Değişiklik ve doğruluk sınırları

- **CPR-05:** Tek senkron okuma/çizim içinde owner bazlı rowId/orderCode indeksleri ve ortak etkin değer okuyucusu. İlk eşleşme, legacy orderCode ve multi buyer kaynak kimliği korunur. İndeks işlem sonunda `finally` ile bırakılır; sonraki owner/revision/yerel yapı değişikliği yeni indeksle okunur. Quotation verisinin ve collection verisinin bağımsız invalidasyonu için kalıcı revizyon cache'i eklenmedi.
- **CPR-06:** Üretici karnesi genel analizdeki kullanılmayan grup/hücre/gözlem çıktılarını üretmez; fiyat bir kez okunur. Tek model yenilenirken bütün talebin matrisi yerine o modelin satırları gruplanır. Tied wins, dropped/duplicate hücreler ve normalize edilmiş model/üretici anahtarları genel analizle eşdeğerdir (40 seed'li parity senaryosu). Üretici özeti hâlâ talep büyüklüğüyle doğrusal çalışır; sabit maliyetli artımlı cache veya DOM pencereleme iddiası yoktur. İlk çizim için ölçülen değer **motor hazırlığıdır**, 1.000 × 20 DOM çiziminin tamamı değildir.
- **CPR-07:** Arama yalnız nav'ı çizer. Status istatistikleri bir nav çizimi boyunca paylaşılır; `active/all` filtreleri gereksiz item hesabı yapmaz. Detayda üç arama olayı başına child-list mutation 6 → 0; aynı fiyat input'u ve değeri bütün son koşularda korunur. Arama gecikmesi/debounce veya kalıcı haystack cache'i eklenmedi.
- **CPR-12:** Satır input/focusout yalnız değişen satır tutarını ve ilgili bölüm tüketim toplamını yazar; toplamlar değişmeyen saf motorla yeniden hesaplanır. Satırlar, alternatif döviz ve FX rozeti işlem başına aynı snapshot'ı kullanır. Global currency/month/rate değişimleri tam yenilemeye devam eder. 100/1.000 satırda `querySelectorAll` çağrıları 134/1.034 → 27; snapshot çözümü 101/1.001 → 1. DOM ref cache'i ve artımlı kayan nokta toplama eklenmedi.

## Aynı girdiye çıktı SHA-256 eşitliği

Bütün A/B koşuları aynı SHA'yı üretir. Kaynak dosyaların önce/sonra SHA'ları ayrıca `environment.json` içindedir.

| Çıktı | Önce = sonra SHA-256 |
| --- | --- |
| CPR-05 eşleşen satır kimliği + etkin kategori | `6af1ab72471d55b855e5f1e88f4075aa80121f820c479c8d5f3cd0539f8e8f68` |
| CPR-06 ilk matris: best/approved/outlier, karne, adaylar, gain/negotiation | `2e487d8d806bcea8f15673cbd6e4b03cf59f1147380143b4885bc11d608c53b8` |
| CPR-06 fiyat değişimi sonrası aynı çıktılar | `6cf5c9f3c3e2a293dea9594da80920d4710cbd9d1f38bea6b89b3b549ffb660a` |
| CPR-07 üç sorgunun request ID/status sayımları + detay fiyatları | `184400fd7e3815c6d45b2a5afa15d9ccf4ecf261f432028444c16a2f5feb21c5` |
| CPR-12 100 satır: bütün summary + tutar DOM'u | `73ac73458f466f16543bd3d15e9f0b6b857ea93857bd37c676510cbe5cbb1186` |
| CPR-12 1.000 satır: bütün summary + tutar DOM'u | `b68c3546a10f8fcb04e4f2b53a3a98a78c980c86aee3d6134a102989cf2bfcb3` |

## Tekrarlama

Ham koşular ve RED/GREEN özeti: [`../performance-program/evidence/pricing-client-cost-20261107/`](../performance-program/evidence/pricing-client-cost-20261107/). Dört dondurulmuş prob [`../performance-program/probes/`](../performance-program/probes/) altında `pricing-client-cost-*.cjs` adlarıyla yer alır. `BUYERLOG_PROBE_ROOT` ve `BUYERLOG_PROBE_APP` ile izole kök ve uygulama yolu değiştirilebilir.

Repo kökünden:

```bash
mkdir -p /tmp/buyerlog-startup-pricing/source /tmp/buyerlog-startup-pricing/baseline
tar -xzf docs/performance-program/fixtures/source-30000-seed7-20261105.tar.gz -C /tmp/buyerlog-startup-pricing/source
for file in pricing-desk.js pricing-desk-engine.js quotations.js pricing-workspace-engine.js open-costing.js open-costing-engine.js; do
  git show 2083ffd73ba026067d92ccf257c4551afa2e5f00:resources/app/public/$file > /tmp/buyerlog-startup-pricing/baseline/$file
done
node docs/performance-program/probes/pricing-client-cost-collection.cjs baseline
node docs/performance-program/probes/pricing-client-cost-collection.cjs after
node docs/performance-program/probes/pricing-client-cost-matrix.cjs
node docs/performance-program/probes/pricing-client-cost-cost.cjs baseline
node docs/performance-program/probes/pricing-client-cost-cost.cjs after
```

Collection ve costing çiftlerini A/B, B/A, A/B sırasıyla tekrarla. Matris probu bu sırayı ve bir ısınma çiftini kendisi uygular. Collection satırları fixture'ın ASAS sayfasının gerçek başlık satırından (range 2) türetilir; tam 30.000 satır, iki buyer için tekrarlanan 1–15.000 kaynak ID kullanılır. Matris/costing hacimleri ilgili maddelerin istediği sentetik boyutlardadır.

Gerçek uygulama probu için önce fixture'ı standart araçla yalnız bir kez hazırla; bu dosya değiştirilmedi:

```bash
cd resources/app
CHROMIUM_PATH=/usr/bin/chromium node scripts/benchmark-startup-orders.js --rows 30000 --fixture-root /tmp/buyerlog-startup-pricing-app --source-fixture /tmp/buyerlog-startup-pricing/source --module overview --skip-same-tab --out /tmp/buyerlog-startup-pricing/startup.json
cd ../..
node docs/performance-program/probes/pricing-client-cost-browser.cjs
```

Tarayıcı probu gerçek Buyer Log sunucusunu yalnız bu izole veri köküyle açar. API route fixture'ı 200 demo talebi sağlar; üretim HTML/CSS/JS aynen çalışır. 30.000 teklif satırı tarayıcının localStorage kotasını aştığı için demo turunda cache uyarısı oluşabilir; RAM'deki doğrulanan request state'i kullanılır. PNG alınırken normal UI kapatma düğmesiyle bildirim kapatılır. Son koşuda gerçek arama ekranını ve 100 satırlı demo maliyette düzenleme sonucunu kaydeder. Canlı iş verisi kullanılmaz.

## Test ve teslim

- Başlangıç RED: 6 regression testinden 5'i başarısız; her CPR maddesi için başarısız koruma var. Son GREEN: 7/7 (ek genel analiz parity senaryosu dahil).
- İlgili `npm test -- pricing quotation open-costing`: 43 dosya geçti.
- TR/EN iki yeni sürüm notu; mevcut `next.json` kayıtları korunur. İki post-change PNG 1440×1000 boyutunda incelendi.
- `release:notes:validate`: geçti (34 kayıt).
- Tam `npm test`: 1.240 dosyada 10 batch planlandı; 3. batch kapsam dışındaki `local-iam-migration-authority.test.js:18` nedeniyle durdu (`undefined` / `IAM_LOCAL_INVALID`). Değişmemiş `2083ffd7` checkout’unda aynı test aynı nedenle başarısız oldu. Kalan orijinal 4–10. batch’ler aynı runner parametreleriyle tamamlandı: toplam **8.641 geçti, 1 başarısız, 65 skipped**. Başarılı tam test sonucu iddia edilmiyor. v714, rebase edilen main düzeltmesiyle geçti. Makine okunabilir toplamlar `test-results.json` içindedir.
- Main üzerinde aynı hatanın bulunması tam regresyon şartını kaldırmaz. Ortak IAM düzeltmesi bu dala alındıktan sonra **aynı son SHA** için ilgili testler, filtresiz `npm test` bütün batch’leri, i18n, release-note validator ve PR kontrolleri yeniden çalıştırılacaktır. Bu kapı şu anda **BLOKE / henüz sağlanmadı**. Ayrı batch tanısı başarılı tam paket yerine geçmez.
- Komut, ortam, karşılaştırılan kaynak SHA’ları ve yeni ham hata loglarıyla [ana sunucu entegrasyonu teslimi](2026-11-07-iam-main-integration-handoff.md) hazırlandı. Test/üretim IAM kodu veya assertion değiştirilmedi.
- PR fast checks sonucu PR üzerinde izlenir; mevcut IAM başarısızlığı nedeniyle PR taslak olarak bırakılır. Bağımsız ikinci inceleme yapılmadı; GitHub review submission listesi boş.
- Merge, TEST veya STABLE yayını bu görevin parçası değildir.
