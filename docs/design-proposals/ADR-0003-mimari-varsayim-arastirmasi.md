# ADR-0003 · Mimari varsayım araştırması: neyi hızlandırmalı, neyi ortadan kaldırmalı

- **Durum:** Araştırma ve öneri. Uygulama kodu, test, CLAUDE.md veya AGENTS.md değiştirilmedi.
- **Tarih:** 2026-11-26 · **Kaynak:** `main` @ `d772bab`
- **Kapsam dışı:** Koleksiyon ortak yazım düzeltmesi (ADR-0001 Aşama 0, `server/lib/collection-replication.js`, sync dosyaları). Burada yalnız referans olarak geçer.
- **Kanıt kaynakları:** güncel source, `git log` (son 400 first-parent commit), bu oturumda koşulan statik sayımlar ve iki küçük davranış deneyi (scratchpad'de, commit edilmedi), paralel oturumun ölçüm raporu `docs/performance/BASELINE_2026-11.md` (dal `claude/perf-baseline-2026-11`, Linux container + Chromium, **Electron/Windows değil**).
- **Kanıt etiketleri:** **[Doğrulandı]** source, test, ölçüm veya bu oturumda koşulan deney · **[Muhtemel]** güçlü dolaylı kanıt · **[Hipotez]** sınanmadı · **[Bilinmiyor]** veri yetersiz.
- **Öncelik sırası (sözlük sırası, ağırlıklı puan yok):** veri bütünlüğü > doğruluk > kararlılık > performans > mimari sadelik > kullanıcı deneyimi. Alt seviyedeki kazanç üst seviyedeki kaybı telafi edemez.

---

## 0 · Özet

1. Buyer Log'un yavaşlığının ve tekrarının büyük kısmı tek bir kökten geliyor: **türetilmiş veri, tek bir yerde ve bir kez üretilmiyor.** Aynı türetme istemcide yapılıyor, sunucuda aynası tutuluyor (17 parite testi var), her satır kaydında tüm modül projeksiyonu yeniden yazılıyor ve aynı "satır değişti" bilgisi üç ayrı mekanizmayla taşınıyor.
2. İş kuralı çekirdeği (fiyat, transit, öncelik, lisansör) **zaten tek kaynakta** (`public/business-rules.js`, 67 dışa aktarım, 57 tüketici dosyası; `app-main.js`, `parse.js` ve `server.js` yalnız delege ediyor) **[Doğrulandı]**. Tekrar çekirdekte değil; **ilkellerde** (sayı zorlama, kaçış, normalize) ve **mekanizmalarda** (filtre, sorgu yolu, türetme zinciri, projeksiyon güncelleme).
3. Ölçülen davranış farkı var: 40 sayı zorlama tanımı en az 6 farklı anlam taşıyor (`null`→0 ya da `null`; `"1,5"`→`null` ya da 1,5; `"1.234,56"`→1,234) **[Doğrulandı: deney]**. Sütun filtresinin anlamı da modüle göre değişiyor **[Doğrulandı: source]**.
4. **Öncelikte birinci varsayım (V10, kapsam eki):** birden fazla cihazın aynı yayım dosyasına yazması gerekli değil. Tek yazarlı değişmez kayıtlar kira, `-PC` kopyası, CAS ve tüm-belge yayım maliyetini ihtiyaç olarak kaldırır. Karşılığında yetki/saat sınırı, tombstone ufku ve geçiş köprüsü getirir; yolu ADR-0001'dir.
5. **V1 bağımsız ölçümü (§6A):** kayıt başına ≈6,7 CPU-sn'nin %97'si işçilerde. Bunun %99,4'ü bütün dosya temsilinden (serileştirme, zlib, parse, kopya, GC) geliyor; iş kuralı hesabı yalnız %0,6. Prototipte taban + günlük kaydı 6.533 ms'den 11 ms'ye indiriyor, çıktı eşit. Ayrıca Siparişler'in 17 sn'lik soğuk açılışının ~15 sn'si **kaçırılan bir olay + 15 sn zaman aşımı**; tek satırlık prototip düzeltmesi bunu 2,15 sn'ye indiriyor (1 koşu).
6. **Önerilen ilk pilot:** CP satır kaydında **projeksiyon yeniden yazımına duyulan ihtiyacı kaldırmak**. Projeksiyon "değişmez taban + kalıcı satır yama günlüğü" olarak temsil edilir; tam yeniden yazım yalnız boşta sıkıştırma (compaction) olur. Bu, uygulamanın `local-db.js` WAL'ında zaten kanıtlanmış desenin aynısı. Faz 0 davranışı değiştirmez, yalnız gölge eşitliği ölçer (§6).

---

## 1 · Buyer Log bugün neden bu mimariyle çalışıyor

| Kabul | Neden bugün böyle (kanıt) | Zorunlu mu? |
| --- | --- | --- |
| Yerel öncelikli; her kullanıcı makinesinde yerel Node/Express sunucusu; paylaşım ortak klasörle (OneDrive/SMB) | Ürünün dağıtım modeli; merkezi sunucu ADR-0001'de altyapı/yetki kararı gerektirdiği için reddedildi **[Doğrulandı: ADR-0001 §4]** | **Zorunlu** (ürün kararı). Bu belge bu kabulü korur. |
| Portable, bağımlılıksız kurulum; yerel DB tek JSON zarfı + WAL | `server/lib/local-db.js:3-9`: ".db soneki var ama bağımlılıksız JSON zarfı, portable Node kurulumu bağımlılıksız kalsın diye" **[Doğrulandı]**. Bağımlılıklar: `express`, `xlsx` (vendor), `resedit`, `msgreader` | **Zorunlu** (yerel ikili modül yok). Biçim (tek JSON) **tarihsel**. Electron 44'ün Node'unda `node:sqlite` durumu **[Bilinmiyor]** (ADR-0001 §1). |
| Sunucu Electron'un Node'unda, renderer Chromium | `electron/backend.js` **[Doğrulandı: ADR-0001]** | Zorunlu |
| Arayüz derleme adımı olmayan klasik script'ler; modüller `window.*` ile bağlanır | `public/index.html` 130 `<script>`, 0 `type="module"`; `package.json` içinde bundler yok **[Doğrulandı]** | **Tarihsel.** Chromium yerel ES modüllerini derleme adımı olmadan destekler ve sayfa Express'ten (http) sunulur **[Muhtemel]**. Bağımlılıksız ilke ES modül kullanımını engellemez. |
| CP/Siparişler satırı, kaynak (Excel/ASAS) başlığı anahtarlı serbest nesne (`row['Order Code']`); Koleksiyon satırı camelCase (`plmId`, `modelKod`) | Excel'den büyüme; kanonik katman sonradan eklendi (`canonical-fields.js`) | **Tarihsel.** |
| Türetilmiş alanlar istemcide açılışta yeniden üretilir; sunucu aynası tutulur | `server/lib/read-model/overview-row-prep.js:2-11`: "Projeksiyon bu alanları ham taşır; istemci açılışta yeniden türetir. Karar katmanı türetilmiş değerleri okuduğu için sunucu da aynısını yapmalıdır" **[Doğrulandı]** | **Tarihsel.** JSON `Date` taşıyamadığı için tarih zorlaması istemcide kalmış **[Muhtemel]**; gün ordinal'i (tamsayı) bu kısıtı kaldırır. |
| Satır kaydı sonrası modül projeksiyonları yeniden yazılır | `server/lib/page-projection-cache.js:377` `runRowRewriteBatch`; `cp-row-patch-log.js:6`: "sayfa önbelleği yeniden yazımı, 30k'da 6–10 sn" **[Doğrulandı: source yorumu]** | **Tarihsel.** Projeksiyon türetilmiş, yeniden üretilebilir bir önbellektir; tam dosya olarak tutulması zorunlu değil. |
| Ortak klasörde aynı yayım dosyasına birden fazla cihaz yazar (kira + CAS) | ADR-0001 §1; `collection-replication.js:24-36` | **Kaldırılabilir** (V10). Koleksiyonun genel delta yolundan çıkarılması o günkü genel yol için zorunlu, mimari olarak tarihsel. |

---

## 2 · Ölçülen envanter

Bu oturumda statik olarak ölçüldü **[Doğrulandı]**, aksi yazmadıkça. Komutlar Ek A'da.

| Gösterge | Değer |
| --- | --- |
| `public/app-main.js` | 46.235 satır; 2.575 fonksiyon bildirimi (2.479 üst düzey). Adında filter 105, group 73, render 120 geçen fonksiyon (büyük/küçük harf duyarsız) |
| `app-main.js` büyümesi | 36.860 (2026-10-09) → 39.403 (10-25) → 40.945 (11-10) → 46.235 (11-26): 48 günde +9.375 satır |
| `server/server.js` / `server/lib` | 13.615 satır / 277 girdi (332 `.js`, alt klasörler dahil) |
| `public/` | 283 JS dosyası, ~200 bin satır (vendor dahil) |
| Testler | 1.540 `*.test.js` (2026-10-09'da 897) |
| Üst düzey değiştirilebilir durum (`app-main.js`) | 270 satır `let`/`var` bildirimi; `state.*` 35 farklı anahtar, 90 atama noktası; 111 farklı `window.X =` adı (tüm `public/`'te 218) |
| Tam tablo yeniden çizim tetikleyicileri | `renderCP(` 81, `renderOrders*(` 75, `renderOverview*(` 53 çağrı noktası |
| Önbellek modülleri | Adında *cache* geçen 7 modül; `server/lib`'de `Map` + cache kullanan 62 dosya |
| Zamanlayıcı | `setInterval` 28 dosyada 50 çağrı |
| İşçiler | 4 tarayıcı işçisi + 3 sunucu işçisi; compute havuzu en fazla 2 işçi, okuma modeli işçisi 4 girdi / 768 MiB'lık veri kümesi LRU'su (`read-model-worker.js:20`) |
| i18n | 7.894 `L(`/`T(` çağrısı, 454 `isEn()?` üçlüsü; **189 yerel `L`/`T`/`isEn` tanımı** |

**Paralel oturumdan alınan ölçümler** (`BASELINE_2026-11.md`, 30k sentetik, 3 koşu medyanı, Linux container). Windows/Electron'u temsil etmez:

| Metrik | Medyan |
| --- | --- |
| İlk kullanılabilir ekran: Genel Bakış / Koleksiyon / CP / Siparişler (soğuk) | 1.512 / 1.178 / 4.389 / 17.085 ms |
| CP kayıt onayı p50 | 29 ms (p95 göstergesi 91) |
| CP kayıt akışı sırasında Siparişler okuması p50 | 1.851 ms |
| Son kayıttan projeksiyon yazımlarının bitişi | 3.534 ms |
| Süreç CPU'su (16 kayıt) | ≈ 5,9 CPU-sn/kayıt (okuma ve yazım ayrıştırılamadı) |
| Sunucu RSS: boşta → akış sonrası → tepe | 185 → 502 → 1.697 MB |
| `/api/page-projection/*` çözülmüş yük | orders 78,8 + cp 66,6 + overview 12,2 = 154 MB |

---

## 3 · Tekrar haritası

"Bağımsız uygulama" = kendi mantığını taşıyan tanım. Tek kaynağa delege eden sarmalayıcı sayılmadı.

| # | Mekanizma | Nerede (ölçülen) | Davranış farkı var mı? |
| --- | --- | --- | --- |
| T1 | **Sayı zorlama** (`num`, `toNum`, `toNumber`, `parseNumber`…) | 40 tanım / 36 dosya | **Var [Doğrulandı: deney, Ek B].** `app-main.js:548` `toNum(null)=0` ama `toNum(undefined)=null`; `app-main.js:24761` `''`→`null`, `:24732` `''`→0; `backlog-delivery-engine` her geçersizi 0 yapar; `postfob`/`tryd` yalnız `number` kabul eder; `fx-calculation-engine` `"1,5"`→1,5 ama `"1.234,56"`→**1,234**, `"12abc"`→12; `collection-price-drawer` `NaN` döner. Bu girdilerin üretimde gerçekten bu fonksiyonlara ulaşıp ulaşmadığı **[Bilinmiyor]**. |
| T2 | **HTML kaçışı** (`esc`, `escapeHtml`…) | 94 tanım / 92 dosya | Çoğu eşdeğer. **2 dosyada** global `escapeHtml` yoksa **kaçışsız** fallback: `plm-image-package-import.js:23`, `plm-operations.js:58` **[Doğrulandı: source]**. Çağrı anında global'in her zaman var olduğu **[Muhtemel]**; istismar edilebilirlik **[Hipotez, düşük]**. |
| T3 | Metin normalizasyonu (`norm`, `normKey`, `turkNorm`…) | 31 tanım / 28 dosya; `toLocale*Case('tr')` 121 dosyada | **[Bilinmiyor]**, ölçülmedi. |
| T4 | Klonlama / hash / parmak izi | 63 tanım / 58 dosya; 72 / 55 | Önemsiz olması **[Muhtemel]**; ölçülmedi. |
| T5 | **Sütun filtresi anlamı** | CP/Siparişler: `prepareColFilter` (aralık, sayısal kural, revizyon modu, değer listesi). Koleksiyon: `passesKolColFilters` (`app-main.js:30931`, yalnız küme eşitliği). Genel Bakış: `passesOvDimFilters` (`:13900`, `norm(row[col])` eşitliği). Sunucu: `read-model-query.js` | **Var [Doğrulandı: source].** Koleksiyonda sayısal/aralık/revizyon filtresi yok. Bunun bilinçli bir ürün kararı olup olmadığı **[Bilinmiyor]** → ürün sahibi. |
| T6 | Filtre durumu kalıcılığı | `save/load{Cp,Orders,Ov}DimFilters` (3 çift) + Koleksiyon ayrı + `core*FilterState` | Anahtar ve biçim farkı **[Muhtemel]**. |
| T7 | **Sorgu yolu ikiliği** | İstemci tam satır yolu (`filteredCP`, `filteredOrders`) ile sunucu okuma modeli (`/api/read-model/{cp,orders}/{query,facets}`), ikisi de varsayılan açık ve geri düşmeli | Fark **yasaklanmış**, çünkü sunucu türetilmiş sütunları bilmiyor ve istemci yola düşüyor: `CP_RM_CLIENT_DERIVED_KEYS` = Supp. FOB, Licensor, Ex→Retail, LT, PLM Numune, Fabric (PLM) + 4 sütun tipi (`app-main.js:11351`); Siparişler'de 5 anahtar (`:12252`). Eşitliği **17 parite testi** koruyor. |
| T8 | **Türetme zinciri** | İstemci `normalizeCPDates` → `applyCpApprovalDate` → `rebuildCpLogisticCaches` (`app-main.js:1893`, `:1902`, `:7554`) ile sunucu aynası `overview-row-prep.js` | Fark yok, parite testiyle kilitli **[Doğrulandı: test var; bu oturumda koşulmadı]**. Bedeli iki uygulama ve tarayıcıda açılışta 30k satırın yeniden türetilmesi. |
| T9 | **`computePriorityFlags` girdi derlemesi** (13 alan) | 4 bağımsız nokta: `app-main.js:1055`, `server/lib/parse.js:2127`, `read-model/cp-computed-task.js:192`, `cp-readiness-engine.js:322` | Kural tek kaynakta, **girdi eşlemesi dört yerde**. LT: istemci `daysBetween`, sunucu ordinal farkı; ikisi de ordinal tabanlı, yani eşdeğer **[Doğrulandı: source]**. `rules` istemcide global `state.overrides.transitRules`, sunucuda parametre. `today` her yerde `new Date()`. |
| T10 | Tarih zorlama (`coerceDateLoose`) | `app-main.js:1848` ile `read-model-query.js:115` | **Fark bulunmadı [Doğrulandı: deney, Ek B]**: 120.019 örnek × 3 saat dilimi. **Sınır:** istemci `window.XLSX.SSF` yüklüyse Excel seri tarihinde başka dala geçer; bu dal test edilemedi **[Bilinmiyor]**. |
| T11 | **"Satır değişti" bilgisinin taşınması** | (a) tam modül yeniden yazımı `runRowRewriteBatch`, (b) bellek içi CP yama günlüğü `cp-row-patch-log.js` (TTL 15 dk, süreç içi), (c) canlı satır yaması `liveRowPatchesFor` | Üçünün de "artımlı güvenli" kuralı aynı (`server.js:10445` `rowPatchIncrementalSafe`). **Tarih temizleme** (`null`/`''`) üçünde de tam yeniden yüklemeye düşüyor **[Doğrulandı: source]**. |
| T12 | i18n yardımcıları | 189 yerel `L`/`T`/`isEn` tanımı (ör. `app-main.js:39` `const L=(tr,en)=>appLang==='en'?en:tr`) | Fark **[Bilinmiyor]**, düşük risk. Bekçi testi kapsıyor. |
| T13 | Satır anahtar temsili | CP/Siparişler başlık anahtarlı (`app-main`'de yalnız çok kelimeli başlıkla ≥210 doğrudan erişim; `'Order Code'` 63 kez), Koleksiyon camelCase; köprü `BLCanonicalFields.canonicalValue` (28 çağrı) | İki temsil var. Kanonik katman köprü kuruyor ama temsili tekleştirmiyor. |

**Tek kaynakta olanlar [Doğrulandı]:** `roundHalfUp`, `normalizeTransitDelType`, `calculateSuppFobWithRule`, `resolveTransitDays`, `resolveExFactoryDate`, `computePriorityFlags`. `app-main.js`, `parse.js`, `server.js`, `resource-rule-service.js` ve `open-costing.js` bunlara yalnız delege ediyor. Para dışı yuvarlamada `Math.round(x*100)/100` 11 dosyada var; para hesabını etkileyen tek örnek `lfl.js:1736` medyanı **[Muhtemel]**.

---

## 4 · Ölçütler tablosu

| Ölçüt | Nasıl ölçüldü | Değer | Etiket |
| --- | --- | --- | --- |
| Aynı iş kuralının bağımsız uygulama noktası | Statik sayım (§3) | Öncelik girdisi 4; CP türetme zinciri 2; sütun filtresi anlamı 4; sayı zorlama 40 tanım, ≥6 anlam | Doğrulandı |
| Bir özellik değişikliğinde dokunulan dosya | `git log --first-parent -400`, 300+ dosyalık toplu commitler hariç (399 commit) | Tüm dosyalar medyan 9 (p90 29); runtime kodu medyan 2 (p90 10). `(P1)/(P2)` etiketli 47 özellik/düzeltme: runtime medyan **6**, p90 12 | Doğrulandı |
| Sıcak dosya yoğunlaşması | Aynı örneklem | `app-main.js` commitlerin **%44**'ünde (176/399), `index.html` %18, `server.js` %18; istemci ve sunucu JS'i aynı committe %26 (102) | Doğrulandı |
| Modüller arası bağımlılık | Script etiketi / global adı sayımı | 130 klasik script, 218 `window.X` adı; bağımlılık grafiği statik olarak çıkarılamıyor (yükleme sırası ve global'lerle örtük) | Doğrulandı (sayım); grafik Bilinmiyor |
| Paylaşılan değiştirilebilir global durum | §2 | 270 üst düzey `let`/`var` satırı; `state` 35 anahtar / 90 yazım noktası | Doğrulandı |
| Kullanıcı işleminin tetiklediği gereksiz hesaplama | BASELINE §4 + source | Tek satır kaydı → modül başına onlarca MB JSON çöz/karşılaştır/gzip/yaz; ≈5,9 CPU-sn/kayıt (ayrıştırılmamış); okuma, yazımın bitmesini bekliyor (p50 1,85 sn) | Boyutlar ve süreler Doğrulandı; tam payı Muhtemel |
| Bellekteki gereksiz kopyalar | Source okuma | Aynı satırların ≥5 kopyası: sunucu runtime kaynağı, disk projeksiyonu, okuma modeli işçisi LRU'su (≤768 MiB), compute işçileri (≤2), renderer `state.cp`/`state.orders` (geri düşüş yolunda), Genel Bakış row-prep kopyası. RSS tepe 1,7 GB (kayıt akışı), 2,6 GB (erp-readmodel) | Kopya sayısı Muhtemel; RSS Doğrulandı |
| Bağımsız test edilebilirlik | Test dosyası sınıflaması | 1.540 testin **628**'i `app-main.js` kaynağını okuyor; 262'si fonksiyon *kaynağını ayrıştırıp* vm'de çalıştırıyor (`tests/helpers/app-main-functions.js`); ~366'sı kaynak metin sözleşmesi. Çıkarıcı bile gizli global'lere takıldı (`_isoDayCache`, `window.XLSX`, Ek B) | Sayım Doğrulandı; "366 yalnız metin" sınıflaması Muhtemel |
| Hata yayılma alanı | Yapı | `app-main.js` tek klasik script: bir sözdizimi ya da üst düzey çalışma hatası tüm modülleri düşürür | Muhtemel (denenmedi) |
| Yeni özellik geliştirme maliyeti | Doğrudan ölçüm yok | Vekil gösterge: P1/P2 commit başına 6 runtime dosyası ve %44 `app-main` çakışma yüzeyi | Bilinmiyor (vekil Doğrulandı) |

---

## 5 · On varsayım × üç seviye

Sıralama §0'daki öncelik sırasına göre etkiyi izler. Her varsayımda **S1** optimizasyon, **S2** mimari dönüşüm, **S3** problemin ortadan kaldırılmasıdır.

### V1 · "Bir satır değişince türetilmiş projeksiyon dosyaları yeniden yazılmalıdır"

- **Neden böyle:** Projeksiyon modül başına tek bir gzip JSON (`page-projection-cache.js`). Artımlı satır yaması (`projection-row-patch.js`, bu klonun geçmişi 2026-10-09'dan önceye inmiyor) var, ama yama sonucu yine **tüm modül dosyası** olarak yazılıyor. #1096 (2026-11-20) `cp-row-patch-log.js` ile okumanın yazımı beklememesi için ikinci, bellek içi bir yol ekledi **[Doğrulandı: source + git]**.
- **Zorunlu mu:** Hayır, **tarihsel**. Projeksiyon türetilmiş ve yeniden üretilebilir bir önbellektir. Doğruluk kaynağı `overrides.json` ve kaynak verisidir.
- **S1:** Gzip seviyesini düşürmek, değişmeyen modülü atlamak (kısmen var: yalnız `changed`), toplu yazım (`ROW_REWRITE_MAX_BATCH` var).
- **S2:** Projeksiyonu satır bloklarına (shard) bölmek; yalnız değişen bloğu yazmak.
- **S3:** **Projeksiyon = değişmez taban + kalıcı, sıralı satır yama günlüğü.** Kayıt yalnız günlüğe bir satır ekler. Okuyucular (sayfa projeksiyonu, okuma modeli işçisi, canlı olay) aynı günlüğü uygular. Tam yeniden yazım yalnız boşta ya da günlük eşiği aşınca **sıkıştırma** olur. Bu, `local-db.js:453-512` WAL'ının aynı deseni: "50.000 satırda küçük yazım 207 ms" sorununu orada bu desen çözdü. Böylece T11'deki üç mekanizma tek günlüğe iner; `cp-row-patch-log`'un süreç içi TTL'li zinciri ve "zincir koptu → gerçek nesli bekle" yolu gereksizleşir. Ek S3: tarih temizlemeyi açık bir **temizlendi** değeriyle temsil etmek, `rowPatchIncrementalSafe`'in `null`/`''` istisnasını, yani tam yeniden yüklemeye düşüşü kaldırır.
- **Doğrulama (Goodhart'a karşı):** Gölge modda her kayıtta `taban+günlük` sonucunun satır özeti, tam yeniden yazımın özetiyle karşılaştırılır (`cp-row-patch-log` `settle` sayaçları zaten bu iş için var). Özellik tabanlı rastgele düzenleme dizileri: aynı satıra ardışık yazım, no-op, bağlam (`contextHash`) değişimi, transit kuralı değişimi, yerel gün dönümü, kayıt ile sıkıştırma arasında `kill -9`, eşzamanlı iki sekme. Mevcut testlerin kapsamadığı durum: günlük ile taban nesli uyuşmadığında okuyucunun ne yaptığı.
- **Beklenen kazanım:** Kayıt başına modül yeniden yazımı ortadan kalkar; okuma yazımı beklemez. Ölçülmüş taban: 5,9 CPU-sn/kayıt, okuma p50 1,85 sn, yerleşme 3,5 sn, RSS tepe 1,7 GB. Ne kadar düşeceği **[Hipotez]**, Faz 1'de L2 ile ölçülür.
- **Risk:** Doğruluk (yanlış görüntü). Veri kaybı riski yok, çünkü kaynaklar dokunulmadan kalır ve projeksiyon her zaman yeniden üretilebilir. Günlük ve taban nesil eşleşmesi kritik.
- **Geri alınabilirlik:** Yüksek. Bayrak kapanınca bugünkü yeniden yazım yolu döner; günlük silinebilir türetilmiş veridir.

### V2 · "Türetilmiş alanlar okuma anında (istemcide) yeniden türetilir, sunucu aynasını tutar"

- **Neden böyle:** `overview-row-prep.js:8-11` (yukarıda alıntı). JSON'da `Date` yok, istemci tarih nesnesiyle çalışıyor. `applyCpApprovalDate` (`app-main.js:1902`) `row['Ex-factory']`'yi **yerinde** değiştiriyor ve ham değeri `_asasExFactory`'ye taşıyor. Aynı alan adı bağlama göre iki farklı anlam taşıyor **[Doğrulandı]**.
- **Zorunlu mu:** Hayır. Tarih için gün ordinal'i (tamsayı) okuma modelinde zaten kullanılıyor (`dateOrdinal`).
- **S1:** Türetmeyi işçide yapmak; yalnız görünür satırları türetmek.
- **S2:** Türetme zincirini paylaşılan saf bir UMD modülüne çıkarmak (`business-rules.js` gibi). İstemci ve sunucu aynı kodu çalıştırır, parite testi birim testine dönüşür.
- **S3:** **Türetme projeksiyon üretiminde bir kez yapılır; istemci türetmez.** Türetilmiş değerler ayrı adlı alanlar olarak taşınır (ör. `exFactoryAsas` ve `exFactoryEffective`). Böylece "aynı ad, iki anlam" durumu temsil edilemez hale gelir. `CP_RM_CLIENT_DERIVED_KEYS` listesi boşaldıkça istemci tam satır yoluna düşmez (V3) ve 17 parite testinin ihtiyacı ortadan kalkar.
- **Doğruluk sınırı:** Türetme **ortam girdileri** okuyor: `computeFlags` `new Date()` ve global `state.overrides.transitRules` okuyor (`app-main.js:1054-1064`) **[Doğrulandı]**. Bir kez türetmek, bu girdilerin anahtar olarak açıkça modellenmesini gerektirir. `derived-input-keys.js` yerel günü ve override'ları zaten anahtara katıyor. Dil, kullanıcı tercihi, closure içindeki config gibi diğer girdiler satır satır denetlenmeli. Sunucu ve renderer aynı makinede çalıştığı için saat dilimi farkı olmaz; gece yarısı dönümü olur.
- **Doğrulama:** Faz 0'da istemci türetmesini gölgede çalıştırıp sunucu değerleriyle satır satır karşılaştırmak. Gün dönümü, saat dilimi ve `XLSX` yüklü/yüksüz yollarda fuzz (T10'daki sınır).
- **Kazanım:** Tek uygulama, açılışta 30k satırın istemcide türetilmemesi, okuma modeli kapsamının genişlemesi. Süre etkisi **[Hipotez]**.
- **Risk:** Orta. 10 `computeFlags` çağrı noktası ve yerinde değiştirmeye dayanan kod var.
- **Geri alınabilirlik:** Alan alan yapılırsa yüksek (bir alan, bir bayrak).

### V3 · "Modül verisi arayüze tam satır kümesi olarak gelmelidir"

- **Neden böyle:** Tarihsel `/api/data/*` ve `page-projection` tam yük (154 MB). Okuma modeli pencereli yolu (#1076, #1078) bu varsayımı CP ve Siparişler için **kısmen kaldırdı** ama geri düşüş koşulları var: kaydedilmemiş düzenleme, kısmi görünüm, türetilmiş sütun filtreleri ve pencere satırlarında düzenleme ("alt PR 3") **[Doğrulandı: `app-main.js:11330-11348`, `:12231-12245`]**.
- **Zorunlu mu:** Hayır. Geri düşüşlerin çoğu V2'nin sonucu.
- **S1:** Tam yükü işçide çözmek, gzip aktarımı (var).
- **S2:** Pencereli yolu düzenlemeye genişletmek.
- **S3:** **Arayüz yalnız pencere + düzenleme tamponu tutar.** Geri düşüş listesi V2 ile boşaltılır ve istemci tam satır yolu kaldırılır. Sorgu yolu ikiliği (T7) böylece biter.
- **Doğrulama:** Her geri düşüş nedeni için sayaç (`legacyReason` alanı zaten var). Saha telemetrisi yerine yerel, anonim 30k fixture'da neden dağılımını ölçmek.
- **Kazanım:** Siparişler soğuk açılışı (17 sn) ve renderer belleği. Ne kadar olacağı **[Hipotez]**.
- **Risk:** Orta-yüksek (düzenleme UX'i). **Geri alınabilirlik:** Mevcut anahtarlar (`BL_CP_READ_MODEL`, `BL_ORDERS_READ_MODEL`) sayesinde yüksek.

### V4 · "Önbellek geçerliliği içerik hash'iyle kanıtlanmalıdır"

- **Neden böyle:** `derived-input-keys.js:2-5` "loadedAt içerik kimliği sayılmaz". Kaynak tümüyle `JSON.stringify` + SHA-256'dan geçiyor. Yorum: "60k satırda 1,5–2,3 sn'lik tek olay döngüsü bloğu", bu yüzden kooperatif sürüm yazılmış **[Doğrulandı: source yorumu; bu ADR'de ölçülmedi]**.
- **Zorunlu mu:** Kısmen. Hash dışarıdan gelen ve beyan edilmeyen değişikliği yakalar, ki bu doğruluk lehinedir. Ama yalnız **hash'lenen** girdiyi görür: saat, yerel gün (eklenmiş), dil, config, closure ve global okumaları görmez (V2'deki `transitRules` örneği).
- **S1:** Kooperatif hash (var), WeakMap ile tekrar önleme (var).
- **S2:** Kaynak yüklenirken bir kez hash'leyip kaynak nesnesine iliştirmek.
- **S3:** **Kaynak değişimi yalnız bilinen yazım sınırlarından geçer** (yenileme içe aktarımı, override yazımı, kural değişimi). Bu sınırlarda monoton bir **nesil** artırılır ve anahtar `(kaynak nesli, override nesli, ortam girdileri)` olur, içerik hash'i gerekmez. Hash yalnız gölge denetçi olarak ve seyrek çalışır.
- **Doğruluk sınırı:** Nesil sayacı, beyan edilmemiş bir yazım yolunu **kaçırır**. Hash de beyan edilmemiş bir *girdiyi* kaçırır. İkisi de "izlenen katman dışını" görmez. Bu yüzden S3 tek başına güvenli değil. Gölgede hash ve nesil birlikte koşmalı, uyuşmazlık sayacı sıfır olmadan geçilmemeli.
- **Kazanım:** Ana iş parçacığı blokları. Değeri **[Bilinmiyor]**, ölçülmeli. **Risk:** Doğruluk (bayat önbellek). **Geri alınabilirlik:** Yüksek.

### V5 · "Eksik, boş ve sayısal değerleri her tüketici kendi yorumlar"

- **Neden böyle:** Modüller bağımsız yazılmış (T1: 40 tanım, ≥6 anlam). `''`→0 ile `''`→`null` farkı toplamları ve ortalamaları değiştirir **[Doğrulandı: deney]**. Üretimde etkisi **[Bilinmiyor]**.
- **Zorunlu mu:** Hayır.
- **S1:** Tek `num()` yardımcısına geçmek. Ama farklı anlamları zorla eşitlemek davranış değiştirir, bu yüzden S1 tek başına riskli.
- **S2:** Tipli okuyucular (`readNumber(row, canonicalId)`) kanonik alan tanımından tip alır.
- **S3:** **Değer, içe aktarım sınırında bir kez sınıflandırılır:** `Değer(n) | Yok | Bilinmiyor (+kaynak)`. Tüketici ham dizeyi hiç görmez ve "boş mu, sıfır mı" sorusu her tüketicide ayrıca sorulmaz.
- **Not:** Bu yön paralel oturumda pilot olarak yürüyor ("Veri sözleşmesi pilotu: Bilinmiyor/Yok/Değer+Kaynak"). Bu ADR onu yineleme yerine referans alır. T1 matrisi o pilot için bir girdi olabilir.
- **Doğrulama:** Her tüketicide eski ve yeni okuyucu çıktısını anonim 30k fixture üzerinde fark raporuyla karşılaştırmak. Fark çıkan her yer bir ürün kararıdır.
- **Risk:** Doğruluk. Bugünkü bazı toplamlar bilinçli olarak 0 kabul ediyor olabilir. **Geri alınabilirlik:** Tüketici tüketici ilerlenirse yüksek.

### V6 · "Satır, kaynak başlığı anahtarlı serbest bir nesnedir"

- **Neden böyle:** Excel kökeni. CP/Siparişler başlık anahtarlı, Koleksiyon camelCase (T13). `canonical-fields` + module binding sonradan köprü olarak geldi **[Doğrulandı]**.
- **Zorunlu mu:** Hayır, ama **en pahalı** dönüşüm bu.
- **S1:** Kanonik okuma yardımcısının kapsamını artırmak (CLAUDE.md §4 bunu zaten istiyor).
- **S2:** Okuma katmanında kanonik görünüm (proxy/adapter).
- **S3:** İçe aktarım sınırında satır **kanonik ID anahtarlı** üretilir. Kaynak başlığı yalnız eşleme ve görüntü meta verisidir. Ham başlık eşleştirmesi mimari olarak imkânsız hale gelir.
- **Risk:** Yüksek: geniş etki alanı, kayıtlı görünümler, formüller, dışa aktarım başlıkları. **Öneri:** Pilot değil. V2'de yeni türetilmiş alanlar **kanonik adla** doğsun; temsil zamanla ve kendiliğinden göç etsin.

### V7 · "Her modül kendi tablo davranışını (filtre, kalıcılık, sorgu) uygular"

- **Neden böyle:** Modüller farklı zamanlarda eklendi (T5, T6). Paylaşılan parçalar sonradan çıkarıldı (`table-search-*.js`, `quick-filter-groups.js`).
- **Zorunlu mu:** Hayır. Davranış farklarının bir kısmı **ürün kararı** olabilir (§7).
- **S1:** Ortak yardımcıları daha çok modülde kullanmak.
- **S2:** Tek tablo denetleyicisi; modül yalnız kolon şeması ve veri kaynağı verir.
- **S3:** **Filtre anlamı kolon tipinden türetilir.** Modül filtre *kodu* yazmaz, yalnız kolonu tipiyle beyan eder. Aynı filtre tanımı istemcide ve `read-model-query`'de aynı yorumlayıcıyla çalışır. Böylece T5, T6 ve T7 birlikte kapanır.
- **Doğrulama:** Mevcut filtre durumlarının (kayıtlı görünümler, `BLStorage`) yeni yorumlayıcıyla aynı satır kümesini verdiğini anonim fixture üzerinde kanıtlamak. Modüller arasındaki bilinçli farklar önce ürün sahibine listelenir.
- **Risk:** Orta (kullanıcı alışkanlığı). **Geri alınabilirlik:** Modül modül yapılırsa yüksek.

### V8 · "Derleme adımı olmadığı için modüller global ortam üzerinden bağlanmak zorundadır"

- **Neden böyle:** 130 klasik script, 218 `window.X`. `app-main.js` %44 committe değişiyor ve 48 günde 9.375 satır büyüdü **[Doğrulandı]**.
- **Zorunlu mu:** **Hayır, tarihsel.** Yerel ES modülleri (`<script type="module">`, import map) derleme adımı ve bağımlılık gerektirmez **[Muhtemel; Electron'da denenmedi]**.
- **S1:** `app-main.js`'ten yeni dosyalara taşıma (bugünkü gidişat).
- **S2:** Yeni kodu ES modülü olarak yazmak ve açık import kullanmak.
- **S3:** **Değişikliğin etki alanını yapıyla sınırlamak:** her özellik kendi durumunun sahibidir ve dışarıya yalnız açık API verir. Global'e yazmak lint ile yasaklanır (yeni dosyalar için). Bağımlılık grafiği statik olur; "bu değişiklik neyi etkiler" sorusu ölçülebilir hale gelir.
- **Doğrulama:** Sıcak dosya oranını (`app-main` %44) ve P1/P2 commit başına runtime dosya medyanını (6) her çeyrek yeniden ölçmek. Hedef: oranın düşmesi; satır sayısı hedef değildir.
- **Risk:** Yükleme sırası ve script sıralamasına bağlı mevcut sözleşmeler (`tests/helpers/script-loading.js`). **Geri alınabilirlik:** Dosya başına.

### V9 · "Regresyon, kaynak metin sözleşmeleriyle önlenir"

- **Neden böyle:** `app-main.js` Node'da bütün olarak çalıştırılamıyor (`app-main-functions.js:4-9`). 628 test bu kaynağı okuyor, 262'si fonksiyonu kaynaktan ayrıştırıp çalıştırıyor **[Doğrulandı]**.
- **Zorunlu mu:** Hayır, V8'in sonucu.
- **Goodhart riski:** Metin sözleşmesi davranışı değil **yazımı** doğrular. Davranışı koruyan bir yeniden düzenlemeyi kırmızıya çevirir, davranışı bozan ama metni koruyan değişikliği yeşil geçirir. Bu oturumdaki deney, çıkarılan fonksiyonun gizli global'lere (`_isoDayCache`, `window.XLSX`) bağlı olduğunu gösterdi. Test, üretimdeki ortamı değil, verilen stub'ı test ediyor.
- **S1:** Sözleşme testlerini birleştirmek ve hızlandırmak.
- **S2:** Saf hesapları modüllere taşıyıp canlı birim testine geçmek.
- **S3:** **Davranış, saf ve import edilebilir modüllerde toplanır.** Regresyon özellik tabanlı testle ve modüller arası parite testiyle korunur. Kaynak metin sözleşmesi yalnız gerçekten metinsel olan değişmezlerde kalır (i18n bekçisi, script sırası, güvenlik işaretleri).
- **Doğrulama:** Mutasyon denemesi. Hedef fonksiyonda küçük bir davranış değişikliği yapılır ve kaç testin yakaladığına bakılır. Davranışı koruyan bir yeniden adlandırma yapılır ve kaç testin yanlışlıkla kırıldığına bakılır. **[Bilinmiyor]**, koşulmadı.
- **Risk:** Koruduğu regresyon bilinmeden test silinmez (CLAUDE.md §3 adım 7). Dönüşüm yalnız, eşdeğer davranış testi eklendikten sonra eski sözleşmenin yerine geçer. **Geri alınabilirlik:** Yüksek.

### V10 · "Birden fazla cihazın aynı yayım dosyasına yazması gerekir"

> Ürün sahibinin kapsam ekiyle genişletildi (2026-11-26). Sözlük sırası önceliğinde (veri bütünlüğü) **en üstte** yer alır. Numara, mevcut sırayı bozmamak için korundu. Bu bölüm yalnız araştırmadır: senkron motoru yazılmadı, `collection-replication.js` ve sync dosyaları **okundu ama değiştirilmedi**. Uygulama yolu ADR-0001'in aşamalarıdır.

**Kısa cevap:** Teknik olarak **zorunlu değil** **[Güçlü çıkarım]**. Repo, sipariş ve genel senkronda bu sorunu zaten tek yazarlı, değişmez paketlerle çözmüş. Koleksiyonun bu yolun dışında kalmasının nedeni desenin kendisi değil, genel yolun **katlama anında yetki denetimi yapmaması**.

**Alternatif:** Her cihaz yalnız kendisine ait, değişmez değişiklik kayıtlarını yayımlar (`.../<owner>/<device>/<seq>-<id>`). Diğer cihazlar bunları okuyup yerel durumlarını deterministik olarak katlar (fold). OneDrive yalnız taşıma katmanıdır, doğruluk ona bağlı değildir.

#### Bugün neden böyle (kanıt)

| Bulgu | Kanıt |
| --- | --- |
| Koleksiyon, sahip başına **tüm-belge zarfı** olarak yayımlanıyor. Yazım `withFileLeaseAsync` kirası altında yapılıyor. CAS yarışı için üç ayrı kod var: `COLLECTION_REPLICA_CONFLICT`, `_STALE`, `_ANCESTRY_CONFLICT`. | **[Doğrulandı]** `collection-replication.js:24,29` |
| Yayım maliyeti zarf boyutuyla doğrusal büyüyor. Source yorumundaki ölçüm (Linux, 30.000 satır, **6,7 MB** zarf): normal yayım kirası ~123 ms, kira altında birleşim +~1,08 sn (~160 ms/MB). Başka makinelerin kira bekleme sınırı 3 sn olduğu için 2 MiB'tan büyük zarfta birleşim kiradan çıkarılıyor (`MERGE_UNDER_LEASE_MAX_BYTES`). | **[Doğrulandı: source yorumu]** `collection-replication.js:30-36`. Kapsam ekindeki "~9 MB" bu oturumda **doğrulanmadı [Bilinmiyor]**. |
| Koleksiyon genel delta yolundan bilinçli olarak çıkarıldı: "emekli havuz genel senkrona dönerse karantinadan sonra başka cihazda dirilebilir". | **[Doğrulandı]** `collection-replication.js:13-20` |
| Genel senkron dosyalarında yetki kavramı hiç geçmiyor: `delta-store.js`, `sync-package.js`, `sync-settings.js` ve `local-db.js` içinde `permission`, `authori[sz]`, `canEdit` ve `grant` aramaları 0 eşleşme verdi. | **[Doğrulandı: grep]**. Yani genel katlama, bir olayın yazarının o olayı yazmaya yetkili olup olmadığını denetlemiyor. |
| Desen repoda zaten var: cihaz başına `.ready` ve `.sync.gz` paketleri; "bu cihaz yalnız kendi taşıma dosyalarını budar" kuralı; varsayılan 30 günlük paket saklama; monoton HLC. | **[Doğrulandı]** `sync-settings.js:25,34,414-416`; `sync-package.js:14,196`; `hlc.js:1-5` |
| Aynı göç daha önce başka ortak veriler için yapıldı. `delta-store.js` başındaki yorumda ölçüm: SMB üzerindeki ortak JSON'a tek kayıt 52 senkron FS çağrısı yapıyor ve 3 ms ağ gecikmesinde ~19 kullanıcıda kilit zaman aşımı (409) başlıyor. Hedef olarak "yerel DB + delta paketleri" ve alan bazlı birleşim yazılmış. | **[Doğrulandı: source yorumu]** `delta-store.js:7-24` |
| `hlc.js` saat kaymasını yalnız **iz olarak kaydediyor** (5 dk eşik, `onSkew`), olayı reddetmiyor ya da kırpmıyor. | **[Doğrulandı]** `hlc.js:5,76-79` |
| Diğer oturumun bulgusu: tüm-belge zarf modelinde sırasız teslimde (OneDrive eski sürümü yenisinden sonra getirince) yeni düzenleme geri alınıyor, ve bu düzeltme öncesi kodda da görülmüş. | **[Muhtemel]**: diğer oturumun raporu; bu oturumda yeniden koşulmadı. Aşama 0 dalındaki ilgili korunan iddia: `tests/collection-sync-multi-device-v20261125.test.js:332` ("newer value overwritten by stale copy"). |

**Koleksiyonu genel yoldan çıkarma kararı zorunlu mu?** O günkü genel yol için **zorunluydu**: yetki denetimi olmayan bir katlamaya izinli veri konamaz. Mimari olarak ise **tarihsel**: yetki katlama anında denetlenirse (ADR-0001 kuralı 4) kararın nedeni ortadan kalkar ve Koleksiyon aynı taşıma desenini kullanabilir. Bunun için genel yolun kendisi değişmek zorunda değil; Koleksiyon kendi namespace'inde aynı deseni yetki farkındalığıyla uygulayabilir.

**Sırasız teslim neden yapısal bir sınır olabilir [Güçlü çıkarım]:** Tek `parentSha256` taşıyan tüm-belge zarfında, okuyucu geç gelen eski bir kopyayı eşzamanlı bir daldan ayırt edemez. Bunu ayırt etmek için nedensel soy bilgisi gerekir. Aşama 0 zarfa sınırlı bir soy listesi (son 32 kimlik) ekliyor; bu, 32 nesle kadar olan durumları kapatır. Daha derin bir gecikmede sınır sürer. Cihaz başına sıra numarası taşıyan değişmez kayıtlarda ise her yazarın sırası kaydın kendisindedir (fiilen bir sürüm vektörü). Geç gelen eski kayıt ya zaten görülmüştür (yinelenen sayılır) ya da HLC'ye göre doğru yere katlanır.

#### Alternatif hangi mevcut sorunları ortadan kaldırır?

| Sorun | Ortadan kalkar mı? | Gerekçe ve kalan risk |
| --- | --- | --- |
| Kilit/kira (`shared-file-transaction.js`) | **Doğruluk aracı olarak kalkar** | Ortak değiştirilebilir hedef kalmaz. Kira yalnız aynı makinedeki süreçleri sıraya koymak için yerel olarak kalabilir (ADR-0001 §2). |
| OneDrive `-PC` çakışma kopyası | **Kalkar** | Her dosyanın tek yazarı ve değişmez bir adı var; aynı dosyaya iki yazar düşmez. **Kalan risk [Hipotez]:** aynı `deviceId`'nin iki kurulumda çoğalması (klonlanmış profil veya yedekten geri dönüş). Kimlik çakışmasının tespiti gerekir (`installation-fingerprint.js` var; bu amaçla yeterli olup olmadığı **[Bilinmiyor]**). |
| Yayım maliyeti (tüm-belge zarfının yeniden yazımı) | **Kalkar** | Yayım yalnız değişen satırların kaydına iner. Yerine periyodik checkpoint maliyeti gelir; bu maliyet seyrek ve tek yazarlıdır. |
| Sırasız teslim | **Doğruluk için kalkar** (ön koşullu) | Ön koşul: katlama, **varış sırasına değil olay kümesine** bağlı olmalı. Alan başına HLC + `deviceId` ile son yazan kazanır (LWW) kuralı değişmeli ve birleşmelidir, bu yüzden geç gelen olay yeniden katlama gerektirmez. Çakışma kaydı ise "kaybeden değer" kümesi olarak tutulmalıdır, varış sırasına göre değil. |
| CAS yarışları | **Kalkar** | Karşılaştırılıp değiştirilecek ortak bir dosya yoktur. Üç yarış kodu ve kira altı birleşim dalı gereksizleşir. |

#### Getirdiği yeni karmaşıklıklar

| Karmaşıklık | Zorluk | Önerilen ele alış | Etiket |
| --- | --- | --- | --- |
| **Yetkinin katlama anında denetlenmesi** | Olay, yazarının o HLC anındaki yetkisiyle kabul ya da reddedilir; yetki değişikliği de HLC'li bir olaydır (ADR-0001 kuralı 4). İptali görmüş bir cihaz, HLC alma kuralı gereği iptalden küçük bir damga üretemez. Ama iptali **hiç görmemiş ve saati geri alınmış** bir cihaz iptalden "önceymiş gibi" görünen bir olay üretebilir. Güvenilir merkezi bir saat yok, bu yüzden HLC gerçek zamanı kanıtlayamaz. | İptalden **sonra varan** ve yazarı iptal edilmiş her olay, HLC'si ne olursa olsun ne sessizce uygulanır ne sessizce atılır. Sahip için **inceleme kuyruğuna** düşer. Bu, ilke 01 (sessiz kayıp yok) ve yetki güvenliğini birlikte korur. Ürün kararı gerektirir (§7). | Hipotez (güvenlik sınırı) |
| **Saat kayması** | İleri kaymış bir cihaz LWW'de uzun süre "kazanır". `hlc.js` bunu yalnız izliyor. Katlama sırasında "şimdi"ye göre kırpmak determinizmi bozar, çünkü her cihazın "şimdi"si farklıdır. | Deterministik kural: eşik üstü kayma, kırpma yerine **çakışma işareti** üretir. Kazanan HLC sırasıyla seçilir ama kayma görünür kılınır. Alternatif olarak sınır, katlanan kümenin içinden türetilir (ör. sahip checkpoint'inin HLC'si). | Bilinmiyor (seçenek değerlendirilmedi) |
| **Kayıt birikimi, compaction ve checkpoint sahipliği** | Genel senkronda paketler 30 gün sonra budanıyor. 30 günden uzun çevrimdışı kalan bir cihaz yalnız kayıtlarla yetişemez. | Sahip cihaz değişmez, özetle doğrulanan checkpoint yayımlar. Checkpoint hızlandırıcıdır, otorite değildir. Birden fazla Moderatör cihazında kimin yazacağı ADR-0001 §5 kararıdır. Ufku aşan cihaz checkpoint'ten yeniden önyüklenir. | Doğrulandı (saklama) / Hipotez (çözüm) |
| **Okuma maliyeti (N cihaz × olay)** | Her yoklamada N cihaz klasörü listelenir. OneDrive çok sayıda küçük dosyada istemci yükü getirir **[Muhtemel]**. | Cihaz başına sıra imleci (yalnız yeni dosyalar), cihaz başına demet (`gzipBundleMode` zaten var) ve checkpoint ile sınırlama. Ölçüm Aşama 1'de (L2). | Hipotez |
| **Silme tombstone'larının ömrü** | Tombstone erken budanırsa ufkun ötesindeki çevrimdışı kopya silinen satırı diriltir. Bu, bugün zaten testle korunan bir gereksinim ("çevrimdışı eski kopya silinen satırı diriltmez", Aşama 0 dalı). `local-db` tombstone'u yalnız yeniden oluşturmada siliyor gibi görünüyor **[Muhtemel]** (`local-db.js:1088,1185`). | Tombstone, ancak checkpoint onu içerdikten **ve** saklama ufku geçtikten sonra budanır. Ufkun ötesindeki cihaz kendi yerel kayıtlarını birleştirmeden önce checkpoint'ten yeniden önyüklenir; kayıtları çakışma olarak sunulur. | Hipotez |
| **Eski sürüm uyumluluğu ve geçiş** | Karışık sürüm döneminde eski istemci yalnız zarf okur ve yazar. | Gölge çift yazım (ADR-0001 Aşama 1–2). Zarfı yalnız sahip üretir; eski istemcinin zarfa yazdığı değişikliği sahip bir köprü ile olaya çevirir. Bu köprü, geçiş döneminin en karmaşık parçasıdır. | Hipotez |
| **Deterministik katlama** | Katlama; `Date.now`, yerel ayar, varış sırası ve kayan nokta toplama sırasına bağlı olmamalıdır. Yetki değerlendirmesi de yalnız olay kümesinden gelmelidir. | Sıralama `(HLC, deviceId, eventId)`. Özellik testi: aynı olay kümesinin rastgele teslim permütasyonları **aynı durum özetini** vermeli. | Hipotez (test yok) |

#### Üç seviye

- **S1:** Kira süreleri ve eşikleri, `MERGE_UNDER_LEASE_MAX_BYTES`, zarfın sıkıştırılması. Sorunu küçültür, kapatmaz (ADR-0001 §4).
- **S2:** Zarfa sınırlı soy zinciri ya da sürüm vektörü eklemek (Aşama 0: son 32 kimlik) veya zarfı satır shard'larına bölmek. Sırasız teslimi kendi derinliğine kadar kapatır, kira ve CAS kalır.
- **S3:** Ortak yayım dosyasını kaldırmak: tek yazarlı, değişmez kayıtlar; OneDrive yalnız taşıma. Kira, `-PC` kopyası, CAS ve tüm-belge yeniden yazımı **ihtiyaç olarak** ortadan kalkar.

#### Doğrulama (Goodhart'a karşı)

- Mevcut 20 cihazlı simülatörde (`tests/helpers/collection-sync-sim.js`) OneDrive davranışları: sırasız teslim, aynı dosyanın eski sürümünün geri gelmesi, gecikmeli ve eksik teslim, `-PC` kopyası, ±1 gün saat kayması, iptal ile çevrimdışı yazım yarışı, 31 gün çevrimdışı cihaz, kopyalanmış `deviceId`.
- Özellik testi: rastgele teslim permütasyonu ve tekrarlı teslim aynı durum özetini vermeli; sessiz kayıp her zaman 0 olmalı (her kaybeden değer çakışma kaydında).
- **Simülatörün sınırı:** simülatör OneDrive'ı modelliyor, OneDrive'ın kendisi değil. Gerçek iki Windows makine ve OneDrive ile soak testi gerekir. Bu container'da **BLOCKED**.

#### Kazanım, risk, geri alınabilirlik

- **Kazanım:** Bilinen veri kaybı sınıfının yapısal olarak kapanması, kira beklemesinin ve tüm-belge yayım maliyetinin kalkması. Süre etkisi **[Hipotez]**, Aşama 1'de ölçülür.
- **Risk:** Yetki ve saat sınırları (yukarıda), geçiş köprüsü, P1 çok kullanıcılı veri. İkinci model incelemesi zorunlu adaydır (CLAUDE.md §3.1).
- **Geri alınabilirlik:** Gölge modda tam. Geçişten sonra bayrakla zarf okumaya dönülebilir; olay günlüğü silinmez (ADR-0001 Aşama 2).

**ADR-0001'e eklenmesi önerilen üç açık nokta (bu araştırmadan):**
1. İptalden sonra varan, yazarı iptal edilmiş olaylar inceleme kuyruğuna alınır; HLC'ye göre kabul edilmez.
2. İleri saat kayması için deterministik bir kural (kırpma değil, çakışma işareti).
3. Tombstone budama ufku, 30 günlük paket saklamasına ve checkpoint'ten yeniden önyüklemeye bağlanır.

**Bu belgeye bağı:** V1'in önerdiği "değişmez taban + günlük" deseni, ADR-0001 ve `local-db` WAL'ı ile **aynı ilke**. Üç ayrı yerde kanıtlanmış olması, desenin yeni bir icat olmadığını, uygulamanın kendi ilkesi olduğunu gösteriyor.

### Özet tablo

| # | Varsayım | Sınıf | Birincil öncelik ekseni | S3 kazancı | Risk |
| --- | --- | --- | --- | --- | --- |
| V1 | Satır kaydı projeksiyonu yeniden yazdırır | **Kaldırılabilir** | Kararlılık, performans | Yüksek (ölçülü maliyet) | Düşük-orta (türetilmiş önbellek) |
| V2 | Türetme istemcide + sunucu aynası | **Kaldırılabilir** | Doğruluk | Yüksek | Orta |
| V3 | Arayüz tam satır alır | **Kısmen kaldırıldı; kaldırılabilir** | Performans | Yüksek | Orta-yüksek |
| V4 | Önbellek içerik hash'iyle kanıtlanır | **Kısmen zorunlu** | Doğruluk/performans | Orta | Orta |
| V5 | Her tüketici değeri kendi yorumlar | **Kaldırılabilir** (paralel pilot) | Doğruluk | Yüksek | Orta |
| V6 | Satır başlık anahtarlı serbest nesne | **Kaldırılabilir, pahalı** | Doğruluk/sadelik | Yüksek | Yüksek |
| V7 | Modül başına tablo davranışı | **Kaldırılabilir** (ürün kararı gerekebilir) | Doğruluk/sadelik | Orta | Orta |
| V8 | Global ortam üzerinden bağlanma zorunlu | **Tarihsel; kaldırılabilir** | Kararlılık/sadelik | Orta (birikimli) | Düşük (yeni kodda) |
| V9 | Regresyon metin sözleşmesiyle önlenir | **Kaldırılabilir** (V8'e bağlı) | Kararlılık | Orta | Düşük |
| V10 | Birden fazla cihaz aynı yayım dosyasına yazmalı | **Kaldırılabilir** (ADR-0001 aşamaları); öncelikte **1.** | Veri bütünlüğü | Çok yüksek | Orta-yüksek (yetki/saat sınırları, geçiş) |

**Zorunlu kalan kabuller:** yerel öncelikli dağıtım ve ortak klasör, bağımlılıksız portable kurulum, Electron/Node çalışma zamanı, tek şirket içi AI yolu, TR/EN. Bunlar korunur. Önerilerin hiçbiri bunları gevşetmez.

---

## 6 · Önerilen ilk pilot: CP satır kaydında projeksiyon yeniden yazımını kaldırmak (V1)

**Neden bu:** Ölçülmüş en büyük maliyet bu. BASELINE §5 de bunu 1 numaralı aday sayıyor. Hedeflenen veri türetilmiş ve yeniden üretilebilir, bu yüzden veri kaybı riski yapısal olarak yok. Desen uygulamanın içinde zaten kanıtlanmış (local-db WAL). Gölge altyapısının bir kısmı mevcut (`cp-row-patch-log` `settle` sayaçları). Kapsam dar: yalnız CP satır kaydı ve yalnız `rowPatchIncrementalSafe` yamaları. ADR-0001'in dosyalarına ve sync yoluna dokunmaz.

**Neden diğerleri değil:** V10 öncelikte birinci, ama uygulama yolu ADR-0001'in aşamaları; onun pilotu Aşama 1 gölge moddur ve bu belge ikinci bir pilot açmaz. V5 paralel oturumda yürüyor. V2 ve V7 daha geniş etki alanına sahip ve ürün kararı gerektirebilir. V6 pahalı. V10 kapsam dışı.

**Daha düşük riskli alternatif:** Ürün sahibi daha küçük bir adım isterse V2'nin alt kümesi seçilebilir: **Ex→Retail ve LT'yi projeksiyonda bir kez üretmek.** Bu iki alan saf tarih farkıdır (`OPD`, `Ex-factory`, `Retail Date`, kurallar). İkisi de CP ve Siparişler geri düşüş listelerinden çıkar. Kazancı küçük, riski düşük.

**Risk sınıfı:** P1 (geniş kapsamlı performans/güvenilirlik). Performans kademesi **L2**. İkinci model incelemesi Faz 1 diff'inde değerlendirilir.

### Faz 0 · Gölge ölçüm (davranış değişmez)

- Her CP satır kaydında `taban + yama günlüğü` sonucunun etkilenen satır özetini, tam yeniden yazımın (`settle`) ürettiği özetle karşılaştır. Sayaçlar: `settledOk`, `settledFailed`, kayıt başına yeniden yazılan bayt ve modül sayısı. Bu sayaç, BASELINE §3'te eksikliği yazılan "tek siparişte yeniden hesaplanan iş miktarı" ölçümünü de sağlar.
- **Kabul:** `benchmark-cp-save-flow.js --rows 30000` ve özellik tabanlı rastgele düzenleme üretecinde (≥10.000 düzenleme; aynı satıra ardışık yazım, no-op, bağlam ve kural değişimi, yerel gün dönümü, iki sekme, kayıt ile yeniden yazım arasında süreç öldürme) **`settledFailed = 0`**. Mevcut CP kayıt testleri geçer. Kayıt onayında L2 gerileme yok.

### Faz 1 · Bayrakla geçiş

- Yama günlüğü kalıcı olur: kullanıcı başına, projeksiyon nesline bağlı, append-only, kayıt sırası numaralı. Sayfa projeksiyonu, okuma modeli işçisi ve canlı olay aynı günlüğü tüketir. Okuma `pendingRewritesSettled`'ı beklemez. Tam yeniden yazım boşta ya da eşik aşılınca sıkıştırma olarak çalışır.
- **Kabul (L2, BASELINE ile aynı script ve ortam, ≥3 dönüşümlü çift):**
  - Veri bütünlüğü ve doğruluk: Faz 0 sayaçları sıfır kalır. `kill -9` sonrası açılışta sunulan projeksiyon, sıfırdan tam üretimle bayt bayt değilse **satır özeti düzeyinde** eşittir.
  - Kararlılık: sunucu RSS tepesi tabanı (1.697 MB) aşmaz.
  - Performans: kayıt akışında Siparişler okuması (taban p50 1.851 ms) ve süreç CPU'su (taban ≈5,9 CPU-sn/kayıt) tekrarlanabilir biçimde düşer. Kayıt onayı (taban p50 29 ms) gerilemez. Sayısal hedefi ürün sahibi Faz 0 verisiyle belirler. Bu belge hedef uydurmaz.
  - Sadelik: CP için `cp-row-patch-log` süreç içi zinciri ve TTL yolu kaldırılabilir hale gelir. Silme ancak eşdeğer test geçince yapılır.
- **Geri dönüş:** Bayrak kapanınca bugünkü yeniden yazım yolu döner. Günlük türetilmiş veridir ve silinebilir. Kaynak ve override biçimi değişmez.
- **Bilinçli olarak kapsam dışı:** `overrides.json`'ın kayıt başına tam okunup yazılması (BASELINE §5 aday 3, ayrı iş), tarih temizleme yamaları (Faz 2: açık "temizlendi" değeri), Siparişler ve Genel Bakış modülleri (Faz 2).

> Bu bölüm §6A'daki ölçümlerle **güncellendi**. Faz 0–1 kabul ölçütlerinin ölçülmüş tabanı ve okuma yolu ödünleşimi §6A.6'dadır.

---

## 6A · V1 doğrulama ve alternatifler (bağımsız ölçüm, 2026-11-26)

**Ortam:** Linux container, 4 vCPU, Node v22.23.5, `main` @ `d772bab`, sentetik 30.000 satır (seed 7). Ölçümler seri koşuldu. Repo kodu değişmedi. Araçlar scratchpad'de: `benchmark-cp-save-flow.js`'in kopyasına iş parçacığı başına `/proc` CPU'su ve CDP ile ana iş parçacığı + işçi profili eklendi, ölçüm mantığı aynı bırakıldı. **Windows/Electron temsil edilmez.** Kullanıcı bekleme süresi (wall) ile CPU süresi ayrı verilmiştir.

### 6A.1 · "5,9 CPU-sn/kayıt" bulgusunun bağımsız tekrarı

| Koşu (16 kayıt, 2,5 sn aralık) | Süreç CPU | Ana iş parçacığı CPU | İşçi iş parçacıkları (`node`) | libuv | Siparişler okuma bekleme p50 | Kayıt onayı p50 |
| --- | --- | --- | --- | --- | --- | --- |
| Okumalı #1 / #2 / #3 | 107,3 / 109,5 / 101,3 sn | 2,46 / 2,70 / 2,74 sn | 104,4 / 106,3 / 98,1 sn | 0,4 sn | 7,36 / 7,48 / 4,58 sn | 21 / 27 / 21 ms |
| Okumasız (Siparişler okuması yok) | 106,0 sn | 2,29 sn | 103,4 sn | 0,3 sn | — | 22 ms |

- **[Doğrulandı]** Medyan **107,3 sn / 16 kayıt ≈ 6,7 CPU-sn/kayıt** (BASELINE: 5,9). Mertebe tekrarlandı.
- **[Doğrulandı]** CPU'nun **%97'si işçi iş parçacıklarında**. Ana iş parçacığı kayıt başına 143–171 ms. Kayıt onayı 21–27 ms. Yani kullanıcı kaydı beklemiyor; bedel arka planda ödeniyor.
- **[Doğrulandı, tek okumasız koşu]** Siparişler okumalarının CPU payı gürültü içinde (okumalı medyan 107,3, okumasız 106,0 sn). Okuma **CPU harcamıyor, bekliyor**. Bekleme p50 4,6–7,5 sn ve BASELINE'da 1,85 sn: büyük varyans.
- **Bekleme açıklaması [Güçlü çıkarım]:** Okuma `pendingRewritesSettled`'ı bekliyor. Kayıt başına ~6,5 CPU-sn'lik yeniden yazım, 2,5 sn'lik kayıt aralığında 3 işçiye düşüyor (kapasite ~7,5 CPU-sn), yani doygunluğa yakın bir kuyruk oluşuyor. Bu yüzden bekleme süresi ortam gürültüsüne çok duyarlı.

### 6A.2 · Bileşenlere ayrım (CDP profili, profilli tek koşu: süreç 118,5 sn)

**İşçiler** (3 aktif `projection-rewrite-worker`, toplam meşgul 99,44 sn; 2 işçi boşta):

| Bileşen | sn (16 kayıt) | Pay | Kayıt başına |
| --- | --- | --- | --- |
| Serileştirme (`json-dates.stringifyWithDates`) | 27,55 | %27,7 | 1,72 sn |
| zlib gzip + gunzip (`writeSync` yaprağı) | 20,98 | %21,1 | 1,31 sn |
| GC | 19,31 | %19,4 | 1,21 sn |
| `JSON.parse` + işçi `run` öz süresi | 16,18 | %16,3 | 1,01 sn |
| Buffer kopyalama/dönüşüm (`slice`, `utf8Write`, `_copyActual`) | 14,68 | %14,8 | 0,92 sn |
| **Satır yaması ve iş kuralı hesabı** (`applyStep`, `projectionPatchMatches`, `parse.js`, motorlar) | **0,56** | **%0,6** | **0,035 sn** |

**Ana iş parçacığı** (meşgul 3,44 sn; profilleyici ek yükü dahil):

| Bileşen | sn | Pay |
| --- | --- | --- |
| Yeniden yazım orkestrasyonu, SHA-256 checksum, nesil yazımı (`page-projection-cache`) | 0,81 | %23,6 |
| GC | 0,76 | %22,2 |
| **Override belgesi okuma/yazma** (`db.js`, delta, durable/shared-file, fsync) | **0,60** | %17,4 (≈ 37 ms/kayıt) |
| HTTP yanıtı + **Siparişler okuması** (`server.js` rotası, `res.send`) | 0,59 | %17,1 |
| İşçi IPC (`projection-rewrite-pool`) | 0,14 | %4,2 |
| Satır yaması/hesap | 0,03 | %1,0 |

**Sonuç [Doğrulandı]:** Hesap zaten artımlı ve maliyetin %0,6'sı. Kalan **%99,4, türetilmiş verinin bütün dosya olarak temsilinden** geliyor: çöz, ayrıştır, serileştir, sıkıştır, kopyala, GC. Bu yüzden "Ex→Retail/LT'yi sunucuda bir kez hesapla" alternatifi kayıt maliyetini **düşürmez**. Onun değeri okuma modeli kapsamındadır (V2/V3) ve ölçülmedi.

### 6A.3 · Hazır veri neden bütün olarak yeniden yazılıyor ve kim bütün dosyaya ihtiyaç duyuyor?

Projeksiyon modül başına tek bir gzip JSON. Her yeniden yazım yeni bir **nesil klasörü** oluşturuyor. Kaynak kod sözleşmesi: "eski yol her kayıtta bütün modülleri ayrıştırır, yamalar ve stringifyWithDates ile yeniden yazar" (`projection-rewrite.js:6-11`) **[Doğrulandı]**. Fixture'da bir nesil cp 68,2, orders 80,7, order-summary 42,3 ve overview 12,5 MB çözülmüş veri içeriyor. Değişmeyen `overview.json.gz` de yeni nesle aynı boyutta ama farklı inode ile kopyalanmış **[Doğrulandı: `stat`]**.

Bütün dosyayı okuyan tüketiciler **[Doğrulandı: source]**:

| Tüketici | Yol | Bütün dosyaya gerçekten ihtiyacı var mı? |
| --- | --- | --- |
| Tarayıcı tam satır yükü | `GET /api/page-projection/:module` (`server.js:9086-9098`) → `fetchProjectionWithFallback` → `state.cp`/`state.orders` (`app-main.js:2680-2700`). Arka plan ısınması, okuma modeli açıkken bile CP ve Siparişler tam yükünü indiriyor (açılış zaman çizelgesinde `BACKGROUND_WARMUP` → `CP_LOAD_READY rows=24982`) | Yükleme anında **tam veri kümesine** ihtiyacı var, ama kayıt sonrası **yeniden yazılmış dosyaya** değil. İstemci canlı satır yamalarını zaten uyguluyor. |
| Okuma modeli ve compute işçileri | `loadProjection` → `ensureComputedProjection` → `readProjectionCompressed` (`server.js:9039-9060`; `read-model-routes.js:46`, `cp-computed-routes.js:33`, `overview-model-routes.js:28`, `prewarm-scheduler`) → işçide gunzip+parse → veri kümesi LRU'su | Bellekteki veri kümesi bir kez yüklenir; sonraki değişiklikler yama olarak uygulanabilir. `cp-row-patch-log` CP için bunu zaten bellekte yapıyor. |
| Eski `/api/data/*` zarfı ve açılış `buildResponse` | `server.js:8766`, `9150-9241` | Tam veri kümesi; aynı durum. |
| `/api/model-images/registry/cp` | `server.js:9165` | Aynı. |

**Cevap:** Hiçbir tüketici **kayıttan sonra yeniden yazılmış bütün dosyaya** ihtiyaç duymuyor. Tüketicilerin ihtiyacı **yükleme anında tam veri kümesi**. Bu ihtiyaç "taban + yama günlüğü" ile karşılanabilir. Kayıt yolundaki bütün dosya yeniden yazımı tamamen kaldırılabilir **[Güçlü çıkarım; prototiple eşdeğerliği Doğrulandı, §6A.4]**. Bütün dosya üretimi iki yerde kalır: (1) sıkıştırma, (2) tarayıcı tam yükü. Tarayıcı tam yükünün kalkması V3'e bağlıdır.

### 6A.4 · Mevcut mekanizma + iki alternatif (izole prototip, ölçüm öncesi eşitlik)

**Prototip:** `scratchpad/proto/mech.js`, commit edilmedi. Üç mekanizma da aynı fixture nesil dosyalarını, üretimdeki `projection-rewrite.js` çekirdeğini (`rowPatchContext`, `applySteps`, `serializeProjection`) ve benchmark'la aynı 16 kayıt karışımını (not / Del. Type / Retail Date) kullanıyor. Her mekanizma ayrı süreçte, tek iş parçacığında koşuyor; 3 tur, dönüşümlü sıra (M0-M1-M2, M2-M1-M0, M0-M1-M2).

- **M0 · Mevcut:** Her kayıtta 5 modül için gunzip → parse → yama → (değiştiyse) serialize → gzip l4 → atomik yazım + SHA-256.
- **M1 · V1: değişmez taban + kalıcı yama günlüğü.** Kayıt, günlüğe tek satır ekler (fsync dahil). Okuyucu (işçi veri kümesi gibi ayrıştırılmış bellek) yamayı uygular. Tam yeniden yazım ayrı bir **sıkıştırma** adımıdır.
- **M2 · (a) Satır bazlı güncellenebilir temsil:** 1.000 satırlık gzip parçalar ve sipariş kodu → parça dizini. Kayıtta yalnız etkilenen parça yeniden yazılır. Bütün dosya isteyen tüketici için birleştirme gerekir.
- (b) "artımlı projeksiyon" ayrı aday olarak alınmadı: hesap **zaten artımlı** (§6A.2). (c) "silinip yeniden oluşturulabilen önbellek" ayrı aday değil, mevcut bir **özellik** (§6A.5); M1'i güvenli kılan da budur.

**Doğruluk eşitliği (ölçümden önce) [Doğrulandı]:** 16 kayıttan sonra 5 modülün kanonik özeti (üst düzey anahtarları sıralanmış `serializeProjection` SHA-256'sı) üç mekanizmada da **eşit**, her 3 turda. Değişen modüller: cp, orders, order-summary. Değişmeyenler: overview, collection-catalog. Sınır: prototip, üretimdeki ardışık kayıtları toplu işleme (`ROW_REWRITE_MAX_BATCH`) davranışını modellemiyor. M0 kayıt başına ayrı uygulanıyor, bu bir üst sınırdır. Özellik tabanlı rastgele diziler ve süreç öldürme senaryoları **koşulmadı**.

| Ölçüm (3 tur, medyan; ham değerler) | M0 · mevcut | M1 · taban + günlük (V1) | M2 · satır parçaları (a) |
| --- | --- | --- | --- |
| **Kayıt başına CPU** | **6.533 ms** (6.468 / 6.634 / 6.533) | **11 ms** (11 / 13 / 11) | **127 ms** (115 / 144 / 127) |
| 16 kayıt toplam CPU (tek seferlik işler dahil) | 110,96 sn | 10,69 sn | 11,59 sn |
| Tek seferlik / dönemsel iş | — | Okuyucunun ilk yüklemesi 4,10 sn (bugün de var); sıkıştırma 3,37 sn (5 modül, N kayıtta bir) | Parçalama 5,90 sn; **bütün dosya isteyen her okumada birleştirme 3,55 sn** |
| Tepe RSS (tek süreçli prototip) | 969 MB | 1.100 MB (5 modül bellekte) | 857 MB |
| Kanonik çıktı | referans | eşit (3/3) | eşit (3/3) |
| Aşama dökümü (16 kayıt) | gunzip 9,97 · parse 45,82 · yama 0,96 · serialize 24,53 · gzip 22,03 · yazım+sha 0,35 sn | günlük+fsync 0,08 · okuyucu yaması 0,29 sn | parça çöz 0,74 · yama 0,03 · parça serialize+gzip 1,20 sn |

**Doğrulama notu [Doğrulandı]:** M0 prototipi kayıt başına 6,53 CPU-sn veriyor. Bu, sunucuda ölçülen 6,7 CPU-sn/kayıt ile örtüşüyor; prototip üretim maliyetini yeniden üretiyor.

**Karşılaştırma:**
- **M1:** Kayıt yolunda ~%99,8 daha az CPU [Doğrulandı: prototip]. Bedeli sıkıştırma (3,4 sn, seyrek ve boşta) ve okuyucuların günlüğü uygulama zorunluluğu. Bellek etkisi prototipte +131 MB; üretimdeki işçi LRU'su bu veri kümesini zaten tutuyor, net etki **[Bilinmiyor]**.
- **M2:** Kayıt yolu ucuz (127 ms), ama bütün dosya isteyen her okuma 3,55 sn birleştirme ödüyor ve **tüm tüketicilerin depolama biçimi** değişiyor. Bugün bütün dosya isteyen tüketiciler çok (§6A.3), bu yüzden maliyeti okumaya kaydırıyor. **Şimdilik reddedilir.** V3 tam satır yükünü kaldırırsa yeniden değerlendirilebilir.

### 6A.5 · Asıl iş verisi ve türetilmiş performans önbelleği

| Katman | Doğruluk kaynağı mı? | Kalıcılık / senkron / yedek |
| --- | --- | --- |
| `overrides.json` (DATA_DIR), kaynak ASAS/Excel, yerel DB | **Evet** (asıl iş verisi) | Atomik yazım + fsync + delta aynası; yedek ve senkron kapsamında |
| `local-data/page-cache/<user>/<gen>/*.json.gz` + `manifest.json` (+ `.bak`) | **Hayır**: türetilmiş ve yeniden üretilebilir (bozuk ya da yarım yazım geçersiz sayılır ve yeniden hesaplanır: `page-projection-cache.js:459`) | **Yedekten hariç** (`backup-service.js:131` `page-cache`), **tam geri yüklemeden hariç** (`full-restore-service.js:155`), yerel kökte ve ortak klasörde değil **[Doğrulandı]** |

Türetilmiş veri için gereksiz olabilecek kalıcılık ve doğrulama işleri:
1. **Her kayıtta tam nesil yazımı.** Değişmeyen modül dosyaları da yeni nesle kopyalanıyor **[Doğrulandı: aynı boyut, farklı inode]**. Türetilmiş veri için kayıt başına disk yazımı ve klasör değişimi; V1 bunu kaldırır.
2. **Her okuma ve yazımda sıkıştırılmış dosyanın SHA-256'sı** (ana iş parçacığında 0,57 sn/16 kayıt + okumalar). Gzip'in kendi CRC32'si açma sırasında zaten doğrulanıyor. Yeniden üretilebilir bir önbellek için ek kriptografik özetin gerekliliği **[Muhtemel değil]**, küçük kalem (~36 ms/kayıt).
3. `manifest.json.bak`: türetilmiş önbellek için yedek kopya. Maliyeti ihmal edilebilir (14 KB), gerekliliği **[Bilinmiyor]**.

Türetilmiş veri hiçbir senkron, yedek veya ortak klasör mekanizmasına girmiyor; bu doğru tasarım **[Doğrulandı]**. Gereksiz iş kalıcılıkta değil, **kayıt başına yeniden üretimin yazılmasında**.

### 6A.5b · Siparişler soğuk açılışı (17 sn) — kök neden bulundu

`benchmark-startup-orders.js --module orders` (repo betiği, değişmeden) zaman çizelgesi:

| İşaret | Mevcut (ms) | Prototip yamalı kopya (ms) |
| --- | --- | --- |
| `ORDERS_ROWS_VISIBLE` (okuma modeli ilk pencere, 30.000 satır) | **785** | 835 |
| `UI_FIRST_RENDER` | 1.502 | 1.228 |
| `UI_READY` / `primaryScreenReadyMs` | **17.133 / 17.224** | **2.065 / 2.147** |
| `AUTH_USER_LOAD_READY` ("after-ui") | 17.237 | 2.354 |
| İlk `BACKGROUND_WARMUP_START` | 18.725 | 3.824 |
| Uzun görev toplamı (10 sn pencere) | 1.721 | 4.224 |
| Satır / DOM satırı / hata | 30.000 / 50 / 0 | 30.000 / 50 / 0 |

- **Kök neden [Doğrulandı: source + runtime]:** `waitForOrdersReadModelRows` (`app-main.js:20974-20981`) `bl:orders-rows-visible` olayını bekliyor ve **15.000 ms** zaman aşımıyla çözülüyor. Satırlar 785 ms'de görünür olmuş ve olay o anda yayılmış, ama dinleyici daha sonra ekleniyor. Dinleyiciden sonra çağrılan `renderOrders()` aynı imza ve önbellekteki satırlarla `renderOrdersFromReadModel`'in önbellek dalına (`app-main.js` `if(signature===ordersRM.signature&&ordersRM.rows)`) giriyor. Bu dal olay **yaymıyor**, bu yüzden bekleme tam zaman aşımı kadar sürüyor (17,1 − 15,0 ≈ 2,1 sn = dinleyicinin eklendiği an).
- **Prototip [Doğrulandı: 1 koşu / kol, L2 değil]:** Scratchpad'deki uygulama kopyasında önbellek dalına tek satır olay yayımı eklendi. `primaryScreenReadyMs` 17,2 → 2,15 sn oldu; satır ve DOM sayısı aynı kaldı, hata yok. Repo kodu değişmedi.
- **Açılışta zorunlu veri yükü:** İlk pencere okuma modelinden 785 ms'de geliyor. Sayfa ilk ekran için tam Siparişler projeksiyonunu beklemiyor. Tam CP ve Siparişler satırları, `UI_READY`'den **sonra** arka plan ısınmasında iniyor **[Doğrulandı: zaman çizelgesi]**.
- **Görünmeyen işlerin etkisi:** Mevcut durumda ısınma ve kimlik yükleme, yapay 15 sn beklemenin **arkasına** itiliyor. Düzeltmede bunlar öne geliyor, bu yüzden 10 sn penceredeki uzun görev toplamı 1,7 → 4,2 sn çıkıyor. Bu yeni iş değil, aynı işin ölçüm penceresine girmesi. Ama kabul ölçütünde ayrıca izlenmeli: ısınmanın etkileşimi bozmadığı **[Bilinmiyor]**.
- **Kullanıcıya etkisi [Bilinmiyor]:** BootGuard `autoContinue` ile çalışma alanı daha erken açılıyor olabilir; kullanıcının 15 sn boyunca neyi beklediği ekran üzerinden doğrulanmadı. Kesin olan: `bl:primary-screen-ready` dinleyicileri, after-ui kimlik yüklemesi ve arka plan ısınması 15 sn gecikiyor.
- **Ölçüm tanımı notu:** Betiğin hazır koşulu `state.orders.rows.length>0` (tam satır). Okuma modeli açıkken "kullanıcı satırları gördü" anı `ORDERS_ROWS_VISIBLE`'dır; ikisi ayrı raporlanmalı.

### 6A.6 · Önerilen en küçük izole pilotlar ve önceden yazılmış kabul ölçütleri

Peşinen seçilmedi: ölçüm iki ayrı, birbirinden bağımsız pilot gösteriyor. Küçük olan önce.

**Pilot A · Siparişler açılış bekleme olayı (P2, tek satır, V1'den bağımsız).** Önbellek dalında `bl:orders-rows-visible` yayılır, ya da `waitForOrdersReadModelRows` satırlar zaten görünürse hemen çözülür.
- Kabul (L2, `benchmark-startup-orders.js --module orders`, ≥3 dönüşümlü Main/aday çifti):
  - `primaryScreenReadyMs` medyanı ≤ 3.000 ms (prototip 2.147).
  - Satır ve DOM satırı sayısı Main ile aynı; hata 0.
  - Okuma modeli kapalı yol (`BL_ORDERS_READ_MODEL=false`) davranışı değişmez.
  - Genel Bakış / Koleksiyon / CP açılışında gerileme yok.
  - Olay önbellek dalında tekrar tekrar değil, bir bekleme başına çözülür (davranış testi: satırlar dinleyiciden önce görünür olduğunda bekleme 15 sn'yi beklemeden çözülür; RED → GREEN).
  - Isınmanın öne gelmesiyle artan uzun görevler ayrıca raporlanır.
- Geri dönüş: tek satırın geri alınması.

**Pilot B · V1, kayıt yolunda bütün dosya yeniden yazımının kaldırılması (P1, bayraklı).** Kapsam:
- Yalnız `rowPatchIncrementalSafe` yamaları ve yalnız CP satır kaydı rotası.
- Günlük `page-cache/<user>/<gen>/patches.log`: türetilmiş, nesille birlikte silinir.
- İşçi veri kümeleri günlüğü kendi uyguladıkları sıra numarasından itibaren uygular.
- Sıkıştırma tetikleyicileri: boşta, günlük ≥ N ya da bütün dosya isteyen okuma öncesi, **yalnız istenen modül** için.
- Kabul (önceden yazıldı):
  - **Veri bütünlüğü:** `overrides.json` yazım yolu ve içeriği bit bit aynı. Günlük ve nesil silinince projeksiyon kaynaktan yeniden üretilebilir (test).
  - **Doğruluk:** Her sıkıştırma çıktısının kanonik özeti, gölgede çalışan M0 yolunun özetine eşit. Özellik tabanlı ≥10.000 rastgele kayıt dizisi (aynı satıra ardışık yazım, no-op, bağlam ve transit kuralı değişimi, yerel gün dönümü, iki sekme, ekleme ile onay arasında `kill -9`): fark 0.
  - **Kararlılık:** Tepe RSS, Main'in L2 medyanını aşmaz.
  - **Performans (L2, `benchmark-cp-save-flow.js --pairs 3`):** Okumasız akışta süreç CPU'su Main'e göre **≥ %80 düşer** (prototip beklentisi ~%95+; eşik bilinçli olarak temkinli). Kayıt onayı p50 gerilemez.
  - **Ödünleşim:** Okumalı akışta Siparişler okuma beklemesi **ayrıca** raporlanır. Bu benchmark her 2,5 sn'de bir bütün dosya okuyor; bu, M1 için en kötü desen, çünkü her okuma sıkıştırma tetikler. Gerileme varsa pilot BLOCKED olur ve tarayıcıya "taban + günlük kuyruğu" sunma seçeneği (istemci yamaları zaten uyguluyor) ayrı karar olarak getirilir.
- Geri dönüş: bayrak kapalıyken bugünkü yol. Günlük silinebilir.

## 6B · Pilot B uygulaması: kabul ölçütleri (ölçümden ÖNCE yazıldı, 2026-11-26)

**Kapsam:** Ürün sahibi onayıyla pilot kodu kendi dalında yazılır. Bayrak `BL_PROJECTION_PATCH_LOG=1`, **varsayılan kapalı**. PR, merge ve TEST yok. Dokunulmayanlar: `public/app-main.js` (Siparişler açılış düzeltmesi başka oturumda), `collection-replication.js` ve sync dosyaları. Projeksiyon türetilmiş veridir: kalıcılık, senkron ve yedek yükü verilmez; bozulursa silinip yeniden üretilir.

**Mekanizma:**
- Bayrak açıkken CP satır kaydı yalnız aktif neslin `patches.log` dosyasına adımları ekler ve manifesti günceller (bağlam, sıra numarası, günlük baytı).
- Bütün dosyayı okuyan ya da başka bir nesil üreten her yol, önce günlüğü **sıkıştırır**. Sıkıştırma, mevcut ve parite testli toplu yeniden yazımdır (`runRowRewriteSteps`, çok adım).
- Sıkıştırma ayrıca boşta (son eklemeden belirli süre sonra) ve eşikte (giriş sayısı ya da bayt üst sınırı) tetiklenir. Böylece günlük sınırsız büyüyemez.

**Hedef:** Toplam işlemci maliyetinde, sıkıştırma dahil, ≥ %80 düşüş. Maliyeti sonraya ötelemek kazanç sayılmaz; bu yüzden pencere sıkıştırmanın bitişini içerir.

**Ölçüm kuralı:**
- PERFORMANCE_ACCEPTANCE §3: ≥ 3 dönüşümlü (ABBA) kapalı/açık çift, aynı makine, aynı 30k fixture (seed 7), seri koşu.
- **A/A gürültü sınırı:** Aynı serideki bayrak kapalı koşuların ikili farklarının mutlak maksimumu.
- **Karar kuralı:** "Medyan A/A aralığında" kullanılmaz. Bir metrikte gerileme ancak şu durumda sayılır: **çift farklarının (açık − kapalı) üçü de aynı işarette pozitif** ve **her biri A/A maksimumundan büyük**. Kazanç da aynı kuralın tersiyle (üç fark da negatif ve A/A maksimumundan büyük) kanıtlanır. Tek aykırı A/A değeri aralığı genişletse bile, işaret kuralı bunu yakalar.

**Senaryolar:**
- **S1 · Uzun oturum:** 200 ardışık CP satır düzenlemesi (not / Del. Type / Retail Date karışık, 200 farklı sipariş), 1.000 ms aralık, akış sırasında bütün dosya okuması yok. Son düzenlemeden sonra boşta bekleme; bayrak açıkken boşta sıkıştırma, kapalıyken bekleyen yeniden yazımlar bitene kadar. Ardından bir `/api/page-projection/cp` okuması. **Pencere:** ilk kayıttan bu okumanın bitişine kadar.
- **S2 · Okumalı kayıt akışı:** Mevcut `benchmark-cp-save-flow.js` senaryosu (16 kayıt, 2,5 sn, her aralıkta Siparişler bütün dosya okuması). Bu, bayrak açık yol için en kötü desendir.
- **S3 · Beklenmedik kapanma:** Bayrak açık, günlük doluyken kayıttan hemen sonra `SIGKILL`. Ardından yeniden başlatma, soğuk ilk okuma ve sıcak ikinci okuma süresi, düzenlenen satırlarda son değerlerin varlığı.

**Kapılar:**

| # | Kapı | Ölçüt |
| --- | --- | --- |
| G1 | **S1 toplam süreç CPU'su** | Açık medyanı ≤ 0,20 × kapalı medyanı **ve** üç çift farkı da negatif ve her biri A/A maksimumundan büyük |
| G2 | S1/S2 ana iş parçacığı CPU'su ve kayıt onayı p50 | Gerileme kuralına takılmaz |
| G3 | **S2 toplam süreç CPU'su ve Siparişler okuma bekleme p50** | Gerileme kuralına takılmaz (en kötü desen; takılırsa pilot BLOCKED) |
| G4 | Tepe RSS (S1, S2) | Gerileme kuralına takılmaz |
| G5 | Disk yazımı (S1, `/proc/<pid>/io` `wchar` + `write_bytes`) | Raporlanır; gerileme kuralına takılmaz |
| G6 | Günlük sınırı | Her an giriş ≤ 64 ve bayt ≤ 8 MiB (sunucu izinden). Sıkıştırma sayısı, nedeni (okuma / boşta / eşik / mutasyon) ve süresi raporlanır |
| G7 | **Eşitlik (her düzenlemeden sonra)** | Birim: sentetik fixture'da 200 düzenleme, işçi ve ana iş parçacığı yolları; her düzenlemeden sonra okunan projeksiyon, eski yolla bayt düzeyinde aynı. 30k: in-process, ilk 10 düzenlemenin her birinden sonra ve 200'de kanonik eşitlik. Hepsinde %100 |
| G8 | **Dayanıklılık** | S3'te yeniden başlatma sonrası okuma 200 döner ve son değerler mevcut. Birim: yırtık günlük ya da manifest/günlük uyuşmazlığı → önbellek atılır ve yeniden üretilir; `.bak` manifest bekleyen günlükle asla güncel veri olarak sunulmaz; araya giren mutasyon önce sıkıştırır; Backlog varyantları eski yoldaki gibi düşer |
| G9 | Mevcut testler | `npm test -- projection-rewrite page-cache page-projection cp-shared-edit` geçer |

**Karar:** Yalnız G1–G9'un tümü geçerse PASS. Ölçümden sonra hiçbir eşik gevşetilmez; ölçülemeyen kapı BLOCKED sayılır.

### 6B.1 · Uygulama (kod: `c800f90b`, bayrak varsayılan KAPALI)

- `server/lib/page-projection-cache.js`: Bayrak açıkken `runRowRewriteBatch` modül dosyalarını yeniden yazmaz. Adımlar aktif neslin `patches.log` dosyasına eklenir. Manifest eski yolun yeni manifestiyle aynı alanları taşır, artı `patchLog` (nesil, taban bağlamı, giriş/adım/bayt).
- Sıkıştırma `materializePatchLogUnlocked`'tır: mevcut `runRowRewriteSteps` + `writeGenerationUnlocked`. Tetikleyiciler:
  - eşleşen bağlamla okuma (`readProjectionCompressed`, `readReusableProjections`);
  - araya giren her mutasyon (`writeGeneration`, `writeCompressedGeneration`, `reuseGeneration`, `rewriteGeneration`, `writeProjection`, `writeBacklog`, bayrak kapalı `runRowRewriteBatch`);
  - boşta kalma (30 sn);
  - kesin eşik (ekleme 64 girişi ya da 8 MiB'ı aşacaksa önce sıkıştır).
- Yırtık ya da uyuşmayan günlük kullanıcı önbelleğini atar. Bekleyen günlüklü `.bak` aday listesine girmez.
- `server/server.js`: Okuma modeli doğrulamasının CP satırları (`deferredCpRows`) sıkıştırmada üretilir. Satır eşlemesi günlükteki küresel adım sırasıyla yapılır, böylece yeniden başlatmaya dayanır.
- Günlük `local-data/page-cache/` altında: yedekten, tam geri yüklemeden ve ortak klasörden **hariç**. Türetilmiş veriye kalıcılık, senkron ya da yedek yükü eklenmedi **[Doğrulandı: yol + §6A.5]**.
- Dokunulmayanlar: `public/app-main.js`, `collection-replication.js`, sync dosyaları. Sürüm notu yok, çünkü bayrak kapalı ve kullanıcıya görünen değişiklik yok.

### 6B.2 · Sonuçlar (30k, seed 7, `d772bab` + pilot, Linux container 4 vCPU; seri; 3 ABBA çifti)

Çift farkı = açık − kapalı. A/A maksimumu = kapalı koşuların ikili mutlak farklarının maksimumu.

**S1 · Uzun oturum** (200 düzenleme, 1 sn aralık, 35 sn boşta, son okuma; pencere ≈ 236 sn):

| Metrik | Kapalı medyan [ham] | Açık medyan [ham] | Oran | Çift farkları | A/A maks | Karar |
| --- | --- | --- | --- | --- | --- | --- |
| **Süreç toplam CPU** | **546,7 sn** [546,7 / 552,4 / 541,4] | **33,9 sn** [33,0 / 36,5 / 33,9] | **0,062** | −513,7 / −515,9 / −507,5 sn | 10,9 sn | **Kazanç kanıtlı (−%93,8)** |
| Ana iş parçacığı CPU | 13,08 sn [12,65 / 13,21 / 13,08] | 6,31 sn [6,16 / 6,46 / 6,31] | 0,48 | −6,49 / −6,75 / −6,77 sn | 0,56 sn | Kazanç |
| Kayıt onayı p50 | 22 ms [21 / 22 / 24] | 17 ms [17 / 18 / 17] | 0,77 | −4 / −4 / −7 ms | 3 ms | Kazanç |
| Tepe RSS | 1.829 MB [1.829 / 1.906 / 1.787] | 1.596 MB [1.526 / 1.609 / 1.596] | 0,87 | −303 / −297 / −191 MB | 119 MB | Kazanç |
| Disk yazımı `wchar` | 1.393 MB [1.497 / 1.393 / 1.364] | 80,8 MB [80,8 ×3] | 0,058 | −1.417 / −1.313 / −1.283 MB | 134 MB | Kazanç |
| Disk `write_bytes` | 1.409 MB | 101 MB [101 ×3] | 0,072 | −1.409 / −1.308 / −1.279 MB | 131 MB | Kazanç |
| Son okumanın bitişi (`lastSettled`) | 36,67 sn | 36,66 sn | 1,00 | +69 / +85 / −32 ms | 103 ms | Ayırt edilemez |

- **Sıkıştırma (açık):** her koşuda 4 kez (3 eşik + 1 boşta), her biri 2,1–2,6 sn duvar süresi. 197 ekleme (ardışık kayıtlar birleşti). En çok 64 giriş ve 42,8 KB günlük. Atılan önbellek: 0.
- Ölçüm notu: iş parçacığı başına `/proc` toplamı, pencere içinde sonlanan işçileri kaçırıyor. Bu yüzden toplam için **süreç CPU'su** esas alındı.

**S2 · Okumalı kayıt akışı** (16 kayıt, 2,5 sn, her aralıkta Siparişler bütün dosya okuması):

| Metrik | Kapalı medyan [ham] | Açık medyan [ham] | Çift farkları | A/A maks | Karar |
| --- | --- | --- | --- | --- | --- |
| Süreç toplam CPU | 91,5 sn [91,5 / 91,8 / 90,9] | 90,7 sn [95,3 / 90,6 / 90,7] | +3,82 / −1,15 / −0,20 sn | 0,86 sn | Ayırt edilemez |
| **Siparişler okuma bekleme p50** | **1.767 ms** [1.710 / 1.767 / 1.768] | **4.778 ms** [5.099 / 4.778 / 4.676] | +3.389 / +3.011 / +2.908 ms | 58 ms | **GERİLEME** |
| Son kayıttan okumanın bitişi | 3.330 ms | 4.339 ms | +1.061 / +524 / +1.147 ms | 323 ms | **GERİLEME** |
| Kayıt onayı p50 | 25 ms | 20 ms | −5 / −5 / −5 ms | 3 ms | Kazanç |
| Tepe RSS | 1.634 MB | 1.622 MB | +152 / −181 / −71 MB | 259 MB | Ayırt edilemez |
| Disk `wchar` | 336,2 MB | 318,6 MB | −29 / −17 / −18 MB | 0 | Kazanç (küçük) |

- **Sıkıştırma (açık):** 16 kez, hepsi okuma kaynaklı (her kayıttan sonra günlükte 1 giriş), medyan ~2,1 sn.

**S3 · Beklenmedik kapanma** (30 kayıt, 300 ms aralık, onaydan hemen sonra `SIGKILL`; kol başına 1 koşu):

| | Kapalı | Açık |
| --- | --- | --- |
| Yeniden başlatma → giriş | 798 ms | 795 ms |
| Soğuk ilk CP okuması | **7.551 ms** (önbellek ıskaladı: bekleyen yeniden yazım kayboldu, kaynaktan yeniden üretim) | **3.090 ms** (önbellek isabetli: günlük kalıcıydı, okuma tek sıkıştırma yaptı) |
| Sıcak ikinci okuma | 434 ms | 437 ms |
| Son değer doğrulaması (not + Retail Date) | 20/20 | 20/20 |

**Eşitlik:**
- Birim testte (`tests/projection-patch-log-v20261126.test.js`) 200 düzenlemenin her birinden sonra, işçi ve ana iş parçacığı yollarında okunan içerik, manifest ve CP satırları eski yolla aynı.
- 30k in-process kontrolde (scratchpad `eq30k.js`, 5 modül, 24.982 CP satırı) ilk 10 düzenlemenin her birinden sonra ve 200'de içerik, manifest ve CP satırları eşit **[Doğrulandı]**.

### 6B.3 · Kapı kararları

| Kapı | Sonuç |
| --- | --- |
| G1 S1 toplam CPU ≥ %80 düşüş | **PASS**: −%93,8 (oran 0,062); üç çift de negatif ve A/A maksimumunun ~47 katı |
| G2 ana iş parçacığı ve kayıt onayı | PASS (S1 kazanç, S2 ayırt edilemez; kayıt onayı iki senaryoda kazanç) |
| G3 S2 toplam CPU ve Siparişler okuma bekleme | **FAIL**: CPU ayırt edilemez, okuma bekleme p50 +3,0 sn (oran 2,7), üç çift de pozitif ve A/A maksimumunun üstünde |
| G4 tepe RSS | PASS |
| G5 disk yazımı | PASS (S1 −%94) |
| G6 günlük sınırı | PASS (≤ 64 giriş, ≤ 42,8 KB; sıkıştırma sayısı ve süresi yukarıda) |
| G7 eşitlik | PASS |
| G8 dayanıklılık | PASS (S3 her iki kolda doğru; açık kolda soğuk okuma daha hızlı; birim testler) |
| G9 mevcut testler | PASS: `npm test -- projection-patch-log projection-rewrite page-cache page-projection cp-shared-edit` 47/47; değişen yollara atıf yapan 10 dosya 53 geçti, 1 önceden atlanan. Tam `npm test` koşulmadı (merge öncesi kapı). |

**Karar: BLOCKED.** G3 önceden yazılmış kurala göre FAIL. Eşik gevşetilmedi; pilot varsayılan kapalı kalır.

**Neden [Doğrulandı: sayaçlar + kaynak]:** S2'de her kayıttan sonra bütün dosya okunuyor. Bu yüzden her okuma tek girişli günlüğü **okuma anında** sıkıştırıyor: 16 kayıt, 16 sıkıştırma, eski yolla aynı iş miktarı, toplam CPU değişmiyor. Eski yolda yeniden yazım kayıt anında başlıyordu ve okuma (kayıttan ~1,25 sn sonra) onun kalan kısmını bekliyordu. Pilotta ise iş okuma geldiğinde başlıyor ve okuma tamamını bekliyor: **+~3 sn**. Bu, ürün sahibinin uyardığı "maliyeti ötelemek" durumunun okuma gecikmesindeki karşılığı. Toplam CPU kazancı ancak okumalar arasında kayıtlar biriktiğinde oluşuyor (S1).

**Bilinmeyen [Bilinmiyor]:** Gerçek arayüzde (okuma modeli varsayılan açık) bir CP kaydından sonra bütün dosya okuması ne sıklıkla oluyor? S2 bilerek en kötü desendir. Gerçek dağılım ölçülmedi: Playwright ile CP hücre düzenlemesi sırasında `/api/page-projection/*` ve `/api/read-model/*` isteklerinin sayılması gerekir.

### 6B.4 · Sonraki adım (uygulanmadı; yeni ölçüm ve önceden yazılmış kabul gerekir)

Okuma yolunun sıkıştırmayı **beklememesi** gerekiyor, yani okuyucunun günlüğü kendisinin uygulaması. Öneri **B2**, aynı bayrak altında:
1. **Okuma modeli ve compute işçileri:** önbellekteki veri kümesi günlük kuyruğunu uygular (bugün `cp-row-patch-log` CP hesabı için bunu bellek içi yapıyor). Böylece okuma sıkıştırma tetiklemez.
2. **Tarayıcı tam yükü (`/api/page-projection/:module`):** iki seçenek, ürün ve kapsam kararı.
   - (a) Taban + günlük kuyruğu sunulur, istemci mevcut canlı yama uygulamasıyla uygular (`public/app-main.js` değişir; Siparişler açılış düzeltmesi bittikten sonra).
   - (b) Yalnız istenen modül sıkıştırılır (modül başına günlük ofseti). Gecikme azalır ama okuma yolunda kalır.
3. Kabul, aynı G1–G9 ve aynı S2 kuralıyla. Ek olarak gerçek arayüz okuma desenini (yukarıdaki [Bilinmiyor]) ölçen bir S4 senaryosu.

Alternatif "kayıttan kısa süre sonra arka planda sıkıştır" (debounce) bilerek önerilmiyor. Ardışık düzenleme aralığı debounce'tan uzunsa S1 kazancını yok eder; kısaysa S2 gecikmesini çözmez. Ödünleşimi tek eşikle çözülemez **[Güçlü çıkarım]**.

### 6B.5 · Geçiş ve eski kodun kaldırılma planı (yalnız PASS sonrası)

İki kalıcı mekanizma tutulmaz. Sıra şöyle; her adım ayrı PR:
1. **B2 + yeniden ölçüm**, G1–G9 PASS.
2. **TEST kanalında açık** (bir sürüm). Sayaçlar sıfır olmalı: `patchLog.discarded`, `cp-row-patch-log.settledFailed`, `rowPatchMismatches`. Eşitlik gölgesi: TEST'te örneklenmiş sıkıştırma çıktısı eski yolla karşılaştırılır.
3. **Varsayılan açık.** Bayrak yalnız acil geri dönüş için bir sürüm kalır.
4. **Kaldırma:**
   - (a) `runRowRewriteBatch`'in kayıt başına yeniden yazım dalı; yalnız sıkıştırma kalır.
   - (b) `server.js` `BL_PROJECTION_REWRITE_INCREMENTAL=0` eski `rewriteGeneration` transform yolu.
   - (c) `cp-row-patch-log` bellek içi, TTL'li zincir; okuma modeli kalıcı günlüğü tükettiğinde aynı işin ikinci mekanizmasıdır.
   - (d) Bayrağın kendisi.
   - Parite testlerindeki eski yol transform'u, kaldırma tamamlanana kadar **oracle** olarak testte kalır, sonra sıkıştırma paritesine dönüştürülür.

Ölçüm araçları scratchpad'dedir (`bench-pilot.js`, `hook.js`, `decide.js`, `eq30k.js`) ve commit edilmedi. Kalıcılaştırılması gerekirse ayrı bir iş olarak `scripts/` altına alınır.

## 6C · B2: "sıkıştırma beklemeden güncel okuma" — kabul ölçütleri ve fizibilite (2026-11-26)

**Kabul ölçütleri** (ürün sahibinin metni; ölçümden önce sabit, değiştirilmez):
1. Uzun oturum toplam CPU (sıkıştırma dahil) ≥ %80 azalma (B1 S1 senaryosu, aynı veri).
2. Disk yazımında anlamlı düşüş (B1 ölçüm yöntemi; değer ve oran).
3. Siparişler okuma bekleme ve CP ilk okuma: bayrak kapalıya göre tekrarlanabilir gerileme yok. L2: ≥ 3 sıra-dönüşümlü çift, ham örnekler + medyan; çift farkları aynı işaretteyse gerileme sayılır; A/A gürültüsü ayrıca.
4. Kayıttan hemen sonra okuma güncel ve tutarlı (sıkıştırma beklenmeden).
5. SIGKILL sonrası güvenli toparlanma (≥ 20 deneme, sıkıştırma ortasında öldürme dahil).
6. Eski ve yeni yol arasında tam veri eşitliği (her koşuda).
7. Yeni mükerrer okuma/hesaplama motoru yok (diff'te gerekçeyle).

Sınırlar: okuyucu ya da modül başına ayrı günlük uygulama mekanizması yok. Tarayıcıya günlük uygulatmak yalnız tek ortak okuma yolu oysa olabilir. Maliyeti başka modüle, iş parçacığına ya da zamana taşımak çözüm değil.

**Araştırma: mevcut ortak okuma katmanı "sabit taban + bellek içi günlük" ile güncel veri sunabilir mi? [Doğrulandı: source]**

| Bulgu | Kanıt |
| --- | --- |
| Sunucudaki tek ortak okuma yolu `ensureComputedProjection` → `readProjectionCompressed`. Çıktısı modülün **bütün sıkıştırılmış baytları**dır. Bellekte ortak, çözülmüş bir temsil yok. | `server.js:9039-9060`; tüketiciler `server.js:9098` (sayfa projeksiyonu), `9150-9241` (eski `/api/data`), `9165` (görsel kaydı), `read-model-routes.js:46`, `cp-computed-routes.js:33`, `overview-model-routes.js:28`, `prewarm-scheduler` |
| Bütün dosya tüketicisi (`/api/page-projection/:module`) baytları **çözmeden** HTTP gzip gövdesi olarak geçirir. Bugün hızlı olmasının nedeni bu. | `compute-response.js:3-16` (`Content-Encoding: gzip`, `res.end(buffer)`) |
| Okuma modeli işçisi baytları kendisi çözer ve satırları `normalizeRows` ile **dönüştürülmüş** biçimde (Date vb.) tutar. Ham projeksiyon biçimi işçide yok. | `query-engine.js:14-21`, `read-model-worker.js:25-29` |
| Bellekte "taban + adımlar" yalnız CP hesaplanmış yolunda var. Orada adımlar, dönüştürülmüş satırı ham biçime çevirip yamalayıp geri dönüştüren **ayrı bir uygulama döngüsü** ile uygulanır. Bu döngü `projection-rewrite.applySteps`'ten ayrıdır, yani **zaten mevcut bir tekrar**. | `read-model/cp-computed-task.js:88-113` (`virtualDataset`: `diskRow` → `applyIncrementalProjectionPatch` → `workerRow`) |
| İstemci, normal bir CP satır kaydından sonra bütün Siparişler dosyasını yeniden **okumuyor**. `ensureOrdersLoaded` `state.orders` varken erken döner; yeniden okuma yalnız ilk açılış/ısınma, yeni sekme, `force` (ör. eksik adet işareti, yenileme) durumlarında. Kayıt sonrası güncelleme canlı satır yamalarıyla geliyor. | `app-main.js:2873-2874`, `7338`, `19014` **[Muhtemel: kaynaktan; gerçek arayüzde istek sayımı yapılmadı]** |

**Sonuç: B2, verilen kısıtlarla ölçüt 3'ü yapı gereği karşılayamaz. Karar: BLOCKED (kod yazılmadı, ölçüm yapılmadı).**
- Bütün dosya okuyucusuna güncel veri vermenin yalnız iki yolu var: (a) yeni baytları üretmek, bu B1'deki sıkıştırmadır ve okuma bekleme gerilemesi yaşanır; (b) sözleşmeyi "taban baytları + adımlar" yapmak, bu da her tüketiciye (tarayıcı, okuma modeli işçisi, CP hesaplanmış, eski `/api/data`) ayrı uygulama demektir. (b) ölçüt 7'yi ve "okuyucu başına mekanizma yok" sınırını ihlal eder. Tarayıcı tek ortak okuma yolu olmadığı için istisnaya da girmez.
- Ortak katmanda bellek içi bir temsil eklemek, ancak bütün dosya okumasında yeniden serileştirme + sıkıştırma ile mümkün. Bu, maliyeti okumaya taşımaktır ve sınır dışıdır.
- Kapsam kendiliğinden genişletilmedi; B3 denenmedi.

**Ürün sahibine seçenekler** (her biri ayrı karar ve yeni önceden yazılmış kabul ister):
- **O1 · Okuma yolunu tekleştir (mimari).** Tek bir bellek içi veri kümesi servisi (okuma modeli işçisi) bütün sunucu okumalarının tek kaynağı olur, bütün dosya HTTP yanıtı dahil. Günlük orada tek bir yerde uygulanır. Bedel: bütün dosya yanıtı her okumada üretilir; bu okumaların seyrekliği (yukarıdaki [Muhtemel]) ölçülmeden karar verilemez. Kapsamı pilotu aşar.
- **O2 · Tekrarı kaldırarak birleştir.** `projection-rewrite.applySteps` ile `cp-computed-task.virtualDataset` **tek bir** adım uygulama fonksiyonunda birleştirilir. Okuma modeli sorguları (CP/Siparişler `query`/`facets`) bu tek fonksiyonla taban + adımlardan beslenir. Bütün dosya okuması seyrek olduğu için B1'deki gibi okumada sıkıştırır. Bu, ölçüt 7'yi "mevcut iki döngüyü bire indir" biçiminde karşılar. Ama ölçüt 3'ün bütün dosya okuması yine B1 davranışındadır; o senaryoda gerileme sürer. Ölçüt 3'ün gerçek arayüz okuma deseniyle yeniden tanımlanması ürün kararıdır.
- **O3 · Önce ölç, sonra karar ver.** Gerçek arayüzde (Playwright, 30k) CP hücre düzenlemeleri sırasında `/api/page-projection/*` ve `/api/read-model/*` isteklerini say. Bu, S2 deseninin gerçek kullanımı temsil edip etmediğini belirler. Kod değişikliği gerektirmez, en düşük maliyetli adımdır.
- **Önerim: O3, sonra gerekirse O2.** O1 ancak O3 bütün dosya okumalarının kayıtlardan sonra sık olduğunu gösterirse değerlendirilmeli.

B1 kodu (`c800f90b`) bayrak kapalı haliyle dalda kalır. Davranışı değiştirmez. Karar O3'e kadar ertelenir.

## 6D · O3: gerçek arayüz okuma deseni ve veri güncelliği (ölçüm, 2026-11-26)

**Ölçülen kod:** Mevcut sistem = `main` `b6ee28b`. B1 = `41393eff`, yerel cherry-pick (`c800f90b` → `b6ee28b`, push edilmedi; `git cherry-pick c800f90b` ile yeniden üretilir), bayrak açık. B1'in `b6ee28b`'ye taşınmasının nedeni: `c800f90b` Siparişler açılış düzeltmesini (#1228) içermiyor; doğrudan karşılaştırma bayrak etkisini bu düzeltmeyle karıştırırdı. Repo kodu değişmedi; araçlar scratchpad'de (`o3/lib.js`, `journey.js`).

**Ortam ve yöntem:** Linux container, Playwright Chromium (Electron değil), sentetik 30k (seed 7). Her kol 3 tekrar, sıra dönüşümlü (off, on, on, off, off, on); tek tarayıcı bağlamında art arda senaryolar. Düzenleme gerçek DOM olayıyla yapıldı: CP tablosunda `input.editCell[data-kind=suppfob]` üzerinde `change`, yani `commitCpEditor`. Ortak alan: **Supp. FOB** (CP ve Siparişler tablosunda görünür). Bekleme = eylemden görünür satıra (ya da kayıt onayına) kadar. Bayt = CDP `encodedDataLength`.

### 6D.1 · Okuma sıklığı (deterministik; 3 tekrarda aynı) ve bekleme (medyan [ham], ms)

| Senaryo | Tam projeksiyon okuma | Okuma modeli istekleri (aktarılan) | Mevcut bekleme | B1 bekleme | B1 sıkıştırma |
| --- | --- | --- | --- | --- | --- |
| S5 Siparişler ilk açılış | **0** | 3× `orders/query` (1,58 MB) | 2.893 [2.739 / 3.049 / 2.893] | 2.824 [2.811 / 3.107 / 2.824] | — |
| S3a Siparişler → CP (ilk) | **1× `page-projection:cp`** (4,87 MB) | 1× `orders/facets` | 7.353 [7.353 / 7.401 / 6.739] | 7.051 [7.051 / 7.123 / 6.932] | — |
| S3b CP → Siparişler / S3c → CP (sıcak) | 0 | 0 | 548 / 884 | 532 / 996 | — |
| S1 CP tek düzenleme (kayıt onayı) | 0 | 1× `cp/computed` (**4,94 MB**) | 651 [709 / 651 / 596] | 687 [693 / 658 / 687] | — |
| S4 Siparişler'e dönüş | 0 | arama sonrası 2× `orders/query` (0,53 MB) | 461 [457 / 461 / 600] | 474 [474 / 501 / 436] | okumada 2,3–2,6 sn |
| S2 CP 20 ardışık düzenleme | 0 | 3× `cp/query` (1,24 MB) | 5.608 (sunucu CPU 33,0 sn) | 5.422 (sunucu CPU 21,4 sn) | — |
| S6a Yeni sekme, Siparişler | 0 | 3× `orders/query` (1,58 MB) | 8.832 [8.832 / 7.978 / 10.239] | 8.930 [8.930 / 11.950 / 8.347] | okumada ~2,4 sn |
| S6b Zorla yenileme | 0 | 1× `orders/query` (0,53 MB) | 1.190 [1.190 / 1.183 / 2.898] | 1.471 [1.471 / 2.154 / 1.216] | — |
| S7a Uzun CP oturumu (200 düzenleme) | 0 | çoğu koşuda 0; bir B1 koşusunda 2× `cp/query` + 6× `cp/facets` | 33.842 (CPU 46,7 sn) | 33.736 (CPU 14,0 sn; aykırı koşu: 334 sn, CPU 80,1 sn) | 2 eşik; aykırı koşuda 12 okuma |
| S7b Uzun oturum sonrası yeni sekmede Siparişler | 0 | 5× `orders/query` (2,11 MB) | 9.599 [9.599 / 7.840 / 9.759] | 9.558 [10.602 / 7.157 / 9.558] | okumada 0–2,2 sn |
| S8a Sunucu yeniden başlatma + Siparişler | 0 | 5× `orders/query` (2,12 MB) | 2.978 | 2.888 | — |
| S8b Yeniden başlatma sonrası CP açılışı | **1× `page-projection:cp`** (4,87 MB) | — | 8.500 [8.500 / 8.365 / 9.574] | 8.768 [9.489 / 5.920 / 8.768] | — |

**Okuma sıklığı sonucu [Doğrulandı: ölçüm]:**
- **Siparişler hiçbir senaryoda tam projeksiyon okumadı.** İlk açılış, yeni sekme, yenileme ve yeniden başlatmada okuma modeli sorgusu kullandı.
- Tam okuma yalnız **CP'nin açılışında** var (aynı sekmede ilk geçiş ve yeniden başlatma sonrası): 4,87 MB.
- ~~Her CP düzenlemesinden sonra 4,94 MB'lık `read-model/cp/computed` isteği oluşuyor (S1).~~ **Düzeltme (§6E):** Bu istek CP açılışının ilk hesaplanmış sütun yüklemesidir ve S1 adımına denk gelmiştir. Düzenleme onu tetiklemiyor.
- B1'in S2'de (B1 değerlendirmesindeki) cezalandırdığı desen, yani kayıttan sonra bütün dosya okuması, gerçek arayüzde Siparişler için **oluşmadı**.

**Kullanıcı bekleme (mevcut vs B1):**
- Açılış, geçiş ve kayıt onayında fark gürültü düzeyinde. Üç ham örnek de iç içe; L2 işaret kuralıyla değerlendirilmedi, yalnız gösterge.
- B1 sıkıştırmayı okuma yoluna taşıdığı yerlerde (S4 arama, S6a yeni sekme) 2,1–2,6 sn sıkıştırma süresi okumanın içinde. Toplam bekleme yine örtüşüyor, çünkü mevcut sistemde de aynı okuma yeniden yazımı bekliyor.
- **Risk [Doğrulandı: 1/3 B1 koşusu + düzeltme koşusu]:** CP okuma modeli isteklerinin (`cp/query`, `cp/facets`) düzenlemelerle iç içe geçtiği durumda B1 her okumada sıkıştırma yaptı.
  - Aykırı koşu: 12 sıkıştırma; 200 düzenleme 334 sn sürdü; 25 kayıt onayı 300 sn içinde gelmedi.
  - Düzeltme koşusu (CP doğrudan açıldı): 15 sıkıştırma; toplam CPU mevcut sistemle neredeyse aynı (99,1 vs 91,5 sn).
  - Kök neden **[Bilinmiyor]**. B1'in toplam CPU kazancı yalnız düzenlemeler arasında okuma olmadığında geçerli.

### 6D.2 · Veri güncelliği bulgusu (doğruluk, B1'den bağımsız)

**Bulgu [Doğrulandı: 6/6 koşu, iki kolda da].** CP'de Supp. FOB değiştirildikten sonra **aynı sekmede** Siparişler'e dönülünce tablo **eski değeri** gösteriyor (8,97, beklenen 777,77) ve **en az 20 sn** (ölçüm penceresi) öyle kalıyor. Kendiliğinden düzelme gözlenmedi. Siparişler aramasıyla sunucuya yeni sorgu gidince güncel değer geliyor (sorgu süresi 5,3–8,7 sn). Yeni sekme ve zorla yenileme de güncel gösteriyor.

**Mekanizma [Doğrulandı: source]:**
1. CP düzenlemesi yerel eşleri yalnız `state.orders` üzerinden günceller: `syncOrderLinePeersFromCpRow` → `orderLinePeerRows` (`public/app-main.js:12943-12957` ve `orderLinePeerRows` tanımı). Okuma modeli açıkken `state.orders` yüklü değil (S5'te `stateOrders:false`), yani güncellenecek eş satır yok.
2. Siparişler okuma modeli penceresi yalnız `orders-projection-loaded`, `server-orders-hydrated`, `server-orders-deferred` nedenleriyle geçersizleşir (`public/app-main.js:12754-12761`). CP düzenlemesi bunlardan biri değil.
3. Sunucu canlı satır yamasını yayar ama olay yazan istemcinin kimliğini taşır (`server/lib/live-events.js:26,146-176`). Yazan sekme kendi olayını yok sayar (`public/app-main.js:44466`).

Sonuç: Düzenlemeyi yapan sekmedeki Siparişler penceresi, kullanıcı filtre, arama ya da sıralama değiştirene veya sekmeyi yenileyene kadar eski değeri gösterir. Başka sekmeler ve cihazlar canlı yamayla güncellenir (S6a/S6b güncel).

**Ölçüm sınırları:**
- Uzun oturum ve yeniden başlatma sonrası güncellik kontrolünde (S7b, S8a) hedef satır sonraki düzenlemelerle üzerine yazıldı. S8a'da görülen 350,50, S7a'nın o satıra son yazdığı değerle aritmetik olarak tutarlı (ilk görünür satır: 200 + 150 + 0,5), yani güncel **[Muhtemel]**.
- S7b'de son düzenlenen siparişin aramada bulunamaması ve düzeltme koşusunda CP doğrudan açıldığında `Order Code` hücresinin okunamaması nedeniyle bu iki kontrol **[Bilinmiyor]** kaldı.

### 6D.3 · Karar

- **B1 ve B2 BLOCKED kalır.** Kabul ölçütleri değiştirilmedi.
- **B1'in uygulanabilirliği:**
  - B1'in FAIL olduğu "kayıttan sonra bütün dosya okuması" deseni gerçek arayüzde Siparişler için oluşmuyor.
  - Ama CP'nin kendi okuma modeli istekleri (`cp/query`, `cp/facets`, `cp/computed`) düzenlemelerle iç içe geçebiliyor. O durumda B1 her okumada sıkıştırıyor ve hem toplam CPU kazancı kayboluyor hem de bir koşuda kayıt onayları gecikti.
  - Bu yüzden B1, okuma modeli yolu günlüğü sıkıştırmadan okuyabilene kadar (B2 §6C'de yapı gereği BLOCKED) **uygulanabilir değil**.
- **Yeni ürün kararları gerekiyor:**
  1. **Güncellik hatası (öncelikli, doğruluk):** Düzenlemeyi yapan sekmede Siparişler penceresi eski veri gösteriyor. Düzeltme yönü ürün kararı: pencerenin yerel düzenlemede geçersizleşmesi mi, yoksa okuma modeli satırlarına yerel eş güncellemesi mi? İkincisi yeni bir uygulama döngüsü olmamalı (ilke 06).
  2. Her CP düzenlemesinden sonraki 4,94 MB `cp/computed` okuması, kayıt başına en büyük trafik. Gerekliliği ayrıca incelenmeli.
  3. B1 kodunun (`c800f90b`, bayrak kapalı) dalda tutulması ya da geri alınması.

## 6E · CP ↔ Siparişler veri akışı incelemesi (salt okunur, `b386cbe` = TEST 8.0.20)

**Ölçüm:** Tek koşu, bayrak kapalı, 30k sentetik veri, Playwright Chromium, gerçek DOM düzenlemesi (Supp. FOB). İstek ve yanıt gövdeleri yakalandı. Araç `scratchpad/o3/probe-e.js`; kod değişmedi.

**Gerçek akış (bir Supp. FOB düzenlemesi; ms ve bayt ölçülmüş, kanıt etiketiyle):**
1. **Kayıt:** `PATCH /api/overrides/<kod>`, onay 305–361 ms **[Doğrulandı]**. Sunucu override belgesini yazar, projeksiyon yeniden yazımını kuyruğa alır (`queueProjectionCacheRowPatches`) ve canlı yamayı diğer istemcilere gönderir.
2. **Projeksiyon yeniden yazımı:** cp, orders, order-summary ve overview modüllerinin bütün dosyaları, ≈ 6,5 CPU-sn (§6A.2) **[Doğrulandı]**. Duvar süresi bu koşuda yaklaşık 3–3,9 sn (aşağıdaki kalan süreden) **[Muhtemel]**.
3. **İstemci CP:** `cpRowSaveSettled` → `cpRMInvalidate('row-save')` → `cp/query` (4 KB). Sunucu yeni nesilde CP veri kümesini yeniden yükler (`loadMs` 0,91–1,06 sn) ve kararları hesaplar (`computeMs` 2,35–3,89 sn, `reused:false`) **[Doğrulandı: yanıt timing]**. **Düzeltme (§6F):** `computeMs` karar hesabı değildir. Aynı yanıtların `phases` alanı: E2'de `decisionMs` **1,24 ms** (`incremental {changed:1, targets:1}`), `sourceMs` **1.355 ms** (24.982 satırın içerik özeti) ve hizmet `leaseMs` 2.906 ms (yeniden yazımı bekleme), `rowPatch.miss:"no-chain"`. Yalnız Q8 tam hesaptı (`decisionMs` 2.438 ms); nedeni E3'ün `503 COMPUTE_ESTIMATE_EXCEEDED` ile düşmesi ve işçinin barındırıcısıyla birlikte emekli edilmesidir **[Doğrulandı: yanıt timing + §6F yeniden üretim]**. Supp. FOB karar girdisi değil (`computePriorityFlags` girdileri, §3 T9) **[Doğrulandı: source]**, yani bu hesap bu düzenleme için gereksiz.
4. **İstemci Siparişler (#1232):** `buyerlog:cp-write-ack` → pencere geçersizleşir → geçişte 1× `orders/query` (534 KB). İstemcide 3,84–4,80 sn sürer; bunun **0,85–0,95 sn'si işçide veri kümesi yeniden yüklemesi**, **13 ms'si sorgu**, kalan **~3–3,9 sn'si işçi öncesi sunucu beklemesi**: `ensureComputedProjection` → `readProjectionCompressed` → `pendingRewritesSettled`, yani yeniden yazımın bitmesini beklemek **[Doğrulandı: timing + source; bekleme payı kalan süreden çıkarıldı, Muhtemel]**. Önceki doğrulamadaki 6,3–9,4 sn aynı yapıdadır ama daha yüklü bir anda ölçülmüştür.
5. **`cp/computed` (soru 1–3):** 5,07 MB'lık tam yanıt yalnız **CP açılışında** bir kez geliyor (`since` yok, 24.982 satır, sunucu 3,15 sn, `decisionMs` 2,77 sn). Üç düzenleme ve bir çift düzenlemeden sonra **hiç `cp/computed` isteği olmadı** **[Doğrulandı: 1 koşu]**. §6D'deki atıf düzeltildi.
   - İstemci yanıttan yalnız FIELDS alanlarını `_id` ile satırlara uygular: `id, priority, calculationStatus, trackingTags, priorityTags, actionReasons, signals, basePriority, checklist, orderKey, optionId` (`cp-computed-task.js:42`, `app-main.js` `applyCpComputedColumns`).
   - Delta mekanizması zaten var: `since` token'ı ve işçide satır özeti geçmişi (`cp-computed-task.js:385-394`). İstemci `applied.rows===rows` olduğunda `since` gönderiyor (`app-main.js:1624-1627`).
   - Tam yanıtın değişmiş kısmı (soru 2) ölçülemedi, çünkü düzenleme sonrası tam yanıt oluşmadı. Soru 2'nin dayandığı varsayım ölçümle çürüdü.

**Sorulara kısa cevaplar:**
- **S1–S3:** `cp/computed`'ı tetikleyen düzenleme değil, CP açılışı (yukarıda).
- **S4:** Tam veri yanıtı olmadan iş davranışı korunabilir. Düzenleme sonrası tam yanıt zaten yok. Supp. FOB'a bağlı hesaplanmış sütun yok; tarih, Del. Type ve statü ise karar girdileri **[Doğrulandı: source]**.
- **S5:** Bekleme ≈ yeniden yazım beklemesi (~3–3,9 sn) + Siparişler veri kümesi yeniden yüklemesi (0,85–0,95 sn) + sorgu (13 ms) + 534 KB aktarım. Sıkıştırma yok (bayrak kapalı).
- **S6:**
  - Canlı olaylar yazan sekmeyi bilerek atlıyor; #1232 bunu yeniden sorguyla çözdü.
  - `projection-row-patch` satır düzeyinde ama sonucu bütün dosya olarak yazıyor, ve okuma modeli okuması bu yazımı bekliyor.
  - `derived-input-keys` ve nesil anahtarı, override değişince yeni nesil üretiyor. Okuma modeli işçisi veri kümesini nesil anahtarıyla tuttuğu için her düzenlemede baştan yüklüyor.
  - Bellekte "taban + yama" yalnız CP hesaplanmış yolunda var (§6C).
- **S7:** Evet, aynı değişiklik birden çok yerde yeniden işleniyor **[Doğrulandı]**:
  - (i) dört modülün bütün dosya yeniden yazımı;
  - (ii) Siparişler işçi veri kümesinin baştan yüklenmesi (~0,9 sn);
  - (iii) CP işçi veri kümesinin yeniden yüklenmesi (~1 sn), bütün satırların içerik özeti (~1,35 sn) ve yeniden yazımı bekleme (~2,9 sn). Karar hesabı zaten artımlıdır (değişen satır + sipariş/opsiyon grubu, ~1 ms); ~~bütün karar sütunlarının yeniden hesabı (2,3–3,9 sn), alan karar girdisi olmasa bile~~ yanlış atıftı (§6F).
  - Genel Bakış bu akışta açılmadı, ölçülmedi.
- **S8:** Eski yanıtın yeniyi ezmesine karşı mevcut korumalar **[Doğrulandı: source]**:
  - `cp/computed`: `isCurrent` kontrolü (`app-main.js:1621-1632`, `CP_COMPUTED_STALE_RESULT`).
  - Siparişler: `ordersRMInvalidate` `seq`/`epoch`'u artırır, yanıt `seq` eşleşmezse atılır.
  - Ölçüm: <200 ms arayla iki düzenleme tek kayda birleşti. Siparişler önce eski, sonra son değeri gösterdi; ara değer hiç görünmedi.
  - Ezme gözlenmedi; tek senaryo, tek koşu.

**Değerlendirme (a → c):**
- **(a) Mevcut mekanizmayı iyileştirme — en küçük uygulanabilir adım:** Düzenlenen alanlar karar girdisi değilse (Supp. FOB, not, lisansör…) CP okuma modeli **karar sütunlarını yeniden hesaplamasın**, yani önceki nesildeki hesap yeniden kullanılsın. Girdi kümesi `computePriorityFlags` ve checklist girdilerinden statik olarak çıkarılabilir.
  - Etki: bu düzenleme türlerinde kayıt başına 2,3–3,9 sn işçi CPU'su gider **[Hipotez: ölçülmedi]**. **§6F'de çürüdü:** artımlı plan zaten içerik tabanlı; karar girdisi olmayan düzenlemenin karar maliyeti ~1 ms. Kazanılabilecek süre karar hesabında değil, kira beklemesi + veri kümesi yüklemesi + tam özettedir.
  - Risk: girdi kümesi eksik çıkarılırsa bayat öncelik oluşur. Bu yüzden önce gölgede eski hesapla karşılaştırma gerekir (V4 doğruluk sınırı: global/ortam okumaları).
- **(b) Alternatif mevcut mekanizma:** Siparişler okuması için `cp-row-patch-log` sanal veri kümesinin kullanılması. §6C'de "ikinci uygulama döngüsü" gerekçesiyle BLOCKED; O2 olmadan önerilmez.
- **(c) Tam veri aktarımını kaldırma:** Düzenleme sonrası tam veri aktarımı zaten yok. Asıl maliyet aktarım değil, **sunucu tarafında yeniden üretim** (bütün dosya yeniden yazımı ve veri kümelerinin yeniden yüklenmesi). Bunu kaldırmanın yolu B1/B2'nin konusu ve BLOCKED.

**Ayrı bulgu — veri güncelliği ve UX [Doğrulandı: ölçüm]:** #1232 sonrası Siparişler doğru değere dönüyor. Ama yeniden sorgu bitene kadar (bu koşuda 3,8–4,8 sn, önceki doğrulamada 6–9 sn) tablo **eski değeri uyarısız** gösteriyor. Bu bir doğruluk/UX bulgusudur; sorgu performansının yerine geçmez.
- **En küçük çözüm önerisi:** Kod bu incelemede yazılmadı.
  - Geçersizleştirme ile yeni yanıt arasında tabloyu gizlemeden `#ordersTable` üzerinde `aria-busy="true"` ayarlanır.
  - Araç çubuğunda mevcut `uiState--loading` ya da `aria-busy` deseniyle küçük bir durum etiketi gösterilir: **"Güncelleniyor…" / "Updating…"**. Bu desen bugün toplam hücresinde kullanılıyor (`app-main.js:8889`).
  - Görünüş ve kayboluş için BLMotionPlus'ın ortak solma sınıfı kullanılır (DESIGN_SYSTEM §6). `prefers-reduced-motion` korunur.
  - Yanıt gelince ya da `seq` atlanınca etiket kaldırılır.
  - `setOrdersLoadingState(true)` kullanılmamalı: tabloyu boş durumla değiştirir, veriyi gizler.

---

## 6F · CP karar pilotu, modüller arası geçersizleştirme ve Siparişler görünüm geçerliliği (2026-11-27)

**Kapsam:** Ürün sahibi kararı; küçük ve yalıtılmış. Pilot dalı `claude/cp-karar-pilot`, commit **`06095e1c`** (`b386cbe` üstü), bayrak `BUYER_LOG_CP_ROWPATCH_LEGACY=1`, **varsayılan kapalı**. PR, merge, TEST, STABLE yok. B1/B2 BLOCKED kalır. Siparişler güncellik göstergesi ana oturumun dalında; bu bölüm `ordersRM*` koduna dokunmaz. Araçlar ve ham sonuçlar: `docs/design-proposals/adr-0003-kanit/6f/`.

### 6F.1 · Varsayım düzeltmesi: karar hesabı zaten içerik tabanlı ve artımlı

- **[Doğrulandı: source]** `cp-computed-task.js` `ensureComputed`, yeni nesilde önceki sonucu yalnız imza aynıysa kullanır. İmza `[answersVersion, tasksSignature, yerel gün]`. Yapılandırma, kurallar, PLM, transit kuralları, dil, kullanıcı ve kapsam barındırıcı anahtarındadır (`hostKeyOf`); değişince yeni barındırıcı ve tam hesap yapılır.
- Satırın tamamı, hesaplanmış alanlar hariç, `rowDigest` ile özetlenir. Artımlı plan şunları hedefler: kaynak özeti değişen satırlar + aynı sipariş/opsiyon grubundaki satırlar (`incrementalPlan`).
  - Yani "veri değişti" ile "karar girdisi değişti" ayrımı alan listesiyle değil, **satır içeriğiyle** yapılıyor.
  - Karar girdisi olmayan bir alan değişince yalnız o satır ve grubu yeniden hesaplanır.
- **[Doğrulandı: ölçüm]** E2 (Supp. FOB): `decisionMs` 1,24 ms (`changed:1, targets:1`). Bu pilotta: `decisionMs` medyanı 1 ms (aralık 1–9 ms).
  - Daraltılmış bir "karar girdisi" alan kümesi en fazla ~1 ms kazandırır. Karşılığında bayat öncelik riski taşır. **Önerilmez ve yapılmadı.**
- **[Doğrulandı: ölçüm]** Kullanıcının tablosundaki "karar 2,35–3,89 sn" iki kaynaktan geliyor:
  - (a) Düzenleme sonrası ilk okuma `503 COMPUTE_ESTIMATE_EXCEEDED` ile düşüyor. İşçi emekli ediliyor, barındırıcı ve önceki sonuç kayboluyor, sonraki okuma **soğuk tam hesap** yapıyor (Q8 deseni).
  - (b) Artımlı yolda `sourceMs` ≈ 1,4–1,65 sn: 24.982 satırın tamamı yeniden özetleniyor.
  - Bu kayıt yolunda satır yaması günlüğü hiç kullanılmıyor. Neden: Supp. FOB/fiyat kaydı eski `PATCH /api/overrides/:kod` yolundan gidiyor ve bu yol `cp-row-patch-log`'a yazmıyor (`rowPatch.miss:"no-chain"`).

### 6F.2 · Pilot: eski kayıt yollarını mevcut satır yaması günlüğüne bağlamak

- **Değişiklik** (`server.js`, ~20 satır): `PATCH /api/overrides/:kod`, `/batch` ve `/batch-suppfob` artık:
  - okuma bağlamı damgasını **yazımdan önce** alır;
  - yazımın hemen ardından yamayı mevcut `recordCpRowPatches` ile günlüğe ekler;
  - `rowPatch`'i projeksiyon yeniden yazımına geçirir (`settle` → mevcut `verifyRows`).
- **Yeni motor yok.** Alan kuralı, uygulama, zincir ve doğrulama `POST /rows` (cp-row-save) ile aynı kod.
  - Güvenli olmayan tek bir öğe bile varsa kayıt yapılmaz (`subManufacturer`, `licensor`, `pricingRestore`…). Okuma bugünkü yola döner.
- **Kapsam dışı bırakılan:** `importance` yaması.
  - **[Doğrulandı: test]** Günlüğün kayıtlı bağlamı `importancemap` ve önem ayarlarını taşımıyor. Sanal satır gerçek nesilden farklı çıkıyor.
  - Bu, doğrulamanın yakalayacağı ama ilk okumada yanlış değer gösterecek bir boşluktur. Bugüne kadar görünmüyordu, çünkü satır kaydı bu alanı yazmıyor.
- **Bulunan ve düzeltilen pilot hatası:** İlk sürüm damgayı yazımdan sonra alıyordu (damga paylaşılan revizyonu içerir). Zincir hiç kurulmadı.
  - Gerçek sunucu duman koşusu bunu yakaladı. Süreç içi testler sunucu kablolamasını görmediği için kaçırmıştı.
  - Kalıcı önlem: kaynak sözleşmesi testi şunları denetliyor: sıra (bağlam → damga → yazım → kayıt → yeniden yazım), araya `await` girmemesi, aynı yamanın kullanılması.

### 6F.3 · Gölge doğrulama: 0 fark

**[Doğrulandı: test]** `tests/cp-decision-pilot-shadow-v20261127.test.js` (2k fixture, iki yetki kapsamı). Her adımda pilot sonucu (sanal yama + artımlı karar) aynı gerçek nesil üzerinde **ayrı, sıfır durumlu barındırıcıda tam hesapla** karşılaştırılır: satır özeti ve sonuç demeti.

| Senaryo | Sonuç |
|---|---|
| Karar girdisi olmayan: Supp. FOB (manuel/kural), not | 0 fark; hedef = değişen satır (+grup) |
| Doğrudan karar girdisi: Ex-factory, Retail, In-Store, Del. Type | 0 fark; sonuç gerçekten değişti (boş parite değil) |
| Dolaylı: aynı opsiyonu paylaşan satırlardan biri | 0 fark; hedef > değişen (grup kapanışı) |
| Çoklu hücre: tek kayıtta 60 satır | 0 fark |
| Ardışık ve eşzamanlı: 3 kayıt tek okuma, aynı hücre A→B; 3 ardışık okuma | 0 fark; son değer kazanır |
| Gün dönümü (kaydırılabilir saat) | tam hesaba düşer; 0 fark |
| Yapılandırma (transit kuralı) | yeni barındırıcı + tam hesap; 0 fark |
| Başka kullanıcının kaydı | zincir kurmaz → projeksiyon kirası (gerçek nesil) |

**Sınır (§6G'de bulundu):** Bu testin "tam hesap" tabanı, aynı **artımlı** yama fonksiyonuyla (`applyIncrementalProjectionPatch`) yamalanmış veri üzerinde yapılır. Yani karar hesabının artımlı ↔ tam eşitliğini kanıtlar, **artımlı yama ↔ tam projeksiyon kurulumu** eşitliğini kanıtlamaz. Mevcut `read-model-cp-row-patch` paritesinde de aynı kör nokta var. Tam kurulumla karşılaştırma §6G'de önceden var olan bir Del. Type hatasını gösterdi.

Ek olarak üç pilot koşusunun son okumasında mevcut `verifyRows` (gerçek neslin yamalı satırları ↔ işçideki sanal satırlar) çalıştı: `verified:true`, uyuşmazlık yok **[Doğrulandı: 3/3 koşu]**.

**Gerçek sunucuda kapsanmayanlar** (çok kullanıcılı sunucu ve saat kaydırma koşulmadı):
- başka kullanıcı
- gün dönümü
- yapılandırma

Bunlar süreç içi testle kanıtlandı.

### 6F.4 · Ölçüm (L2)

**Kurulum:**
- Sabit commit `06095e1c`. Tek değişken bayrak.
- Sıra A B B A A B: 3 çift, her koşu taze sunucu.
- 30k sentetik (seed 7, CP 24.982 satır).
- Gerçek istemci Supp. FOB gövdesi (`{model, ccode, notes, delType, suppFob, suppFobMeta}`, Playwright ile yakalandı).
- Koşu başına 6 kayıt + 1 çift kayıt. Her kayıttan hemen sonra: `cp/computed since` (istemcinin onay sonrası isteği), ardından `orders/query`.
- Kayıtlar arası 14 sn. CPU: sunucu süreci (`/proc`), pencere = kayıt + okumalar + arka plan yeniden yazımı.

| Ölçü (koşu medyanı) | Kapalı | Açık | Çift farkı (açık−kapalı) |
|---|---|---|---|
| Kayıt → CP karar sütunları yanıtı | 6.858 / 7.049 / 6.932 ms | 247 / 207 / 285 ms | −6.611 / −6.842 / −6.647 |
| CP okuması başarısız (503) | 10 / 21 | 0 / 21 | — |
| `decisionMs` | 2.583 / 2.920 / 2.764 | 2 / 1 / 1 | −2.581 / −2.919 / −2.763 |
| CP veri kümesi yeniden yükleme `loadMs` | 1.204 / 1.073 / 1.233 | 0 / 0 / 0 | −1.204 / −1.072 / −1.232 |
| Yeniden yazımı bekleme `leaseMs` | 2.385 / 2.269 / 2.263 | 0 / 0 / 0 | −2.385 / −2.269 / −2.263 |
| Pencere toplam sunucu CPU | 15.650 / 16.340 / 16.250 ms | 9.720 / 9.350 / 10.360 ms | −5.930 / −6.990 / −5.890 |
| Kayıt → CP + Siparişler ikisi de hazır (ardışık) | 8.082 / 8.468 / 8.162 ms | 3.517 / 3.469 / 3.937 ms | ≈ −4,6 sn |
| `orders/query` (kendi başlangıcından) | 1.096 / 1.194 / 1.134 | 3.238 / 3.248 / 3.643 | +2,1 / +2,1 / +2,5 sn |

**Veri eşitliği [Doğrulandı]:** CP hesaplanmış sütun demetlerinin özeti, her adımda ve son tam okumada **6 koşunun 6'sında aynı** (`52aa7fa77911…`).

**Yorum ve sınırlar:**
- **Kazanç [Doğrulandı: bu ortam].** Kapalı kolda CP okumasının yarısı 503 ile düşüyor, kalanı soğuk tam hesap yapıyor. Açık kol bu yolu hiç çalıştırmıyor. Bu yüzden kazanç büyük oranda "503 + soğuk tam hesap + kira beklemesi"nin ortadan kalkmasıdır, karar hesabının hızlanması değildir.
- **503 sıklığı [Bilinmiyor].** Sıklık bu kapsayıcının hesaplama havuzu bellek bütçesine bağlı. Kullanıcı makinelerindeki sıklık ölçülmedi.
- **503'ün kök nedeni [Hipotez].** Sıcak barındırıcıyla yeni nesil yüklenirken `datasetLoadEstimate` önceki neslin bellekte tutulan satırlarını (`entry.current.rows`, karşılaştırma için) hesaba katmıyor. Ayrı karar konusu; düzeltilmedi.
- **`orders/query` artışı ek maliyet değil, bekleme kayması.** Kapalı kolda Siparişler sorgusu, CP okuması yeniden yazımı zaten beklediği için yazım bittikten sonra başlıyor. Açık kolda CP hemen döndüğü için Siparişler sorgusu yeniden yazımı kendisi bekliyor.
  - Kayıttan Siparişler hazır olana kadar geçen süre açık kolda ~3,3–3,9 sn. Bu, §6E'nin bayrak kapalı tek koşusundaki 3,84–4,80 sn ile aynı büyüklükte.
  - Siparişler'i hızlandırmıyor, yavaşlattığı da gösterilmedi.
  - **[Muhtemel]:** Kapalı kolda "yalnız Siparişler" senaryosu bu protokolde ölçülmedi.
- **Kabul:** Pilotun hedefi olan ölçümler PASS:
  - CP bekleme, karar hesabı, veri kümesi yüklemesi, CPU: 3/3 çiftte aynı yönde, büyük fark;
  - veri eşitliği ve gölge fark 0.
  - Siparişler bekleyişi kapsam dışı ve değişmedi.
  - Bayrağı varsayılan açmak ayrı karar ister.

### 6F.5 · Modüller arası geçersizleştirme: neden bir hücre 4 modül dosyası + 2 veri kümesi?

**[Doğrulandı: source]**
- `runRowRewriteBatch` önceki nesildeki **bütün modülleri** (cp, overview, orders, order-summary, collection-catalog) okuyup işçide açar. Yamayı `projectionPatchMatches` ile **sipariş/satır kimliğine** göre uygular.
- Bir modülde eşleşen satır varsa o modülün **bütün dosyası** yeniden serileştirilip sıkıştırılır. Eşleşme yoksa eski baytlar taşınır (`changed=false`).
- Ardından **yeni nesil** (`activeGeneration`) yazılır.
- Okuma modeli veri kümesi anahtarı `activeGeneration:<modül checksum>`. Nesil değişince içeriği değişmeyen modülün veri kümesi bile yeniden yüklenir.

| Ne | Gerçekten etkilenen | Gereksiz geçersizleşen |
|---|---|---|
| Projeksiyon dosyası | Düzenlenen satır: cp, orders, order-summary (§6A eşitlik ölçümü: bu üçü değişti) | Değişen modüllerin **diğer bütün satırlarının** yeniden serileştirilmesi; değişmeyen overview/collection-catalog'un yine açılıp ayrıştırılması |
| CP veri kümesi | 1 satır | Bütün veri kümesinin yeniden çözülmesi (~1,0–1,2 sn) + bütün satırların özeti (~1,4–1,65 sn). **Pilotla eski kayıt yollarında kalktı** (yukarıda) |
| Siparişler veri kümesi | 1 satır (Supp. FOB Siparişler'de görünür) | Bütün veri kümesinin yeniden çözülmesi (0,84–1,57 sn, bu ölçüm) ve yeniden yazımın beklenmesi |
| Değişmeyen modülün veri kümesi | yok | Anahtarda `activeGeneration` olduğu için yeniden yükleme **[Muhtemel]**: Genel Bakış bu akışta açılmadı |

**Mevcut mekanizmaların yeniden kullanılabilirliği (öneri; kod ayrı karar):**
1. **Satır yaması günlüğü + sanal veri kümesi** (CP'de var, pilotla genişledi): Siparişler okuma modeline taşınması, 13 ms'lik sorgudan önceki 2–3 sn'lik yazım beklemesini ve ~1 sn yüklemeyi kaldırır. Ancak §6C'deki "ikinci uygulama döngüsü" itirazı burada da geçerli. Önce CP pilotunun sahada bayrakla doğrulanması gerekir. **[Hipotez: ölçülmedi]**
2. **İçerik anahtarı:** Veri kümesi anahtarından `activeGeneration`'ı çıkarıp modül checksum'ı + kullanıcı/erişim anahtarıyla tutmak. Değişmeyen modülün yeniden yüklenmesini kaldırır. Risk: checksum'ın sıkıştırılmış baytların kimliği olduğunun ve erişim kapsamının anahtarda kaldığının kanıtlanması. **[Hipotez]**
3. **live-events:** Diğer istemcilere `rowPatches` zaten gidiyor. Yazan sekme kendi olayını atlıyor (#1232). Sunucu tarafı yeniden üretimi azaltmaz.
4. **Dosya düzeyi tam yeniden yazım:** Granülerlik sorunu B1/B2'nin konusu. BLOCKED kalır.

### 6F.6 · Siparişler görünüm geçerliliği: bir veri değişikliği görünümü gerçekten geçersiz kılıyor mu?

**Görünümün bağımlılıkları mevcut tanımlardan kısmen çıkarılabiliyor [Doğrulandı: source].** `ordersReadModelSpec` / `ordersRMQueryBody` şunları açıkça adlandırıyor:
- filtre anahtarları (sütun filtreleri, boyut filtreleri, üst seçiciler, Active/Inactive, `status/del/season/exf` grupları, seçili satır filtresi `_id in`);
- `sort.key`;
- `search`. Arama, `columns` içindeki **bütün görünen sütunların** metninde yapılır; arama açıksa her görünen alan bağımlılıktır.
- Facet isteği: `kpi:true` (pri/status/del/season/exf sayaçları), `sums:['Order Quantity']`, `footer` (`visibleCols` içindeki miktar sütunları + `cpOrdersAverageFooterCols` ortalamaları + seçim) ve `distinct`.

**Kesin belirlenemeyen kısım [Doğrulandı: source].** Türetilmiş sütunların ham girdileri bildirimsel bir yerde yok, kodda gömülü:
- `applyFormulas` (Ex→Retail, LT), lojistik segment, Priority ve fiyat kuralı;
- `ORDERS_RM_CLIENT_DERIVED_KEYS` (`Priority`, `Supp. FOB`, `Licensor`, `Ex→Retail`, `LT`) ve `syncOrderLinePeersFromCpRow`'un `allowed`/`scheduleChanged` kümeleri zaten **elle tutulan alan listeleri**;
- `derived-input-keys` alan düzeyinde değil; bütün kaynak, override ve gün özetini veriyor.

Bu yüzden "bu değişiklik bu görünümü etkilemez" kararı, elle tutulan alan listesi olmadan güvenilir biçimde verilemez. Örnek: KPI `pri` sayacı her istekte var ve tarih/Del. Type'tan türeyen Priority'ye bağlı.

**Paylaşılan nesne kimliğinin sınırları [Doğrulandı: source]:**
- Pencere satırları ancak `ordersRMAdoptFullRows` sonrası `state.orders` nesneleridir. Koşulu: tam satırlar yüklü ve `_id` + `_matchOcode` + `Order Code` + `C.Code` tutuyor.
- Hazırlıktan önce paylaşılan nesne yok.
- `server-orders-deferred` geçersizleştirir ama **adopt etmez**.
- `server-orders-hydrated` ve `orders-projection-loaded` yeni nesnelerle adopt eder.
- Uzak cihaz yaması (`applyRemoteRowPatches` → `remoteRowLists`) `state.orders` satırlarını yerinde günceller. Sunucu veri kümesini, pencere üyeliğini, sıralamayı ve sayaçları güncellemez.
- Okuma modeli açma/kapama ve epoch: `ordersRMInvalidate` her şeyi atar.
- 400 → eski yol: pencere yok, eski tam tablo yolu.
- Yerinde güncelleme yalnız değeri tazeler. **Üyelik, sıra, sayfalama, sayaç ve toplamlar** sunucunun eski veri kümesinden kalır.

**Yanıt:**
- Değer düzeyinde, adopt edilmiş satırlarda yerinde güncelleme doğru değeri ~1 sn'de gösteriyor (ana oturum bulgusu). Bu durumda yeniden sorgu yalnız şunlar için gerekli: üyelik/sıra (filtre, arama, sıralama), sayaçlar/toplamlar/facet'ler ve türetilmiş sütunlar.
- Bunların hangisinin etkilendiğini alan listesi olmadan güvenilir bilmenin yolu yok. Tek içerik tabanlı alternatif, sorguyu yeni veride yeniden çalıştırıp karşılaştırmak, yani bugünkü yeniden sorgunun kendisi.

**En küçük uygulanabilir çözüm (öneri; kod yok):**
- Yeniden sorguyu **koru**.
- Kullanıcı tarafını, ana oturumun güncellik göstergesiyle karşıla: eski değer uyarısız kalmasın.
- Maliyet tarafında yeniden sorgunun kendisini değil, **önündeki beklemeyi** hedefle: yukarıdaki 1. ve 2. öneriler (sanal veri kümesi / içerik anahtarı).
- Görünümün etkilenmediğini önceden tahmin eden bir kısa devre **önerilmez**.

## 6G · Pilot PR öncesi doğrulama, 503 kök nedeni, modül geçerlilik anahtarı (2026-11-27)

**Sabit commit:** pilot `06095e1c` (değişmedi). Araçlar ve ham sonuçlar: `docs/design-proposals/adr-0003-kanit/6g/`.
- Ölçüm/arıza kancası `hook.js` repo dışıdır, `NODE_OPTIONS=-r` ile yüklenir ve ürün kodunu değiştirmez.
- Saat kaydırma da bu kancadadır. Barındırıcılar kurulmadan önce aynı `Date` yapıcısına yerleşir.

### 6G.1 · Doğrulama tablosu

| Kontrol | Sonuç | Kanıt |
|---|---|---|
| Tam `npm test`, bayrak kapalı (bu ortam) | 1 gerçek hata: `runtime-package-scope:32`. Nedeni çalışma ağacında `node_modules`'un sembolik bağ olması (ortam). 3 collection-sync ✖ işareti **todo** testleri, başarısızlık sayılmıyor (`fail 1 · todo 3`). **Düzeltme:** ilk yazımda "FAIL (4 test)" denmişti, yanlıştı. | `ham/tam-test-kapali.txt` |
| Tam `npm test`, bayrak açık (bu ortam) | Aynı, başka fark yok | `ham/tam-test-acik.txt` |
| Tam `npm test`, temiz kurulum (`npm ci`), bayrak kapalı ve açık | PASS, 1548 dosya **[Ana oturum bildirdi; bu oturumda yeniden koşulmadı]** | PR #1236 |
| Gerçek sunucu: ardışık 3 kayıt, `/batch` (5 satır, 2 Del. Type), `/batch-suppfob` (5), aynı opsiyon | PASS: sanal yol, kira 0, karar 0,5–1,3 ms | `ham/senaryo.json` P1–P2 |
| importance tek başına / importance + Supp. FOB / importance sonrası başka alan | PASS: importance zinciri kurmaz (`no-chain` → kira); sonraki kayıt yine sanal | P3a–c |
| 409 bayat revizyon / 403 yetkisiz | PASS: kayıt reddedildi, günlüğe yazılmadı, okuma değişmedi | P4a–b |
| Başka kullanıcı (ikinci moderatör oturumu) | PASS: A'da `no-chain` → kira (gerçek nesil); A'nın sonraki kaydı yine sanal | P5, P5b |
| Yapılandırma (`PUT /api/transit-rules`) | PASS: yeni barındırıcı + tam hesap | P6 |
| Gün dönümü (+1 gün saat) | PASS: ilk okuma tam hesap, sonraki kayıt sanal | P7 |
| Günlük kaydında istisna | PASS: kayıt 200, okuma `no-chain` → kira | P8a |
| `verifyRows` uyuşmazlığı (settle satırı bozuldu) | PASS: ilk okuma sanal; settle sonrası `miss:"mismatch"` → kira + tam hesap | P8b |
| Yeniden yazım başarısız (`settle ok:false`) | PASS: `miss:"rewrite-failed"` → kira | P8c |
| Kontrol noktaları K1–K3 (SIGTERM yeniden başlatma → soğuk tam hesap) | PASS: sonuç özeti 24.982 satırda eşit, dokunulan 21/22/25 satırda satır farkı 0 | `checks` |
| K4: kayıttan hemen sonra SIGKILL | Kayıt kalıcı (değer 999 mevcut), sonuç özeti eşit; **2 satırda satır alanı farkı** → 6G.2 | K4, K5 |

**Not:** K1–K3'te SIGTERM, projeksiyon önbelleğini (artımlı yamalanmış nesil) korur. Yalnız K4 (SIGKILL) tam kurulumu zorladı ve farkı o gösterdi.

### 6G.2 · Önceden var olan veri doğruluğu hatası (P1, pilottan bağımsız)

**[Doğrulandı: gerçek sunucu, alan düzeyi; bayrak kapalı ve açık birebir aynı]** `kill.js` üç görünümü karşılaştırır:
- V1: kayıttan hemen sonra;
- V2: yeniden yazım bittikten sonra (artımlı nesil);
- V3: projeksiyon önbelleği silinip tam kurulum.

Sonuç: **V1 = V2** (pilot, artımlı yeniden yazıma sadık). **V2 ≠ V3**, Del. Type düzenlenen iki satırda:
- **satır 408** (`PATCH` Del. Type Gemi→Uçak): artımlı nesilde `Del. Type` "Gemi", `Ant. Arrival` 2027-03-31 kalıyor. Tam kurulumda "Uçak" / 2027-02-04.
- **satır 202** (`/batch` Del. Type Kamyon): `_logisticSegments`, `_logisticDelTypeValues`, `_logisticArrivalValues` eski kalıyor.

**Kök neden [Doğrulandı: source]:**
- `applyIncrementalProjectionPatch` (`projection-row-patch.js`) `row['Del. Type']`'ı yazıp `applyFormulas` çalıştırıyor, ama `_logisticSegments`'i güncellemiyor.
- Okuma modeli işçisi `prepareCpRows` → `rebuildLogisticCaches` (`overview-row-prep.js:53-56`) ise `Del. Type`, `Ant. Arrival`, `STATUS` ve `HANDOVER Tarihi`'ni birincil segmentten **yeniden yazıyor**. Düzenleme geri dönüyor.
- İstemcide aynı işi `syncCpProductionLogisticSegment` (`app-main.js:7576`) yapıyor; sunucuda karşılığı yok.

**Etki:**
- CP okuma modeli bu satırların kararını ve pencerelerini eski Del. Type / Ant. Arrival ile üretiyor. Bir sonraki tam projeksiyon kurulumuna kadar sürüyor.
- Override kaydı doğru, kayıp yok.
- `POST /rows` aynı yama fonksiyonunu kullanıyor; o yolun da etkilenmesi **[Muhtemel]**, ayrıca ölçülmedi.

**Neden kaçtı:** Hem `read-model-cp-row-patch` paritesi hem §6F gölge testi tabanı aynı artımlı fonksiyonla kuruyor (6F.3 sınır notu).

**Öneri (kod yok, ayrı karar):**
- Sunucu yamasına istemcideki segment eşitlemesinin karşılığını tek tanımla eklemek;
- ya da segmentli satırda `delType` / `dates` yamasını artımlı-güvensiz sayıp tam yola düşürmek.
- Her iki durumda da regresyon testinin tabanı **tam kurulum** olmalı.

### 6G.3 · 503 `COMPUTE_ESTIMATE_EXCEEDED` kök nedeni (salt okunur + ölçüm)

**Karar yolu [Doğrulandı: source]:**
- `compute-pool.js:77-79`: işçi yanıtındaki `retainedBytes + outputBytes > slot.residentBytes + job.estimatedBytes` ise ya da bütçe aşılıyorsa `retire(slot, COMPUTE_ESTIMATE_EXCEEDED)`. İşçi sonlandırılır.
- Barındırıcılar, veri kümeleri ve `entry.current` kaybolur; sonraki okuma soğuk tam hesap yapar.
- `retainedBytes`, `read-model-worker.js:72/83`'te `process.memoryUsage().heapUsed + arrayBuffers` olarak, **çöp toplama olmadan** iş bitiminde ölçülür.
- Bütçe `read-model-pool.js:31`: `min(1 GiB, RAM/4)` → bu makinede 1 GiB; ≥4 GB RAM'li her makinede 1 GiB.

**Tahmine dahil olan/olmayan [Doğrulandı: source]:**
- Sıcak veri kümesi yükleme tahmini `datasetLoadEstimate` = `96 MiB + 6 × sıkıştırılmamış + girdi` (≈491 MB, 30k).
- Dahil değil:
  - (i) yeni veri kümesi kurulurken bellekte kalan **önceki nesil satırları** (`entry.current.rows`, `previous.source`/`out` Map'leri). İş bitene kadar yaşar, iş sonunda çöp olur.
  - (ii) önceki işin **toplanmamış çöpü**. `heapUsed` bunu sonraki işe yazar.

**Ölçüm [Doğrulandı: kanca, gerçek sunucu, 30k]:**
- Veri kümesi yükleyen iş sonrası "retained" **571–795 MB**.
- Bir sonraki ucuz işte, veri değişmeden **205–260 MB** (GC sonrası canlı küme).
- Aşım örnekleri:
  - yükleme işi: sınır 751 MB, ölçülen 776 MB;
  - ardından gelen `warmOnly` işi: tahmin 96 MB, sınır 368–722 MB, ölçülen 575–795 MB.
- Yani 503'ün bir kısmı, **işin kendisinin değil, önceki işin çöpünün** bu işe yazılmasıdır **[Güçlü çıkarım: aynı veriyle ardışık ölçümlerde 575 → 256 MB düşüş]**.

**Bütçe sığmayınca ikinci yol:** `reserved = workerBase + resident + aktif + …`. Şişkin `resident` (≈574–648 MB) + 491 MB tahmin bütçeyi aşıyor. Havuz boştaki işçiyi kapatıp yer açıyor; barındırıcı düşüyor ve soğuk tam hesap oluyor. Bu, P3b ve P6'daki `hostMs > 0` + tam hesapla uyumlu **[Muhtemel]**.

**Pilot 503'ü ortadan kaldırdı mı? [Doğrulandı]** Hayır.
- Pilot, eski kayıt yollarında veri kümesi yükleme yoluna **girilmesini** önlüyor: L2'de açık kolda 0/21 503, kapalıda 10/21.
- Bayrak açıkken bile kira yolları hâlâ yükleme yapıyor ve 503 görüldü (kanca günlüğünde 3 aşım, `kill.js`'de 1 yeniden deneme):
  - başka kullanıcı;
  - importance;
  - yapılandırma ve gün dönümü;
  - güvensiz yama;
  - doğrulama uyuşmazlığı.

**Çözüm yönü (kod yok; bütçe/limit artırmak çözüm sayılmaz):**
- Ölçümü "iş sonrası canlı küme"ye yaklaştırmak, ya da tahmine önceki neslin satırlarını açıkça eklemek;
- önceki nesil satırlarını yeni yükleme öncesi bırakmak (özet karşılaştırması için yalnız özet Map'i tutmak).

Hangisinin güvenli olduğu ayrı ölçüm ister **[Hipotez]**.

### 6G.4 · Modülün kendi girdilerine bağlı geçerlilik anahtarı uygulanabilir mi?

**`activeGeneration` kullanımları [Doğrulandı: source]:**
1. Modül dosyalarının disk konumu (`modulePath(userId, activeGeneration, module)`).
2. Manifest'in atomik değişimi, `previousGeneration` ve `.bak` kurtarma (`page-projection-cache.js:106-127, 235-282`).
3. `reuseGeneration`: `moduleInputKeys` eşleşirse yeniden kullanım (`server.js:8674`).
4. Zarf ve yanıt başlıkları (`X-Page-Cache-Generation`, `cachedGeneration`: `server.js:9052-9099, 9169`). `public/`'te tüketici bulunamadı.
5. Backlog varyant yolu ve tutarlılık denetimi (`page-projection-cache.js:489-515`).
6. Okuma modeli veri kümesi anahtarı `activeGeneration:checksum16` (`read-model-service.js:48`, `cp-computed-service.js:140`, `overview-model-service.js:98`).

**İçerik kimliği zaten var:** modül `checksum` = sıkıştırılmış baytların SHA-256'sı, yazımda hesaplanır. Değişmeyen modül baytları taşınınca checksum aynı kalır. Yeni tam tarama gerekmez.

**Ama anahtarda ikinci bir sürüm daha var [Doğrulandı: source]:**
- Veri kümesi anahtarı `hash([captured.key, …, generation])`.
- `captured.key` = `{userId, contextHash, accessHash, sourceToken}` (`compute-read-guard.js:8-10`).
- `contextHash` (`computeReadContext`) paylaşılan override revizyonunu ve günü içerir, **her kayıtta değişir**.
- Bu yüzden yalnız `activeGeneration`'ı checksum'la değiştirmek yetmez. Anahtar `userId + accessHash + sourceToken + modül checksum` olmalı. `contextHash` ise yalnız güncellik kapısında (`assertResponse`) kalmalı.

**Güvenli mi? [Muhtemel, kanıtlanmadı]:**
- Bayt içeriği aynıysa sorgu sonucu aynıdır. Veri kümesi yalnız baytlardan çözülür; `today` sorgudadır.
- Ancak `contextHash`'in anahtardaki başka bir rolü (erişim kapsamı değişimi, kaynak yenilemesi) `accessHash` / `sourceToken`'da tam kapsanmalı. Bunun kanıtı gerekir.

**Kazanç sınırlı:** Bir Supp. FOB kaydında cp, orders ve order-summary içerik olarak gerçekten değişiyor. Bu üçü için checksum değişir, yeniden yükleme yine olur. Kazanç yalnız değişmeyen modüllerde (overview, collection-catalog) ve bunların okuma modelleri açıkken.

**`derived-input-keys` neden aday değil:** Anahtar bütün override'ı tek parça özetliyor. Modül başına "kendi girdisi"ne inmek, hangi override alanını hangi modülün okuduğunu bilmeyi, yani elle tutulan bir listeyi gerektirir. Kurala aykırı.

**Satır yaması günlüğü:** Değişen satırların kimliğini zaten taşıyor. Değişen modüllerde tam yeniden yükleme yerine yama uygulamanın tek mevcut yolu bu (CP'de var). Siparişler'e taşınması ayrı karar (§6F.5-1).

## 6H · P1 lojistik segment düzeltmesinin gerçek sunucu doğrulaması (2026-11-27)

**Sabit commit'ler:**
- düzeltme `3b44c863` (`claude/p1-logistic-segment-incremental`);
- taban main `51deb5d`.

Bayrak kapalı. Kod değiştirilmedi. Araçlar ve ham sonuçlar: `adr-0003-kanit/6h/`.

**Doğruluk: V1/V2/V3 alan düzeyi [Doğrulandı: gerçek sunucu, 30k]**
- **main:** V2 ≠ V3.
  - `PATCH` ve `POST /rows` Del. Type: Del. Type ve Ant. Arrival eski kalıyor. `POST /rows` satırında karar demeti de farklı.
  - Kısmi sevk satırında segmentler farklı.
  - Gövdesinde değişmemiş `delType` olan gerçek istemci Supp. FOB kaydında da segmentler farklı (değer `delmap` override'ı olarak yazılıyor).
- **düzeltme:** V1 = V2 = V3. Şu durumlarda da eşit:
  - tarih temizleme + geri döndürme sonrası;
  - normal yeniden başlatma ve SIGKILL sonrası.
- **düzeltme, diğer kontroller:**
  - karar demetleri eşit; tek fark, T2'den sonra düzenlenen SIGKILL satırı;
  - Siparişler satırları eşit;
  - IAS parsiyel alanları değişmedi;
  - otomatik onaylı satırda Ex-factory düzenlemesi `409 AUTOMATIC_DATE_READ_ONLY` (korunuyor);
  - başka kullanıcının Del. Type olayı `mode:"reload"`, `rowPatches:null` (main'de `patch`).
- **Fikstür sınırı (seed 7, ilk 5000 satır):** her satırda yükleme onayı var, bu yüzden onaysız Ex-factory düzenlemesi sınanamadı. Çoklu parsiyel, tam sevk ve aynı siparişin farklı rengi de yok **[Bilinmiyor: gerçek sunucuda kapsanmadı]**.

**Maliyet (L2, A B B A A B, 3 çift, koşu medyanları):**

| Ölçü | Del. Type (`POST /rows`): main → düzeltme | Supp. FOB (`PATCH`, gövdede `delType`): main → düzeltme |
|---|---|---|
| Kayıt → CP yanıtı | 0,25 → 6,42 sn (çift farkı +5,9 / +6,2 / +6,4) | 4,61 → 7,83 sn (+1,7 / +3,5 / +3,8) |
| Kayıt → CP + Siparişler hazır | 3,36 → 10,27 sn | 5,64 → 11,35 sn |
| Kira beklemesi / CP yükleme | 0 / 0 → 3,46 / 1,17 sn | 2,24 / 1,18 → 3,49 / 1,12 sn |
| Sunucu CPU (pencere) | 8,7 → 15,8 sn | 12,2 → 15,8 sn |
| CP 503 | 0/9 → 3/9 | 0/9 → 2/9 |

**Yorum:**
- main'in Del. Type'taki hızı **yanlış veriyle** geliyor (satır yaması zinciri eski segmentle hesaplıyor).
- Düzeltmedeki maliyet doğruluk bedeli; karar ürün sahibinde.
- Supp. FOB kontrolü **değişmemeliydi ama geriledi**. Neden: istemci gövdesi mevcut `delType`'ı da gönderiyor, `patchTouchesLogisticSegments` `delType != null` dediği için kayıt tam kuruluma düşüyor.
- Ancak main ölçümü, değişmemiş `delType`'ın bile tam kurulumda segmenti değiştirdiğini gösterdi. Yani bu değer gerçekten bir segment girdisi; kuralı "değişmedi" diye gevşetmek doğruluğu bozar **[Doğrulandı: main V2≠V3, satır 12]**.
- Gereksiz olan, istemcinin değişmemiş `delType`'ı göndermesi olabilir **[Hipotez]**.

**Birincil segment tutarsızlığı [Doğrulandı: gerçek sunucu, satır 4100023/L02, parsiyel Depoda + üretim]:**
- CP okuma modeli: STATUS "Depoda", Ant. Arrival 15.12 (partials[0], `overview-row-prep`).
- Siparişler okuma modeli ve ham projeksiyon (cp ve orders): STATUS "Üretimde", Ant. Arrival 04.01 (ilk kıtlık-dışı segment, `parse.js`).
- Del. Type ikisinde de "Gemi".
- Aynı satır CP ve Siparişler'de farklı durum ve varış gösteriyor. İş kuralı kararı; değiştirilmedi.

## 6I · Del. Type yazma niyeti doğrulaması (2026-11-27)

**Sabit commit'ler:**
- niyet `3b23455` (`claude/deltype-write-intent`);
- main `b7b172d` (P1 öncesi);
- main `57bb982` (#1241 dahil).

Kod değiştirilmedi. Gerçek Chromium DOM olayları kullanıldı: çift tık, menü, not penceresi, Ctrl+Z/Y, pano yapıştırma. Ham sonuçlar: `adr-0003-kanit/6i/`.

**Kayıt gövdeleri ve sunucu `delmap`'i [Doğrulandı: gerçek tarayıcı + sunucu deposu]:**

| Senaryo | main `b7b172d` | niyet `3b23455` |
|---|---|---|
| Supp. FOB (`PATCH`) | gövdede `delType:"Gemi"`; `delmap` sessizce "Gemi" | `delType` yok; `delmap` yok |
| Not kaydı (`/batch`) | `delType` yok | `delType` yok |
| Not yapıştırma, 2 satır (`/batch`) | her öğede `delType:"Gemi"` (sessiz override) | `delType` yok |
| Açık Del. Type (satır kaydı açık: `POST /rows`; kapalı: `PATCH`) | gönderiliyor, `delmap`'e yazılıyor | aynı |
| Geri al / yinele | eski / yeni değer gönderiliyor | aynı |
| Bilinçli override + not | override korunuyor | aynı |
| "—" ile temizleme | "Gemi" gönderiliyor (varsayılan) | aynı (değişmedi) |
| Del. Type yapıştırma "Uçak×2" | `["Gemi","Uçak"]` | aynı (yapıştırma seçimi belirsiz; davranış eşit) |
| B Del. Type yazarken A bayat satırdan Supp. FOB | gövde "Uçak" (canlı olay 500 ms gecikmeden önce satırı güncelledi); bu zamanlamada ezilme yok | `delType` yok; B'nin değeri yapı gereği korunur |

**Sınırlar:**
- Fikstürde lisansör yalnız DTR (24.982 satır), bu yüzden Sub-Manufacturer kaydı arayüzden sınanamadı **[Bilinmiyor]**.
- Main'de ezilme penceresi (canlı olay gecikirse) yeniden üretilmedi **[Hipotez]**.

**L2 (30k, 9 koşu, 3 dönüşümlü blok; medyanlar `b7b172d` / `57bb982` / niyet):**

| | Supp. FOB | Not |
|---|---|---|
| Kayıt → CP + Siparişler hazır | 8,98 / 15,47 / 9,46 sn | 9,29 / 16,09 / 10,10 sn |
| Siparişler | 1,25 / 4,90 / 1,15 sn | 1,21 / 5,38 / 1,44 sn |
| Sunucu CPU | 16,4 / 20,4 / 16,9 sn | 16,4 / 25,0 / 18,2 sn |
| Blok farkı (niyet − P1 öncesi), hazır | −0,30 / +0,48 / +0,16 sn | +0,72 / +1,16 / +0,84 sn |

**Yorum:**
- Supp. FOB'ta #1241 gerilemesi kalktı; P1 öncesi düzeye dönüş var.
- Not yolu kodu iki kolda aynı, ama 3/3 blokta +0,7–1,2 sn fark var. Koşuların çoğunda CP okuması 503 ile düştüğü ve soğuk tam hesaba geçildiği için fark ayrıştırılamadı **[Bilinmiyor]**. Kabul için L2 tekrarı gerekir.
- Son okuma özeti 9/9 koşuda aynı.

**İki kullanıcı ve ardışık kayıt [Doğrulandı: gerçek tarayıcı, `46fc8d96` (uygulama kodu `3b23455`) ↔ main `57bb982`; satır kaydı açık ve kapalı]:**
- "Kara" yerine `Gemi+Tır` kullanıldı (`DELTYPE_OPTS`'ta "Kara" yok).
- **A senaryosu:** U1 açık "Uçak" kaydeder; U2 aynı satırı `Gemi+Tır` yapar; U1 bayat satırdan ilgisiz Supp. FOB ya da not kaydeder. İki varyant: canlı olay normal ve canlı olay `page.route` ile engelli.
  - **Niyet:** U1'in gövdelerinde `delType` yok; `delmap` 4/4 satırda `Gemi+Tır`, iki yolda da.
  - **main:** U1'in Supp. FOB gövdesi bayat "Uçak"ı taşıyor; 4 durumun 3'ünde U2'nin değeri ezildi.
  - Not kaydı iki kolda da `delType` taşımıyor.
- **B senaryosu:** ilk kayıt (`Uçak`) yanıt aşamasında tutuldu; bu sırada `Gemi+Tır` seçildi; kayıt 1 onaylandı.
  - Kayıt 2 `Gemi+Tır` gönderdi.
  - Ardından ilgisiz Supp. FOB, niyette `delType` taşımadı; main'de mevcut değeri taşıdı.
  - `delmap` iki kolda da `Gemi+Tır`.

**Journal [Doğrulandı: source + gerçek yerel DB, salt okunur]:**
- CP kayıtları sipariş satırı başına `cp-order:<satır>` olarak tutuluyor. Olayın `patch` alanı yalnız değişen alanları içeriyor (`delivery`, `notes`, `suppFob`…); `userId`, `at` ve `revision` de var.
- Main kökünde sessiz override `{notes, suppFob, suppFobMeta, delivery:"Gemi"}` olarak görünüyor. Listelenebilir.
- Ancak eski `PATCH` yolundaki açık Del. Type düzenlemesi de `{notes, delivery}` olarak kaydediliyor. Bu yüzden aday listesi alan kümesinden çıkarılamaz; yeni değerin kaynak (ASAS) Del. Type ile karşılaştırılması gerekir **[Muhtemel]**.
- **Saklama:** süre değil sayı tabanlı (`local-db.js` `JOURNAL_RETAIN_TAIL=1000`, `JOURNAL_PRUNE_MIN_BATCH=2000`).
  - Yerleşmiş (yüklenmiş + onaylanmış) olaylar ≥3000 olunca budanır; son 1000 kalır. Açık olaylar hiç budanmaz.
  - Yalnız yerel olaylar hemen yerleşmiş sayılır (`closeIfLocalOnly`).
  - Journal cihaz başına; yalnız o cihazın olaylarını tutar.

**Birincil segment [Doğrulandı: source + git + 1 satır]:**
- `parse.js` `cpLogisticPriority` segmentleri en geride kalan aşama önce gelecek biçimde sıralıyor (1: üretim/kıtlık, 2: yolda, 3: depoda/retail). Tam kurulum ilk kıtlık-dışı segmenti alıyor. Kod `37831dc06` (2026-10-13, sürüm 7.0.272 sınırı); açıklama: "Ana durum, gerçek IAS parsiyellerinden (veya gerçek üretim satırından) gelir".
- İstemci `rebuildCpLogisticCaches` (aynı sınır) ve okuma modeli `overview-row-prep` (`1dbb04949`, #1085, 2026-11-20, istemciyle parite için kopya) `partials[0]` kullanıyor.
- Satır 4100023/L02, iki seçim yan yana:

| Alan | ilk kıtlık-dışı (Siparişler, ham) | `partials[0]` (CP) |
|---|---|---|
| STATUS | Üretimde | Depoda |
| Del. Type | Gemi | Gemi |
| Ant. Arrival | 04.01 | 15.12 |
| HANDOVER | yok | 27.11 |
| Priority | ON_TRACK | ON_TRACK |

- Segmentler (karıştırılmadan): kalan üretim bakiyesi 2.520 adet, Üretimde, 04.01; gerçekleşmiş parsiyel 1.680 adet, Depoda, 15.12, handover 27.11.
- Backlog RİSK (`computeBacklogRisk`) segment satırı başına hesaplanıyor; birincil seçimden bağımsız.
- Diğer satırlarda Priority'nin değişip değişmediği ölçülmedi **[Bilinmiyor]**. Seçim değiştirilmedi.

## 7 · Ürün sahibinin vermesi gereken kararlar

1. **Sütun filtresi anlamı (T5):** Koleksiyonda sayısal/aralık/revizyon filtresi yokluğu bilinçli mi? Genel Bakış boyut filtresinin `norm()` eşitliği istenen davranış mı?
2. **Boş sayı (T1, V5):** Boş hücre toplamlarda 0 mı sayılır, yoksa "yok" olarak dışarıda mı kalır? Paralel veri sözleşmesi pilotuyla birlikte karar verilmeli.
3. **Pilot B'nin devamı (§6B.4):** tarayıcı tam yükünde seçenek (a) istemci günlüğü uygular ya da (b) modül bazında sıkıştırma; ayrıca gerçek arayüz okuma deseninin ölçülmesi.
4. **İptal edilen yazarın sonradan varan olayları (V10):** inceleme kuyruğu mu (öneri), HLC'ye göre kabul mü, yoksa ret mi?
5. **Pilot seçimi (§6):** V1 (yüksek kazanç, P1) ya da daha küçük alternatif V2 alt kümesi (Ex→Retail/LT).

---

## 8 · Kalıcı mimari ilkeler

Ürün sahibinin önerdiği on ilke. Her biri bu belgedeki bir kanıta bağlanmıştır.

| No | İlke | Bu belgedeki karşılığı |
| --- | --- | --- |
| 01 | **Veri bütünlüğü:** hiçbir performans kazancı sessiz veri kaybını meşrulaştıramaz. | V10/ADR-0001; V1'de türetilmiş veri ile kaynak ayrımı |
| 02 | **Doğruluk:** geçersiz durumlar mimari seviyede engellenir. | V2 ("aynı ad, iki anlam" `Ex-factory`), V5 (boş/0/bilinmiyor), V1 ("temizlendi" değeri) |
| 03 | **Determinizm:** aynı girdi aynı sonucu verir; saat, yerel gün, dil ve config açık girdidir. | V2/V4 ortam girdileri (`new Date()`, global `transitRules`) |
| 04 | **Yerel bağımsızlık:** yerel işlem ortak klasöre ve ağa bağımlı olmadan çalışır. | §1 zorunlu kabul |
| 05 | **Minimum işlem:** gereksiz işlemi kaldırmak hızlandırmaktan değerlidir. | V1 (yeniden yazım yerine günlük), V2 (yeniden türetme yok) |
| 06 | **Tekil iş kuralı:** bir kural ve onun girdi eşlemesi tek yerde yaşar. | T9 (4 girdi derleme noktası), T1, T5 |
| 07 | **Sınırlı etki alanı:** bir değişikliğin etkileyebileceği alan yapıyla sınırlanır ve ölçülebilir. | V8 (%44 sıcak dosya), V9 |
| 08 | **Ölçülebilir üstünlük:** yeni mekanizma, eskisinden üstün olduğu ölçülmeden yerine geçmez. | CLAUDE.md §3.2 kademeleri; Faz 0 gölge sayaçları |
| 09 | **Geri döndürülebilirlik:** her dönüşümün bayrağı, gölge modu ve geri dönüş yolu vardır. | V1–V9 geri alınabilirlik satırları |
| 10 | **Sadeleşme:** yeni mekanizma geldiğinde eskisi kaldırılır; paralel kalıcı yol bırakılmaz. | T7, T11 (aynı işi yapan iki-üç mekanizma) |

**Her geliştirmede sorulacak soru:** *"Bu ihtiyaç için gerçekten yeni kod gerekiyor mu, yoksa mevcut sistemin çalışma şeklini değiştirerek ihtiyacı karşılayıp eski kodun bir kısmını kaldırabilir miyim?"*

### 8.1 · CLAUDE.md / AGENTS.md entegrasyon önerisi (uygulanmadı)

**İlke:** Mükerrer talimat dosyası yok. Mevcut kurallarla çakışan bir şey eklenmez, yalnız mevcut kurallarda karşılığı olmayan kısım eklenir. Aşağıdaki metinler önerilir; CLAUDE.md ve AGENTS.md **değiştirilmedi**.

**Olası çakışmalar ve çözümleri:**

| Gerilim | Çözüm |
| --- | --- |
| İlke 10 "eski kodu kaldır" ↔ §3 adım 2 "görev dışı refactor/cleanup ekleme" | Kaldırma yalnız **görevin etki alanında** ve eşdeğer davranış testiyle yapılır. Alan dışında kalan, ayrı öneri olarak raporlanır. |
| Öncelik sırasında UX'in son olması ↔ §2 "ürün sahibinin bilinçli UX/iş kuralı tercihini teknik kusur sayma" | Sıra **teknik ödünleşimler** içindir; ürün sahibinin UX ve iş kuralı kararını geçersiz kılmaz. |
| İlke 08 ↔ §3.2 performans kademesi | §3.2'ye atıf yapılır; ilke tekrar yazılmaz. |
| İlke 06 ↔ §4 canonical alan kuralı | §4'teki kural ilkenin özel halidir; ikisi birlikte durur. |
| İlke 09 ↔ §3.1 "Merge ≠ TEST ≠ STABLE" | Birbirini tamamlar; ek kural gerekmez. |

**Öneri 1 · CLAUDE.md'de §4'ün başına yeni alt bölüm `§4.0 · Kalıcı mimari ilkeler`** (≈14 satır):

```markdown
### 4.0 · Kalıcı mimari ilkeler

Teknik ödünleşimde sıra (sözlük sırası, puanlama yok): **veri bütünlüğü >
doğruluk > kararlılık > performans > mimari sadelik > UX**. Alttaki kazanç
üsttekindeki kaybı telafi etmez; sıra ürün sahibinin UX/iş kuralı kararını
geçersiz kılmaz.

01 Sessiz veri kaybı hiçbir kazançla meşrulaşmaz · 02 Geçersiz durum temsil
edilemez olmalı · 03 Aynı girdi → aynı sonuç; saat/yerel gün/dil/config açık
girdidir · 04 Yerel işlem ortak klasöre/ağa bağlı değildir · 05 Gereksiz işlemi
kaldırmak, hızlandırmaktan önce gelir · 06 Bir kural ve girdi eşlemesi tek
yerde · 07 Değişikliğin etki alanı yapıyla sınırlı · 08 Ölçülmeden üstünlük
yok (§3.2) · 09 Bayrak/gölge/geri dönüş yolu · 10 Yeni mekanizma gelince eskisi
kalkar; paralel kalıcı yol bırakılmaz (yalnız görevin etki alanında, eşdeğer
testle — §3 adım 2).
```

**Öneri 2 · CLAUDE.md §3 "Uygulama akışı", adım 2'nin sonuna bir cümle:**

```markdown
   Yeni kod yazmadan önce sor: bu ihtiyaç, mevcut sistemin çalışma şeklini
   değiştirip eski kodun bir kısmını kaldırarak karşılanabilir mi? (§4.0)
```

**Öneri 3 · AGENTS.md "Çalışma" listesine tek madde ve "Ayrıntı haritası"na ek:**

```markdown
- Ödünleşim sırası: veri bütünlüğü > doğruluk > kararlılık > performans >
  sadelik > UX. Yeni kod yerine çalışma şeklini değiştirip kod kaldırmayı önce
  değerlendir; ilkeler `CLAUDE.md` §4.0.
```

Ayrıntı haritasında `§4 mimari değişmezler` ifadesi `§4.0 mimari ilkeler · §4 mimari değişmezler` olur.

**Neden bu yerler:** §2 iletişim ve kanıt, §3 iş akışı, §4 değişmezler bölümüdür. İlkeler değişmezlerin gerekçesi olduğu için §4'ün başına aittir. Soru iş akışına ait olduğu için §3'e girer. AGENTS.md kendi başına yeterli kalmalı ama kısa olmalı; bu yüzden tek madde yeter.

---

## Ek A · Ölçüm komutları (yeniden üretim)

`resources/app` içinden:

```bash
# boyutlar ve büyüme
wc -l public/app-main.js server/server.js
for c in $(git rev-list origin/main | tail -1) HEAD; do git show $c:resources/app/public/app-main.js | wc -l; done
# fonksiyon adları (filter/group/render)
grep -oE "^\s*(async\s+)?function\s+[A-Za-z_$][A-Za-z0-9_$]*" public/app-main.js | awk '{print $NF}' | grep -ci filter
# global durum
grep -cE '^(let|var) ' public/app-main.js
grep -oE "state\.[a-zA-Z_]+\s*=[^=]" public/app-main.js | sed -E 's/\s*=.*//' | sort -u | wc -l
# yardımcı aileleri (ör. sayı zorlama)
grep -rEoH "(function\s+|(const|let|var)\s+)(num|toNum|parseNum|parseNumber|toNumber|numOrNull|asNumber|safeNum)\s*(=|\()" public server shared --include=*.js | grep -v vendor/
# test sınıflaması
grep -lE "app-main\.js" tests/*.test.js | wc -l
grep -lE "app-main\.js" tests/*.test.js | xargs grep -lE "vm\.|new Function|extractFunction|app-main-functions" | wc -l
# git dokunma örneklemesi (kökten)
git log -400 --first-parent --format='@%h %s' --name-only origin/main   # >300 dosyalık commitler hariç tutuldu
```

## Ek B · Davranış deneyleri (scratchpad, commit edilmedi)

**B1 · Sayı zorlama matrisi.** Kaynaktaki tek satırlık tanımlar birebir kopyalandı.

| Uygulama | `null` | `undefined` | `''` | `'1,5'` | `'1.234,56'` | `'12abc'` |
| --- | --- | --- | --- | --- | --- | --- |
| `app-main.js:548 toNum` | 0 | null | 0 | null | null | null |
| `app-main.js:24761` | null | null | null | null | null | null |
| `app-main.js:24732` | 0 | 0 | 0 | 0 | 0 | 0 |
| `backlog-delivery-engine` | 0 | 0 | 0 | 0 | 0 | 0 |
| `lfl.js` (public) | 0 | null | 0 | null | null | null |
| `postfob`/`tryd` | null | null | null | null | null | null |
| `fx-calculation-engine` | null | null | null | **1,5** | **1,234** | **12** |
| `collection-price-drawer` | NaN | NaN | NaN | NaN | NaN | NaN |
| `read-model/backlog-v3-model` (sunucu) | null | null | 0 | null | null | null |

**B2 · Tarih zorlama paritesi.** `tests/helpers/app-main-functions.js` ile `app-main.js` `coerceDateLoose` zinciri çıkarıldı ve `read-model-query.internals.coerceDateLoose` ile gün ordinal'i karşılaştırıldı. 20 elle seçilmiş örnek ve 6 biçimde 20.000 rastgele tarih kullanıldı; saat dilimleri `Europe/Istanbul`, `Europe/Berlin`, `America/New_York`. Sonuç: 120.019 örnekte **0 gerçek fark**. Tek fark, vm bağlamları arasında `instanceof Date`'in başarısız olmasından doğan bir artefakttır. Çıkarım sırasında fonksiyonun gizli global'lere bağlı olduğu görüldü: `_isoDayCache`, `ISO_DAY_CACHE_MAX`, `window.XLSX`. `window.XLSX` yüklüyken istemcinin Excel seri tarihi için kullandığı `XLSX.SSF.parse_date_code` dalı test edilemedi (container'da `node_modules/xlsx` yok).
