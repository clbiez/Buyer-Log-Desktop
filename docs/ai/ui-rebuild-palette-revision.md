# Buyer Log — Faz 0B renk revizyonu

Kullanıcı eski nötr paleti ve tablo başlık renklerini tercih etti.
Bu karşılaştırma seçim öncesine aittir. Sonraki kullanıcı kararı Manifest'tir;
[Faz 1 pilotu](ui-rebuild-phase-1.md) ayrı yerel branch'te hazırlandı.
[Güncel tek dosyalık galeri](ui-rebuild/concepts.html).

## Değişti

İki konsept artık aynı renk ailesini kullanır. Açık ve dark zeminleri,
panel tonları ve çelik mavisi vurgu, çalışan başlangıç uygulamasından
ölçülen değerlerine döndü. CSS belgelerindeki eski tanımlara değil,
gerçekte uygulanan `experience.css` paletine göre eşleştirme yapıldı.

| Palet | Sayfa / panel | Tablo sütun başlığı | Durum |
| --- | --- | --- | --- |
| Açık | `#f5f7f9` / `#ffffff` | `#f2f4f7` üzerine `#475467` | Eski yüzey ve başlık renkleri |
| Grey | `#d4d5d7` / `#e9eaec` | `#e8e9ec` üzerine `#565a5e` | Daha nötr orta gri önerisi; başlık eski renkte |
| Dark | `#171c22` / `#20262e` | `#252d36` üzerine `#bdc8d4` | Eski yüzey ve başlık renkleri |
| Grafit | `#0f1113` / `#191c20` | Dark ile aynı | İsteğe bağlı dördüncü tema adayı |

Dark/Grafit grup başlığı zemini, önceki dark temadaki `#303a46` değeridir.
Kategori renkleri çerçeve oluşturmayan küçük köşeli işaretlerle görünür.
Başlık adları ve DOM kancaları korunur. Açık temada iki küçük metin rengi
(ikincil metin ve yeşil durum metni) kontrast için az miktarda koyulaştırıldı;
nötr yüzeyler ve tablo başlıkları bundan etkilenmedi.

Tipografi, bileşen geometrisi ve yerleşim yönleri korunur. Grey'deki yeşil/petrol
tonu kaldırıldı. Grafit, prototipte `data-ui-palette="graphite"` ile dark temel
üzerinde önizlenir; kalıcı tema tercihlerine veya üç temalı üretim döngüsüne
henüz eklenmedi. Haritanın renk önbelleği bu önizleme niteliğini de izler;
böylece Grafit'e geçerken önceki dark çizim renkleri kalmaz.

## Dosyalar ve gerçek görüntüler

- Her iki geçici dalda `resources/app/public/ui-concept.css` ve haritanın
  yalnız renk değişimini izleyen satırı güncellendi.
- `docs/ai/ui-rebuild/evidence/palette-baseline.json`: eski canlı renkler.
- `docs/ai/ui-rebuild/evidence/palette-revision/{kartela,manifest}/`:
  dört palet × iki ekran, yeni paletlerde XL 1280×720, ham kontroller,
  test logları ve export karşılaştırmaları.
- Galeri 16 yeni gerçek PNG ve 3 eski CP referansını, fontları ve lisansı
  kendi içinde taşır. Eski PNG'ler ilgili CP başlığının altından açılır.
- Eski konsept renkleri ve ilk ölçümleri tarihçe olarak korunur; güncel renk
  teslimi bu dosya ve `palette-revision` dizinidir.

## Doğrulama

Her dalda ilgili **18/18** test geçti: design-token-guard,
ui-component-contract, theme-copy-performance, table-range-excel-export.
Harita önizleme niteliği değişiminden sonra yalnız ilgili **17/17** harita testi
ayrıca geçti; sonuç `map-tests.log` dosyasında.

Her palette CP'nin **72 başlık hücresi** başlangıç referansının zemin ve
yazı renkleriyle eşleşti. Grafit, dark başlık paletiyle karşılaştırıldı.
Açık/dark sayfa, ray, kart, ikincil yüzey ve vurgu değerleri de eşleşti.

XLSX'in tüm `xl/*` parçaları ve HTML/TSV kopyası, iki dal × dört palette
başlangıçla aynı. Son görünür metin örnekleminde kontrast hatası yok;
odak kontrastı en az **5,70:1**, seçim kutusu en az **3,98:1**.
Grey ve Grafit'te 1280×720/XL örnekleminde sayfa ve araç çubuğu taşması yok.
Bu sonuç tüm uygulamanın erişilebilirlik veya final görsel matrisi kabulü değildir.

İlk kontrast bulguları `palette-review.json` içinde saklanır; açık/grey
düzeltmeleri `palette-followup.json` içindedir. Son eşdeğerlik sonuçları
`comparison.json` dosyalarında. Başarılı, değişmeyen kapsam tekrar edilmedi.
Font/veri/ölçekleme yolu değişmediği için BLPerf tekrarlanmadı; önceki
Kartela ilk CP geçişindeki +127 ms risk açık kalır.

Tam `npm test` çalıştırılmadı. i18n/release/version sözleşmeleri değişmedi;
bu komutlar tekrarlanmadı. Guard ve baseline gevşetilmedi. Faz 0 üretim
release-note istisnası devam ediyor.

## Yerel inceleme ve yayın durumu

Yerel inceleme açıklaması: Kullanıcı geri bildirimiyle konseptlerin baskın
zeytin/petrol renkleri kaldırıldı. Eski açık/dark nötr yüzeyleri ve tüm
başlık paletleri geri alındı; Grey ve isteğe bağlı Grafit ayrı öneri olarak
eklendi. Kanıtlar gerçek PNG, renk eşleştirmesi, kontrast ve export sonuçlarıdır.
Riskler: geçici prototip katmanı, Grafit'in henüz üretim tema seçimi olmaması,
diğer modüllerin göçünün başlamaması ve önceki Kartela performans bulgusu.
Tam test proje sonunda yapılacaktır.

| Faz | PR / yerel durum | CI | Merge | TEST | STABLE |
| --- | --- | --- | --- | --- | --- |
| 0A | Denetim yerel dalda; PR yok | Çalışmadı | Yapılmadı | Yayınlanmadı | Yayınlanmadı |
| 0B Kartela | `ui-rebuild/concept-kartela`, renk revizyonu | Çalışmadı | Yapılmadı | Yayınlanmadı | Yayınlanmadı |
| 0B Manifest | `ui-rebuild/concept-manifest`, renk revizyonu | Çalışmadı | Yapılmadı | Yayınlanmadı | Yayınlanmadı |
| 1–3 | Konsept kararı bekleniyor | Başlamadı | Yapılmadı | Yayınlanmadı | Yayınlanmadı |

Prototipler üretime merge edilmez. Actions tetiklenmedi, remote push yapılmadı.

Yerel revizyon commit’leri: Kartela `22e8ec8e`, Manifest `540bd95b`.
# Sonraki karar — 25 Ekim 2026

Kullanıcı Manifest'i seçti ve ana tablo başlık gruplarının ince sınır çizgilerini
korumamızı istedi. [Faz 1 pilotu](ui-rebuild-phase-1.md) ayrı yerel branch'te
hazırlandı; Graphite dördüncü tema bu pilota alınmadı. Aşağıdaki konsept
karşılaştırması tarihsel önizleme olarak korunur.
