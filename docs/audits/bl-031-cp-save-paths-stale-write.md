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
   
   Satır kaydı yanıtı `updated` taşımadığı için kendi artış `applied[].noop`'tan çıkarılır. Aksi hâlde belirteç bayat kalır ve sıradaki eski yol yazması mevcut çakışma yoluna düşer (409 → uyarı + yeniden yükleme).

## Doğrulama (gerçek tarayıcı, 3/3, düzeltme sonrası)

| Senaryo | Önce | Sonra |
|---|---|---|
| Supp. FOB, dokunulmamış not (A kanal kapalı + başka satırda satır kaydı) | B'nin notu silindi | Not korundu; A'nın Supp. FOB'u kaydedildi |
| Aynı alan Supp. FOB | B ezildi | A 409 + uyarı; B korundu |
| Aynı alan toplu not yapıştırma | B ezildi | A 409; B korundu |
| Tek kullanıcı, karışık yollar art arda | Hepsi kaydedildi | Hepsi kaydedildi; yanlış çakışma yok |
| Aynı pencerede not + Supp. FOB | — | İkisi de kaydedildi |
| Canlı kanal açık / kapalı | Not korunuyordu | Not korunuyor |

## Kalan sınırlar ve öneri

- **Bilinen sınır [Doğrulandı]:** Canlı kanal açıkken A, B'nin değerini görür; ancak A'nın belirteci canlı yamayla ilerlemez. A'nın sonraki eski yol yazması 409 + yeniden yükleme ile reddedilir. Bu sessiz değildir; kullanıcı düzenlemesini yeniden yapar. Bu davranış düzeltmeden önce de vardı.
- **Kalıcı birleşik çözüm (öneri, ayrı iş):** Eski yolda kalan alanları satır kaydına (alan bazlı `base`) taşımak. Bu alanlar: Supp. FOB/meta, fiyat geçmişi geri yüklemesi, lisansör-fiyat atomikliği, önem, eksik adet, görsel. Böylece global CAS ve iki paralel kayıt yolu kalkar (CLAUDE.md §4.0 ilke 10).
  - Bu iş Supp. FOB revizyon zinciri ile `_cpStored` projeksiyonuna (cp-row-stored) Supp. FOB eklenmesini gerektirir. Fiyat doğruluğu riski taşıyan P1 kapsamdadır; bu PR'ı büyütmemek için ayrıldı.
