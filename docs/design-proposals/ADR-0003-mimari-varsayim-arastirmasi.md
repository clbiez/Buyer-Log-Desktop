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

---

## 7 · Ürün sahibinin vermesi gereken kararlar

1. **Sütun filtresi anlamı (T5):** Koleksiyonda sayısal/aralık/revizyon filtresi yokluğu bilinçli mi? Genel Bakış boyut filtresinin `norm()` eşitliği istenen davranış mı?
2. **Boş sayı (T1, V5):** Boş hücre toplamlarda 0 mı sayılır, yoksa "yok" olarak dışarıda mı kalır? Paralel veri sözleşmesi pilotuyla birlikte karar verilmeli.
3. **İptal edilen yazarın sonradan varan olayları (V10):** inceleme kuyruğu mu (öneri), HLC'ye göre kabul mü, yoksa ret mi?
4. **Pilot seçimi (§6):** V1 (yüksek kazanç, P1) ya da daha küçük alternatif V2 alt kümesi (Ex→Retail/LT).

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
