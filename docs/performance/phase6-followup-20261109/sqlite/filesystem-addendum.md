# Ölçüm öncesi düzeltme — dosya sistemi

Son kontrol: /tmp = tmpfs; /workspace = overlayfs. run-2 ilk serisi RAM-backed
geçici dosya sistemi kullanmıştır. Bu seri silinmez veya disk/fsync sonucu diye
sunulmaz. Kaydedilen süreler yalnız o dosya sistemi içindir.

run-3-overlay: aynı source/prototype hash'leri, resmi Electron 44.3.0, aynı
10k/200k fixture ve 300 operasyon, aynı 3 dönüşümlü çift, concurrency=1, aynı
ön bütçe. TMPDIR yalnız izole prototipin .scratch dizinine alınır; ürün modu,
WAL eşiği, timeout/retry/cache/memory değişmez. Host disk/controller/flush modeli
bilinmiyor; overlay sonucu Windows/SSD/SMB veya power-loss kabulü değildir.
İki dosya sistemi serisi tek A/B dizisi yapılmaz. Kapanmamış tam API kapıları
aynı kalır. Mevcut tam npm test sonucu kaynakları değişmeyen ürüne aittir;
yeni kaynak davranışı eklenmez. Dosya sistemine duyarlı prototype/DB/sync/backup
ve crash kontrolleri yeni geçici kökte yeniden alınır. Son CI yalnız yeni final
head üzerinde değerlendirilir; önceki head CI'ı ona mal edilmez.
