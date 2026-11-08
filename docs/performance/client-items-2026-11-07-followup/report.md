# #906 devamı — eşli ölçüm ve lisans araması kararı

## Korunan teslim ve Main

Orijinal `eb17dc22` (CPR-11), `cbf9fce4` (INT-09), `ed8a425f` (CARD-01)
commit'leri aynen korunur. Eski 18 kanıt dosyasının SHA-256 değerleri doğrulandı;
rapor, ham sonuç ve dört PNG değiştirilmedi. `original-evidence.json` ve
`preservation-check.json` bu kontrolü kaydeder.

Main iki kez fetch edildi ve normal merge komutu kullanıldı. Her iki denemede
de #885'i içeren `63159fb3` zaten teslimin atasıydı: `Already up to date`.
Bu devamda rebase ve force-push yapılmadı. Uygulama, sunucu ve test ağaçları
teslim edilen `ed8a425f` ile aynıdır. Yeni arama sistemi, sanallaştırma veya
uygulama kodu değişikliği yoktur.

CPR-11 yolu ve iki motor bağımlılığı teslimden sonra değişmedi. Önceki beşer
mikro ölçüm örneği korundu; gereksiz benchmark tekrarı yapılmadı. Son test
turunda hata metni, false karar, serialization ve `EXPRESSION_VERSION`
invalidation kontrolleri yine korunur.

## Bağımsızlık ve hacim

Her hedef için A/B, B/A, A/B olmak üzere **üç bağımsız çift** çalıştırıldı.
Her A veya B yeni Node ve Chromium süreci açtı. CARD'ın altı kolu bittikten
sonra INT'nin altı kolu çalıştı; başka benchmark/test eşzamanlı çalışmadı.
Manifest 12 farklı süreç kimliğini ve örtüşmeyen çalışma aralıklarını kaydeder.
A, Main'deki optimizasyon öncesi dört dosya; B, teslim edilen dört dosyadır.
Paylaşılan motor ve Markdown dosyaları aynıdır; dosya özetleri manifesttedir.

CARD koşusu başına her modül için 500 ve **5.000 kayıt üzerinde 10 seçim ve
10 arama örneği** vardır; 5.000 seçim yapılmadı. Aramalar sırayla `000` filtresi
ve filtreyi temizleme şeklindedir (beşer örnek). Düzenlenebilen modüllerde beş
kayıt örneği bulunur. INT koşusunda 100 geçmiş mesajı üzerinde büyüyen cevapta
40 çizim/frame örneği vardır. İç tıklamalar/frame'ler bağımsız koşu değildir.

Aşağıdaki özetler üç koşunun p95'lerinin medyanıdır; 30 tıklama veya 120 frame
birleştirilerek bağımsız örnek gibi kullanılmadı. CARD p95'i koşudaki 10 örneğin
maksimumudur. Bunlar yalnız sentetik renderer sonuçlarıdır; uygulama geneli
veya Windows/Electron hızlanması değildir. n=3 ile istatistiksel anlamlılık veya
gerilememe garantisi iddia edilmez. Eski tek koşu yeni kohorta eklenmedi.

| Koşul | A koşu p95 medyanı | B koşu p95 medyanı | Eşli p95 yüzde farkları (1 / 2 / 3) |
| --- | ---: | ---: | --- |
| license-cards/500/select | 491.7 ms | 145.7 ms | -69.51% / -65.37% / -72.69% |
| license-cards/500/search | 262.4 ms | 270.9 ms | -20.52% / +3.24% / +41.68% |
| license-cards/500/save | 848.5 ms | 466.6 ms | -40.88% / -46.53% / -48.05% |
| manufacturers/500/select | 63.0 ms | 2.2 ms | -95.20% / -93.81% / -97.07% |
| manufacturers/500/search | 39.6 ms | 36.5 ms | -8.08% / +14.42% / -13.85% |
| email-groups/500/select | 30.1 ms | 1.9 ms | -91.69% / -95.58% / -93.62% |
| email-groups/500/search | 23.9 ms | 22.2 ms | +3.77% / +5.71% / -66.56% |
| email-groups/500/save | 44.0 ms | 40.0 ms | -9.09% / +8.29% / -2.20% |
| license-cards/5000/select | 4430.3 ms | 1395.6 ms | -67.88% / -68.66% / -70.02% |
| license-cards/5000/search | 2694.5 ms | 2785.5 ms | -1.36% / -6.63% / +9.27% |
| license-cards/5000/save | 8344.5 ms | 4402.8 ms | -40.02% / -48.75% / -49.14% |
| manufacturers/5000/select | 441.9 ms | 2.4 ms | -99.32% / -99.48% / -99.55% |
| manufacturers/5000/search | 402.3 ms | 387.9 ms | -4.19% / +1.36% / -3.58% |
| email-groups/5000/select | 283.2 ms | 2.5 ms | -99.15% / -99.22% / -99.00% |
| email-groups/5000/search | 249.2 ms | 270.3 ms | +2.31% / +18.05% / -0.44% |
| email-groups/5000/save | 354.6 ms | 267.4 ms | -22.53% / -20.44% / -26.48% |
| lcwai/100-history/paint | 83.5 ms | 3.2 ms | -96.06% / -95.76% / -96.17% |

## Lisans araması: otomatik kabul yok

5.000 kayıt üzerindeki 10 arama örneği için bağımsız eşli p95 sonuçları:

| Çift | Sıra | A p95 | B p95 | B/A farkı |
| --- | --- | ---: | ---: | ---: |
| 1 | A/B | 2694,5 ms | 2657,8 ms | -%1,36 |
| 2 | B/A | 3163,3 ms | 2953,5 ms | -%6,63 |
| 3 | A/B | 2549,3 ms | 2785,5 ms | +%9,27 |

Eski 1911→2508 ms (+%31,2) farkı aynı yönde kararlı biçimde tekrarlanmadı;
buna karşılık üçüncü çiftte gerileme vardır. Koşu p95 medyanları 2694,5→2785,5
ms (+%3,38), eşli yüzde farklarının medyanı -%1,36'dır. Bu iki farklı özetin
birbirinin yerine kullanılmaması gerekir. Arama hızlanması veya gerilememe
sonucu çıkarılmadı; önceki ödünleşim kabulü bu devam için onay sayılmıyor.

## Dar CPU/layout/GC trace

Normal çiftler bittikten sonra ayrı A ve B tanısal tarayıcıları çalıştırıldı.
Aynı acceptance fixture dizisi kullanıldı; profiler ve trace yalnız 5.000
lisansın **10 arama örneği** boyunca açıktı. Bu iki tanısal kol yeni bağımsız
çift olarak sayılmadı ve profilli süreler normal benchmark sonucuna eklenmedi.

`trace-summary.json`, iç içe olayları çift saymamak için marker aralıklarına
kırpılmış main-thread span'lerini GC > HTML parse > style/layout > diğer
önceliğiyle ayrıştırır. “Diğer” saf JavaScript değildir; sınıflanmamış native
işleri de içerir. CPU örneklerinde `render` frame'i native DOM işlerini de
kapsadığı için JavaScript hesabı diye yorumlanmadı.

| 10 işaretli aramanın toplamı (tanısal) | A | B |
| --- | ---: | ---: |
| Marker süre toplamı | 14099,1 ms | 13798,0 ms |
| HTML parsing | 2145,9 ms | 2001,0 ms |
| Style/layout | 8316,2 ms | 8610,4 ms |
| GC ile ilişkili main-thread span'leri | 569,9 ms | 590,3 ms |
| Diğer | 3067,2 ms | 2596,3 ms |
| Örneklenen `E.rows` alt çağrı ağacı CPU'su | 494,8 ms | 130,2 ms |
| Örneklenen selector CPU'su | 107,3 ms | 217,6 ms |

**Doğrulandı:** Trace'in en yavaş örneği iki kolda da filtreyi temizleyen 9.
örnektir. A 2984,7 ms, B 3328,9 ms sürer. Ayrıştırılmış style/layout farkı
1723,5→2243,9 ms'dir; GC katkısı 516,9→311,8 ms ile ters yöndedir. İki kolda da
bir restyle ve bir layout vardır: restyle `elementCount=245108`, layout
`dirtyObjects=380157`, `totalObjects=380166` aynıdır. Tepe farkı bu tanısal
örnekte native style/layout süresindedir; yeni kural/list-model hesap artışı
veya ek layout çağrısı değildir.

**Bilinmiyor:** Aynı native iş miktarının bir kolda daha uzun sürmesinin
deterministik bir kod kök nedeni çıkarılamadı. B'nin selector işinde artış
ölçüldü, ancak 10 aramaya yayılan yaklaşık 110 ms bu örnekteki yaklaşık 520 ms
style/layout farkını açıklamıyor. Küçük bir selector guard'ını p95 düzeltmesi
diye sunmak kanıtsız olurdu; böyle bir ürün değişikliği yapılmadı.

Trace DOM sayaçları detached/henüz toplanmamış düğümleri de içerir. Fixture
ayrıca çıktı eşdeğerliği için HTML kopyaları üretir. Bu sayaçlar 5.000 veri
kaydından farklıdır ve ürünün gerçek bellek tüketimi olarak genellenmedi.
Eski tek koşuda trace bulunmadığından 1911→2508 farkının geçmiş nedeni bu
yeni trace ile kesin olarak atanmadı.

## Eşdeğerlik ve korumalar

Tüm kollarda liste/detay HTML kontrolü, kayıt kontrolleri ve A/B kayıt isteği
SHA-256 eşleşmesi geçti. B kollarında liste/satır kimliği, scroll 120→120,
draft focus/caret, kilit ve dil geçişi kontrolleri geçti. Her INT çiftinde
40 çizimde Markdown çağrısı 2040→40 oldu; güvenli Markdown/XSS, eksik code
fence, streaming/final HTML, dil ve sohbet geçişi eşdeğerliği geçti. Yeni AI
yolu veya içerik/temizleme davranışı eklenmedi.

## Kullanıcı kararı gereken lisans parçası

Gerileme otomatik kabul edilmedi. Kayıt/çıktı doğruluğu testlerinin yeşil olması
arama p95 ödünleşiminin onayı değildir. Lisans seçimi p95'inde üç çiftte de
yaklaşık %68–70 azalma vardır, fakat arama kuyruğunda gerilememe gösterilmedi.
Bu belirsizliği güvenilir şekilde giderecek küçük kapsam içi düzeltme
kanıtlanamadığından iki seçenek kullanıcıya sunulur:

1. **Lisans CARD-01 parçasını paketten ayırmak:** Lisans seçim kazancı bu
   pakete girmez; üretici/rehber, INT-09 ve CPR-11 korunur. Orijinal commit ve
   kanıtlar silinmez; ayrı bir takip commit'iyle kapsam ayrılır ve değişen son
   kod yeniden doğrulanır.
2. **Lisans parçasını ölçülmüş ödünleşimle korumak:** Seçim kazancı korunur;
   arama p95'inin karışık yönü ve tanısal native tail farkı bilinçli kabul edilir.

Bu karar uygulanmadı; mevcut PR hâlâ orijinal lisans değişikliğini içerir ve
merge edilmedi. TEST/STABLE yayımlanmadı.

## Yeniden çalıştırma

Ana komut ve kaynak hazırlığı `README.md` dosyasındadır. Eşli özet:

```sh
node resources/app/scripts/analyze-client-pairs.js \
  docs/performance/client-items-2026-11-07-followup/paired-initial
```

Tanısal komut (yeni bir trace-prefix kullanılmalıdır):

```sh
node resources/app/scripts/card-search-trace.js \
  --source-dir /tmp/client-followup-sources/A --trace-prefix /tmp/trace-A
node resources/app/scripts/analyze-card-search-trace.js \
  docs/performance/client-items-2026-11-07-followup/trace
```

B trace'i için B kaynak dizini ve `--assert-optimized` kullanılır. Normal ve
tanısal koşular birbirleriyle veya testlerle eşzamanlı çalıştırılmaz.

## Son entegre kodun doğrulaması

- İlgili filtre: 62 dosya / 522 test geçti, hata ve skip yok.
- Tam `npm test`: 1292 dosya / 10 batch tamamlandı; 8851 geçti,
  0 hata, 65 mevcut skip; süre 117.3s. Batch 1–10 başlangıç ve
  tamamlanmaları `validation/full-npm-test.txt`, tam çıktı sıkıştırılmış
  `validation/npm-test.log.gz` dosyasındadır. v714 de geçti.
- i18n: 0 yeni/eskiden kalan eksik; baseline boş.
- Release-note validator: 42 kayıt geçerli. Diğer sürüm notları ve dört mevcut
  gerçek PNG korundu; görünür ürün değişikliği yapılmadığı için yeni görsel
  üretilmedi.
- CPR hata/false/sürüm invalidation ve LCW AI güvenlik/eşdeğerlik regression
  testleri ilgili ve tam pakette geçti. Ölçülen CPR yolu aynı kaldığından
  beş eski mikro örnek tekrarlanmadı.
- `git diff --check` ve ölçüm/analiz araçlarının Node syntax kontrolleri geçti.
- GitHub kontrolleri SHA'ya özgüdür; son commit'in gerçek sonucu #906 üzerinden
  okunur ve son teslimde bildirilir. Eski baştaki yeşil check yeni SHA için
  geçerli sayılmaz.

Bağımsız insan/ikinci model incelemesi yapılmadı. GitHub review ve inline
yorum listeleri boştu; CI bağımsız kod incelemesi olarak sayılmadı. Merge
öncesi lisans kapsam kararı kullanıcıda kalır.
