# BL-029 · Del. Type çoklu yapıştırmada ilk satıra farklı değer (doğruluk kaydı; kök neden doğrulanmadı)

Durum: **Açık — kök neden doğrulanmadı; çözüm üretilmeyecek.** Tarih: 2026-11-27.
Kaynak: ADR-0003 §6I madde 5 (gerçek Chromium, 30k demo; kollar main `b7b172d` ve niyet düzeltmesi `3b23455`).

## Gözlem [Doğrulandı: tek senaryo]

- **Ne yapıldı:** Panodan "Uçak" değeri iki satıra yapıştırıldı.
- **Ne gönderildi:** Kayıt gövdesinde değerler `["Gemi", "Uçak"]` sırasındaydı; ilk satır "Gemi" gönderdi.
- İki kolda birebir aynı. Yani #1243'ün getirdiği bir değişiklik değil, mevcut davranış.

## Bilinmeyenler

- **Ana belirsizlik:** Bu bir ürün hatası mı, yoksa test düzeneğinin seçim aralığı mı [Bilinmiyor]? Olası nedenler: seçimin ilk hücresi, odaktaki editörün yapıştırmadan önce kendi değerini kaydetmesi ya da yapıştırma hedefinin bir satır kayması [Hipotez; hiçbiri doğrulanmadı].
- Elle yapıştırmada tekrarlanıp tekrarlanmadığı ölçülmedi.
- Diğer sütunlarda (Supp. FOB, Notes) aynı ilk satır sapmasının olup olmadığı ölçülmedi.

## Sonraki adım (karar sonrası)

1. Yeniden üretim: Seçim aralığı, odak ve klavye yolu kaydedilerek elle ve otomatik olarak, en az 3 tekrar.
2. Kök neden: `public/app-main.js` yapıştırma yolu (`cp-paste`, `commitCpEditor` toplu çağrısı). Odaktaki editörün blur/change sırası incelenir.
3. Kök neden doğrulanmadan kod değişikliği yapılmaz.
