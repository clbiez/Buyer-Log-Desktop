# Aşama 1 prototipi: cihaz başına değişmez olay günlüğü (GEÇİCİ, ÜRETİM DIŞI)

ADR-0001 Aşama 1'in izole, karşılaştırmalı prototipi. Uygulamaya bağlı değildir ve `resources/app` dışında durur, bu yüzden pakete girmez. `npm test` kapsamında değildir. Karar verildikten sonra silinmesi ya da üretim tasarımına dönüştürülmesi gerekir; kalıcı ikinci bir senkron motoru olarak bırakılmaz.

```bash
node --test prototypes/collection-oplog/oplog-prototype.test.js         # 10 deterministik test
node prototypes/collection-oplog/compare-causal-cloud.js 30000 40       # rastgele karşılaştırma
```

## Ne kaldırılıyor (mimari düzeyde)

| Mevcut mekanizma | Prototipte |
| --- | --- |
| Birden çok cihazın aynı dosyaya yazması | Yok. Cihaz yalnız `oplog/<owner>/<deviceId>/` altına yazar. |
| Ortak dosya kilidi / kira, CAS yarışı | Yok. Dosya adları benzersiz ve dosyalar değişmez (testle doğrulandı). |
| Her değişiklikte tüm belgenin yayımı | Yok. Düzenleme başına ~183 baytlık tek dosya (30k satırlık zarf ~9,2 MB). |
| Başka cihazın verisinin fiziksel olarak ezilmesi | Yapısal olarak imkânsız: üzerine yazma yok. |
| Tüm belge üzerinden ortak ata tahmini | Yok. Her yazım ezdiği sürümleri (`prev`) taşır; eşzamanlılık kesin bilinir. |
| Dosya teslim sırasına bağımlılık | Yok. Durum kayıt **kümesinin** deterministik fonksiyonudur (50 rastgele sıra/tekrar testi). |

## Doğrulanan özellikler (`oplog-prototype.test.js`)

- **Kesinlik:** Tek fiziksel yazar ve değişmezlik; sırasız, tekrarlı ve kısmi teslim; öncülü gelmemiş yazımın uygulanmayıp bekletilmesi (kaybolmaz).
- **Çakışma:** Eşzamanlı aynı alan tek çakışma kaydı üretir; politika parametredir. Çakışmayı gören kullanıcının yazımı çakışmayı kapatır.
- **Silme:** Silenin görmediği eşzamanlı düzenleme varsa satır kalır ve bildirilir; silen her şeyi görmüşse satır silinir.
- **Durumlar:** Yerel kalıcı ≠ yayımlanmış ≠ görülmüş. Paylaşım yokken yazım kaybolmaz ve yeniden başlatmadan sağ çıkar.
- **Yeniden kurulum:** Yeni cihaz kimliği alınır; eski dosyalar ezilmez; yanlış çakışma oluşmaz.
- **Yedekten eski durum:** `seq` tekrar kullanılır ama dosya ezilmez, çatal tespit edilir, veri kaybolmaz.
- **Yetki geri alma:** Saate değil, geri alanın **gördüğü** kayıtlara bağlıdır. Saati geri alınmış ve geri almayı görmemiş cihazın sonraki yazımı uygulanmaz; sahibin inceleme kuyruğuna düşer.
- **Checkpoint + budama:**
  - Yeni cihaz aynı durumu kurar.
  - Budanmış geçmişten sonra gelen geç düzenleme silmeyle kaybolmaz; satır kalır ve bildirilir.
  - Yetki durumu da checkpoint'te taşınır. Bu açık testle bulundu: budama izin kaydını silince geç gelen düzenleme haksız yere karantinaya düşüyordu.
- **Determinizm:** Tam değişimden sonra tüm cihazlar aynı durumu ve aynı çakışmaları üretir.

Testlerin bulup düzelttiği tasarım açıkları:
1. Başka cihazlardan alınan kayıtlar yerelde saklanmıyordu; çevrimdışı yeniden başlatmada satırlar görünmüyordu.
2. Checkpoint, yetki durumunu taşımıyordu.

## Karşılaştırma (aynı işlem karışımı ve aynı oracle kuralları; 3 cihaz, 10 satır, 2 alan)

| Motor | Bulut modeli | Seed | Kesin ihlal | Bilinen sınır (bildirilmiş) |
| --- | --- | --- | --- | --- |
| Mevcut, düzeltme öncesi (`df778c0`) | Gerçekçi (eski tabanlı yükleme yerinden edilir) | 40 | 40/40 seed (111 sessiz kayıp, 376 sessizce düşen yeni değer …) | — |
| Mevcut + Aşama 0 | Gerçekçi | 120 | 0 | 10/120 seed |
| Mevcut + Aşama 0 | Düşmanca (eski tabanlı yükleme kazanabilir) | 40 | 4/40 seed | 9/40 seed |
| **Prototip** | Kısmi + sırasız + tekrarlı teslim, kesintili yayım, yeniden başlatma | 120 | **0** | **0** |

**Karşılaştırmanın sınırları:**
- Bulut modelleri birebir aynı değil. Prototipte üzerine yazma olmadığı için "yerinden edilme" tanım gereği yok; buna karşılık mevcut motorun kaldıramadığı kısmi/sırasız teslim prototip modelinde var.
- Oracle'daki "ezilen değer" tanımı prototipte görünen tüm başları içerir; mevcut motorda kullanıcı yalnız kazananı görür. Bu, her motorun kullanıcıya gösterdiği anlamla tutarlıdır.
- Prototip oracle'ında bir düzeltme yapıldı: yazımın ezdiği tüm baş değerleri kaydediliyor. İzle gösterilmiş bir yanlış alarmdı.

## Ölçülen maliyet (30k satır × 18 alan, Linux container)

| Ölçüm | Değer |
| --- | --- |
| Tüm kayıtları baştan katlama (+1.000 düzenleme) | 1.342 ms, ~347 MB heap |
| Checkpoint üretimi | 2.244 ms; JSON **58,5 MB** (zarfın ~6 katı) |
| Checkpoint + 100 yeni kayıttan katlama | 1.182 ms |
| Düzenleme başına yayım | 183 bayt, tek dosya |

**Sonuç:** Doğruluk avantajı güçlü; prototipin hesaplama ve depolama tarafı ise naif. Üretime yaklaşmak için şunlar gerekir ve hepsi ölçülmeden iddia edilemez:
- Artımlı katlama: yeni kayıt yalnız etkilediği hücreyi günceller.
- Kompakt checkpoint: satır başına değer + alan başına sürüm kimliği; tam sürüm nesnesi yerine.
- Dosya sayısının budamayla sınırlanması.

## Açık ürün / tasarım kararları

1. **Eşzamanlı aynı alan politikası:** Bugünkü "önce yayımlanan kalır" kuralının bu modelde yayım yarışı yok. Deterministik karşılığı `earliest-wins` (HLC). Aynı şey değildir; karar ürün sahibinde.
2. **Yetki geri alma sonrası kuyruğa düşen kayıtların gösterimi ve çözümü (UI).**
3. **Silme işareti ve dosya budama ufku:** 30 günlük paket saklamasıyla ilişkisi.
4. **Geçiş:** Mevcut zarfla gölge mod, sonra okuma kaynağının değişmesi (ADR-0001 Aşama 1–2).

## İterasyon 2 — artımlı ve saatsiz (`oplog-incremental.js`)

Ürün sahibi kararı: saat bazlı çakışma çözümü kabul edilmedi. İterasyon 1'deki `earliest-wins` bir parametreydi ve sahte kesinlik üretiyordu; iterasyon 2'de hiçbir karar duvar saatine ya da HLC'ye bakmaz.

| Özellik | Davranış |
| --- | --- |
| Nedensel tamponlama | Bir kayıt, dayandığı tüm sürümler uygulanmadan uygulanmaz; geç gelen öncül tamponu çözer. "Sürüm biliniyor mu" sorusu "kaydı uygulandı mı" sorusuna indirgenir; sürüm başına küme tutulmaz. |
| Kompakt durum | Hücre başına yalnız baş sürümler. Ezilen geçmiş tutulmaz. |
| Eşzamanlı aynı alan | Başların hepsi korunur, hücre `unresolved` çakışma olur. Görüntülenecek değer yalnız yakınsama için sürüm kimliği özetiyle seçilir; bu bir "kazanan" iddiası değildir. |
| Yetki | Varış sırasından bağımsız. İzin sonradan gelirse geçici karantina yeniden denenir. Geri alma sonradan gelirse ve kesimin ötesinde uygulanmış kayıt varsa durum, yetki kayıtları önce olmak üzere yeniden kurulur. İzinsiz kayda dayananlar bekler; kesin reddedilene dayananlar onu yok sayar. |

**Doğrulama** (20 seed, karşılaştırma senaryolarının kayıt kümeleri):
- Tam katlamayla 384 hücrede baş-değer kümesi 0 fark.
- Rastgele sıra + tekrarlı teslimle 100 karıştırmada 0 fark.
- İlk sürüm 100'de 93 farklı sonuç verdi. Kök neden ölçümle ayrıldı: varış sırasına bağlı yetki kararı ve geçici karantinanın "uygulanmış" sayılması. İkisi düzeltildi.

**Ölçek** (30k satır × 18 alan, Linux container):

| Düzenleme geçmişi | 1.000 | 10.000 | 50.000 |
| --- | --- | --- | --- |
| Checkpoint | 24,4 MB | 24,4 MB | 24,7 MB |
| Checkpoint'ten açılış | 297 ms | 266 ms | 318 ms |
| Açılış sonrası 100 yeni kayıt | 0,5 ms | 0,3 ms | 0,2 ms |
| Tam görünüm üretimi | 87 ms | 122 ms | 146 ms |

İterasyon 1'de tam katlama 1.436 ms ve checkpoint 58,5 MB idi. Maliyet artık geçmiş uzunluğuyla büyümüyor; yerel DB'deki journal büyümesi sorunu yeniden üretilmedi.

**Kalan ölçek açıkları:**
- Checkpoint, mevcut zarfın (9,2 MB) ~2,7 katı. Nedeni, sürüm kimliklerinin hücre başına metin olarak tutulması; satır başına yaratma kimliği + alan indeksiyle kodlanabilir (ölçülmedi).
- Uygulanmış kayıt kümesi çok yavaş büyüyor (49 bin düzenlemede ~0,3 MB); cihaz başına sınır değeri (watermark) gerekir.
- Görünüm her seferinde tam üretiliyor; artımlı görünüm (yalnız değişen hücre) ölçülmedi.

## Mevcut çakışma politikası bu modelde hangi koşulda korunur?

Mevcut kural: eşzamanlı aynı alanda önce yayımlanan kalır, diğeri çakışma kaydına düşer.

| Durum | Korunabilir mi? |
| --- | --- |
| İkinci yazar, birinci yayımı **görerek** yazdı (nedensel sıra var) | **Evet ve kesin.** Bu eşzamanlılık değildir; sonraki yazım öncekini ezer, çakışma yoktur. |
| İki yazar birbirini görmeden yazdı (gerçek eşzamanlılık) | **Hayır, merkezi koordinasyon olmadan.** "Önce yayımlanan" bilgisi ortak dosyanın sırasından gelir. Cihaz başına değişmez günlükte ortak sıra yoktur ve OneDrive teslim sırası cihazdan cihaza değişir. Saat güvenilmez (ürün sahibi kararı). |

Gerçek eşzamanlılık için **ürün sahibi seçenekleri:**
- **A · Çözülmemiş çakışma (iterasyon 2'nin varsayılanı):** İki değer de korunur, hücre çakışmalı görünür, kullanıcı seçer. Sahte kesinlik yok; kullanıcıya iş yükü getirir.
- **B · İş kuralıyla öncelik:** Örneğin Koleksiyon sahibinin değeri kalır, diğeri kayda düşer. Deterministik ve saatsiz. Hangi alanda kimin öncelikli olduğu iş kararıdır.
- **C · Çevrimiçi koordinatör:** Sahip ya da moderatör cihazı çevrimiçiyken sırayı belirler; çevrimdışıyken A'ya düşülür. "Önce yayımlanan" anlamına en yakın seçenek, ama tek cihaza bağımlılık getirir.
