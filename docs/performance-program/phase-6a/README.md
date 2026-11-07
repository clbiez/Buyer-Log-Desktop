# Faz 6a — alan kullanım envanteri ve shadow hazırlığı

Bu paket **üretim davranışını veya veri şemasını değiştirmez**. İnce projeksiyon,
dual-read uygulaması ve nihai ölçümler #885 sonrası Main'i bekler. Kazanç ölçülmedi.

## Teslim ve kanıt sınırı

| Dosya | İçerik |
| --- | --- |
| [field-inventory.json](field-inventory.json) | 42 canonical ID, sıralı module binding'ler, okuyucu konumları/fonksiyonları, kullanım türleri, sınıflar, ham alan adayları ve dinamik erişimler |
| [reviewed-contracts.json](reviewed-contracts.json) | Sabit 72 kaynak dosyası, baz SHA, 15 elle doğrulanmış tüketici/fallback sözleşmesi ve test bağlantıları |
| [shadow-matrix.json](shadow-matrix.json) | 24 planlanmış senaryo; fixture, oracle, assertion ve kabul protokolü |
| [measurement-plan.md](measurement-plan.md) | Payload, JSON parse, heap ve uçtan uca tekrar protokolü |
| [inventory-tool.cjs](inventory-tool.cjs) | Kaynak okuyan AST tarayıcı, hash/konum/kapsam doğrulayıcı ve sentetik self-test |
| [measure-json.cjs](measure-json.cjs) | #885 sonrası sentetik JSON çiftleri için hazırlanmış bağımsız ölçüm aracı; bu fazda yalnız self-test |

Baz: `270228a4d9f195e613ae670db8c30583d9c183fc`.
[#885](https://github.com/clbiez/Buyer-Log-Desktop/pull/885) metadata kontrolünde açık
taslaktı; gözlenen uzak head `1ff5038e2aab145c363fdcb07282afa5c33dce0d`.
Bu pakette #885 kodu veya Claude çalışma dosyaları düzenlenmedi.

**[Doğrulandı]** Kaynak taramasında 11.017 sözdizimsel erişim/katalog/üretici
kaydı, 811 dinamik erişim ve canonical ID atanmamış 1.155 anahtar adayı tutuldu.
Bunlar gerçek çalışma zamanı okuma sayısı veya payload alan sayısı değildir.
`row`, `item`, `source`, `a` gibi değişkenler farklı nesneleri de tutabilir;
şüpheli eşleşmeler silinmek yerine aday olarak bırakıldı.

## Kısa gerekçe

| Sınıf | Canonical alan | Gerekçe |
| --- | ---: | --- |
| ince satırda gerekli | 32 | Mevcut CP sütun veya readiness `F` sözleşmesinde okunuyor. Hücre, filtre, sıralama, hesap ve export yolları korunmalı. Bu sınıf gelecekteki projeksiyonun uygulanmış allowlist'i değildir. |
| tembel detay adayı | 0 | Tüm liste/hesap/dinamik bağımlılıkları kapanmış, yalnız detaya ait olduğu kanıtlanmış alan yok. |
| belirsiz | 10 | Statik kanıt ince satır gereksinimini kapatmıyor; dinamik/export ve diğer modül okumaları mevcut veya açık. Kaldırılabilir sayılmaz. |

Belirsiz canonical ID'ler: `cashRetailPrice`, `productMainDefinition`,
`setPieceCount`, `collectionName`, `buyingSampleManufacturer`, `productGroup`,
`brandDirectorate`, `currency`, `collectionQuantity`, `inStoreMonth`.
Beşinde statik anahtar okuması bulunmadı; **bu kullanılmıyor demek değildir**:
`lcwai-output-source.build` desteklenen modüllerde `moduleFields` listesinin
tamamını dolaşır. Bu okuyucular her alanın `dynamicReaders` kaydında vardır.

**[Doğrulandı]** İnce listeyi yalnız `CP_COLS` üzerinden seçmek yetersiz:

- `cellHtml`, `cellPlainText`, filtreler ve `sortRows` dinamik anahtar okur.
  `CP_SEARCH_KEYS` finite anahtarları gerçek okuma konumlarında açılır; açık
  anahtarlar `dynamicAccesses` içinde kalır.
- Formüller own alan → formül alias → model alias sırasını izler; `__f_`,
  `__CPX_`, model sütunu ve kişisel notlar kaynaktan/ayarlardan gelir.
- `_logisticSegments` ana hücre, çoklu filtre, detay ve hesap yolundadır.
  Segmentin tamamını tembel detay saymak için alt alan grafı gerekir.
- `_asasExFactory`, `_asasRetailDate`, `_asasInStore`, `Original Ex-factory`
  ve `_initialInspection` farklı iş anlamları taşır. Gizli alan hesap girdisi
  olabilir. `_canEdit`/`_canEditShared` eksikliği izin kararını değiştirebilir.
- Binding anahtar sırası, boş/null atlama, `0`/`false` koruma ve token başlık
  eşlemesi korunmalı. `__canonical` own override daha önce okunur.
  `Supplier`/`Sub-Manufacturer` fallback'leri ve semantik çakışmalar kaydedildi.
- Drawer doğrudan alan → canonical → normalize ham başlık fallback'lerini
  dış/iç kaynak sırasıyla okur. `_sourceFields`, `_sourceValues`, `_cpExtra`
  ham katmandadır; `__sourceOrder` enumerable değildir ve JSON payload'una
  taşındığı varsayılamaz.

**[Bilinmiyor]** Bu sınıflardan kaç byte, parse süresi veya heap kazanılacağı.
Ham nesnelerdeki genişlik/tekrar, hydration maliyeti ve #885 sonrası kaynak
sahipliği ölçülmeden toplam kazanç çıkarılamaz.

## Envanter nasıl okunur?

`fields[].usageIds` → `accesses[].id` bağlantısı okuyucu dosya/satır/sütun,
fonksiyon, ifade, kullanım türü ve erişim biçimini verir. `dynamicReaders`
elle doğrulanmış geniş okuyucuları; `openContractIds` açık bağımlılıkları
bağlar. `bindings` sırası runtime sırasıdır; registry konumu ayrıca bulunur.
`unregisteredFields` kayıtlarında `canonicalId:null` tutulur; yeni canonical
ID veya şema eklenmez. `dynamicAccesses` açık anahtarları ve tüm nesne
enumeration/copy/spread yollarını içerir. Her kayıt `removable:false` taşır.

`usageTypes` fonksiyon/dosya bağlamından çıkarılan **statik tahmindir**;
runtime trace değildir. `usageStatus` bunun durumunu belirtir. Boş kullanım
listesi üretici veya çözülemeyen bağlamdır. `producer-not-read` / katalog
kaydı bir okuyucu çağrısı sayılmaz. Güçlü çapraz yol kanıtları C01–C15'teki
gerçek kaynak anchor'larıdır. Bu ayrımlar nedeniyle JSON doğrudan alan silen
bir araç veya kapalı bir allowlist olarak kullanılamaz.

Tarayıcı yalnız scope listesindeki kaynakları okur; tür analizi/çağrı grafı ve
gerçek kullanıcı formül/başlık ayarlarını çözmez. Scope dışı tüketiciler yok
sayılmaz. AST değerlendirici mutable değişken/loop indeksini sabit başlangıç
değeri sanmaz; parametre gölgelemesini korur. Bu sınırlar self-test'tedir.

## Tekrar üretme ve doğrulama

Depo kökünde, bu çalışma ortamındaki Node `24.19.0` ile:

```sh
node --expose-internals docs/performance-program/phase-6a/inventory-tool.cjs self-test
node --expose-internals docs/performance-program/phase-6a/inventory-tool.cjs check
node docs/performance-program/phase-6a/measure-json.cjs self-test
```

Araç önce varsa yerel `acorn` paketini, yoksa Node'un gömülü Acorn'unu
(`--expose-internals`) kullanır; paket kurulumu veya ağ gerekmez. Tüm scope
dosyalarının SHA-256'ları, kaynak anchor'ları, 42 ID coverage'ı, contract/test
bağlantıları ve deterministik üretim doğrulanır. `check` hiçbir dosya yazmaz.
`build` yalnız **yeni** `field-inventory.json` dosyasını üretir; kaynak drift'i
incelenmeden kanıt yenilemek için kullanılmamalı.

Yerel doğrulama: iki aracın self-test'i ve inventory check PASS. Mevcut
canonical, CP readiness/rules, Orders filter, CP/Orders external output ve
field ownership test dosyaları: **6/6 PASS**, fail/skip/cancel 0.
Tam regresyon çalıştırılmadı; uygulama davranışı değişmedi. Gerçek veri,
credential veya çalışan Buyer Log'a erişim yapılmadı. **Shadow S01–S24
çalıştırılmadı; payload/parse/heap ölçümü yapılmadı.**

## #885 sonrası kapı

Yeni Main SHA'sı seçilip bu envanterin kaynak farkı incelenmeli; compute,
worker IPC, source sahipliği ve yeni tüketiciler yeniden kapsama alınmalı.
Bu paketin baz ölçümü yeni Main'in baz ölçümü sayılamaz. C01–C15 ve S01–S24
kanıtları tamamlanmadan ince alan allowlist'i çıkarılmaz. Çözülemeyen alan,
dinamik erişim, eksik fixture veya eşdeğerlik farkı kabulü durdurur.

**Faz 6'nın tam test şartı korunur:** Faz 6 / son program PR'ının kapanışında,
sabitlenmiş #885 sonrası Main + uygulama SHA'sında `resources/app` içinden
**filtre uygulanmadan `npm test`** çalıştırılmalı ve tam paket geçmelidir.
Bu hazırlıktaki 6 hedefli test dosyası, araç self-test'leri, S01–S24 ve hızlı
PR kontrolleri tam regresyonun yerine geçmez. Test silme/gevşetme, assertion
azaltma, eşik gevşetme veya zorunlu başarısız/skip kontrolü başarılı sayma yok.
Sonucu etkileyen değişiklikten sonra ilgili kanıtlar ve tam test yenilenir.
Tam testin durumu şu anda **bekliyor; çalıştırılmadı**. Bu gereklilik
`shadow-matrix.json.requiredValidation.fullRegression` içinde kayıtlıdır ve
bağımsız doğrulama aracı şartın kaldırılmasını/gevşetilmesini reddeder.

Bu çalışma ayrı dal/taslak PR içindir. **Merge, TEST ve STABLE yapılmaz.**
