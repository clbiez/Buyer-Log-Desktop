# BL-031 · CP kayıt yolları: bayat değer yazma ve başka oturumu ezme denetimi (P1)

Durum: **Düzeltildi** (`claude/cp-suppfob-notes-overwrite`, 2026-11-28).

**Kaynak:** Kararlılık oturumu bulgusu (kapı G08b). Bu bulgu gerçek istemciyle yeniden üretildi; ardından ürün sahibinin istediği tam tarama yapıldı.

Bu belgedeki kanıtların hepsi gerçek sunucu ve iki Chromium istemcisiyle elde edildi. İki istemci de demo veri kullandı. Her senaryo 3 kez koşuldu. Tek hesapla iki istemci (iki ayrı sekme oturumu) kullanıldı.

## Ortak kök neden [Doğrulandı]

Eski kayıt yollarının tek koruması **global revizyon CAS**'ıdır. Bu yollar şunlardır: `PATCH /api/overrides/:kod`, `/batch`, `/batch-suppfob`. Satır kaydı (`POST /rows`) bunlardan farklı olarak alan bazlı `base` karşılaştırması yapar.

İstemcinin "depoyu bu sürüme kadar gördüm" belirteci (`state.storeRevisions`) **her onayda** sunucunun döndürdüğü değere taşınıyordu. Bunun kaynakları:
- satır kaydı onayı (`cpRowSaveSend`),
- eski yol onayı (`enqueueOverrideMutation`).

Bu onaylar başka oturumların aradaki yazmalarını içerdiği hâlde istemci o satırları yenilemiyordu. Sonuç olarak CAS "görülmemiş değişikliği görülmüş" sayıyor ve bayat gövde sessizce kazanıyordu. Canlı kanal açıkken satır yaması değeri getirir, ama belirteci ilerletmez. Kanal kapalı ya da gecikmeliyken pencere açılır.

İkinci etken: eski yol gövdesi (`syncOverrideToServer`) satırın tüm görünür durumunu taşıyordu. Bu durum şunları içeriyordu:
- dokunulmamış not çifti ve not sütunları,
- alt üretici, lisansör,
- bu oturumun önceki manuel Supp. FOB'u.

## Kayıt yolları

| Yol | Gönderilen alanlar | Karşılaştırma | Çakışma davranışı | Risk (önce) | Durum |
|---|---|---|---|---|---|
| `POST /rows` (satır kaydı: not, Del. Type, alt üretici, not sütunu, tarih) | Yalnız dokunulan birimler + `base` | Alan bazlı (`base` = `_cpStored`) | Satır çakışması, değer geri gösterilir, uyarı | Yok (bayat base → çakışma) [Doğrulandı: mevcut testler + #1255] | Değişmedi. Onayı artık belirteci yalnız kendi artışıyla ilerletir |
| `PATCH /:kod` · `syncOverrideToServer` eski dalı (Supp. FOB, lisansör, fiyat geçmişi, satır kaydı kapalı/kimliksiz) | Önce: satırın tüm durumu. Şimdi: değişen alanlar | Global CAS | 409, uyarı, yeniden yükleme | **Dokunulmamış not ezme [Doğrulandı 3/3]**, **aynı alan Supp. FOB ezme [Doğrulandı 3/3]** | Düzeltildi (iki commit) |
| `/batch` · toplu yapıştırma / toplu geri al / CP içe aktarma | Yapıştırılan alanlar | Global CAS (önizleme revizyonu) | 409, işlem reddedildi | **Aynı alan not ezme [Doğrulandı 3/3]** | Düzeltildi (belirteç) |
| `/batch` · not düzenleyici penceresi (zengin not) | Not çifti | Global CAS | 409 | Aynı sınıf [Muhtemel: aynı CAS; tarayıcıda koşulmadı] | Belirteç düzeltmesi kapsar |
| `PATCH` · önem, görsel, eksik adet, eski yol tarihleri | Yalnız kendi alanı | Global CAS | 409 | Aynı alan ezme [Muhtemel: aynı CAS] | Belirteç düzeltmesi kapsar |
| `/batch-suppfob` · fiyat kuralı uygula | Eşleşen satırların Supp. FOB'u | Supp. FOB revizyon CAS | 409 | Belirteç eski yol onaylarıyla görülmeden ilerleyebiliyordu [Muhtemel] | Belirteç düzeltmesi kapsar. Eşleşen satırlarda başkasının manuel fiyatını da yazması **iş kuralıdır** (açık toplu eylem), değiştirilmedi |
| Del. Type | Yalnız açık niyetle (#1243) | Satır kaydı ya da global CAS | — | #1243/#1253 ile kapandı | — |
| Geri al / yinele (tekil) | Kendi düzenleme yolu | Yukarıdaki gibi | — | Kendi yolunun riski | Kapsanır |

## Düzeltmeler

Mevcut mekanizmalar kullanıldı; yeni paralel yol eklenmedi.

1. **Gövde** (`cpLegacyBodyWithoutUnchanged`):
   - Eski yolda, satırın kayıtlı değeriyle (`_cpStored`, satır kaydının base'i) aynı olan not çifti, not sütunu, alt üretici ve lisansör gönderilmez.
   - Supp. FOB yalnız açık niyetle (`_pricingManualWrite`, #1243 deseni) gider.
   - Açık alt üretici yazımı ve fiyat geçmişi geri yüklemesi alanı her zaman taşır.
2. **Revizyon belirteci** (`adoptAckRevision`, `override-sync.js`). Onay belirteci yalnız şu iki durumda ilerletir:
   - sunucu bu istekte o anahtarı CAS ile doğruladıysa,
   - ya da yeni değer yalnız bu yazmanın kendi artışıysa.
   
   - Satır kaydı yanıtı `updated` taşımaz; kendi revizyon `applied[].noop`'tan anlaşılır.
   - İki kuyruk eşzamanlı çalıştığı için kendi revizyonlar kaydedilir. Belirteç ardışık kendi revizyonları boyunca ilerler; onayların sırasız gelmesi yanlış çakışma üretmez.
   - Tam yükleme CAS belirteçlerini geri götürmez (`mergeStoreRevisions`).
   - Aksi hâlde belirteç bayat kalır ve sıradaki eski yol yazması mevcut çakışma yoluna düşer (409 → uyarı + yeniden yükleme).
3. **Gövde kuyrukta kurulur.** Süzme, eski yol kuyruğunda gönderimden hemen önce yapılır. Böylece önceki kaydın onayı kayıtlı değeri güncellemiş olur ve yoldaki kayıt sırasında yapılan A→B→A geri yazımı düşmez.

Bağımsız inceleme (oturum içi alt ajan, tek tur) iki kusur buldu ve ikisi düzeltildi:
- yoldaki kayıt sırasında geri yazımın düşmesi,
- sırasız onayda belirtecin takılı kalması.

## Doğrulama (gerçek tarayıcı, 3/3, düzeltme sonrası)

| Senaryo | Önce | Sonra |
|---|---|---|
| Supp. FOB, dokunulmamış not (A kanal kapalı + başka satırda satır kaydı) | B'nin notu silindi | Not korundu. A'nın Supp. FOB'u, A'nın görmediği bir yazma araya girdiği için 409 ile reddedilir (uyarı + yeniden yükleme); kullanıcı yeniden girer. Bu, veri bütünlüğü > UX sırasının sonucu; birleşik çözüm (alan bazlı base) ikisini birden kaydeder |
| Aynı alan Supp. FOB | B ezildi | A 409 + uyarı; B korundu |
| Aynı alan toplu not yapıştırma | B ezildi | A 409; B korundu |
| Tek kullanıcı, karışık yollar art arda | Hepsi kaydedildi | Hepsi kaydedildi; yanlış çakışma yok |
| Aynı pencerede not + Supp. FOB | — | İkisi de kaydedildi |
| Canlı kanal açık / kapalı | Not korunuyordu | Not korunuyor |

## Kalan sınırlar ve öneri

- **Bilinen sınır [Doğrulandı]:** Canlı kanal açıkken A, B'nin değerini görür; ancak A'nın belirteci canlı yamayla ilerlemez. A'nın sonraki eski yol yazması 409 + yeniden yükleme ile reddedilir. Bu sessiz değildir; kullanıcı düzenlemesini yeniden yapar. Bu davranış düzeltmeden önce de vardı.
- **Kalıcı birleşik çözüm (öneri, ayrı iş):** Eski yolda kalan alanları satır kaydına (alan bazlı `base`) taşımak. Bu alanlar: Supp. FOB/meta, fiyat geçmişi geri yüklemesi, lisansör-fiyat atomikliği, önem, eksik adet, görsel. Böylece global CAS ve iki paralel kayıt yolu kalkar (CLAUDE.md §4.0 ilke 10).
  - Bu iş Supp. FOB revizyon zinciri ile `_cpStored` projeksiyonuna (cp-row-stored) Supp. FOB eklenmesini gerektirir. Fiyat doğruluğu riski taşıyan P1 kapsamdadır; bu PR'ı büyütmemek için ayrıldı.

## Sonraki öncelikli mimari iş (2026-11-28, ürün sahibi kararıyla kayıtlı; başlatılmadı)

**BL-031-A · Tek kayıt yolu ve canlı güncelleme ile revizyon belirtecinin tutarlılığı — birlikte değerlendirilecek tek iş.**

İki sorun aynı kök nedenden gelir: CP'de iki paralel kayıt protokolü var (alan bazlı `base` karşılaştırmalı satır kaydı `POST /rows` ve global revizyon CAS'lı eski yollar `PATCH /:kod`, `/batch`, `/batch-suppfob`) ve global CAS belirteci canlı satır yamalarıyla tutarlı tutulamıyor.

1. **Kayıt yollarının birleştirilmesi:** Eski yolda kalan alanlar (Supp. FOB/meta, fiyat geçmişi geri yüklemesi, lisansör-fiyat atomikliği, önem, eksik adet, görsel, toplu yapıştırma/içe aktarma) satır kaydının alan bazlı `base` sözleşmesine taşınır; global CAS ve paralel yol kalkar (CLAUDE.md §4.0 ilke 10). Gerektirdiği: Supp. FOB revizyon zinciri ve `_cpStored` projeksiyonuna (cp-row-stored) Supp. FOB.
2. **Canlı güncelleme ↔ revizyon belirteci:** Bugün canlı satır yaması değeri getirir ama belirteci ilerletmez; bayat belirteçli istemcinin sonraki eski yol yazması 409 + uyarı + yeniden yükleme alır (sessiz kayıp yok; UX sürtünmesi). #1259'daki (lojistik artımlı güncelleme) Del. Type / Ex-factory canlı yamalarıyla bu durum daha sık görülebilir.
   - (1) yapılırsa global CAS kalkacağı için (2) büyük ölçüde ortadan kalkar; bu yüzden ayrı bir "belirteç ilerletme" mekanizması kurulmamalı. Önce (1) tasarlanır, (2) onun kabul ölçütü olur.
- Risk sınıfı: P1 (çok kullanıcılı veri tutarlılığı, fiyat doğruluğu). Bağımsız beklenen değerli testler, iki istemci gerçek sunucu senaryoları ve Windows `BuyerLog.exe` kapısı (G08b/G08d) kabul ölçütüdür.
- İlgili açık iş: BL-028-A (sipariş anahtarlı eski override) aynı tasarımda ele alınır.
