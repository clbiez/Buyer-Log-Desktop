# Faz 5 · Ölçüm koşulları / Measurement conditions

TR: Bu belge bir performans kabulü veya kök neden onayı değildir. Sonuçlar
yalnız tamamlanmış koşulara bağlanır. Linux, Node 24.19 ve headless Chromium
kullanılır; Windows/Electron doğrulanmış değildir. CPU kotası
`1600000 400000` (dört CPU), varsayılan izinli işlemci listesi `0–4`, Node'un
kota farkındalığı olan `availableParallelism` değeri dörttür.

EN: This document does not approve performance acceptance or a root cause.
Claims must refer to completed runs. The environment uses Linux, Node 24.19
and headless Chromium; Windows/Electron are unverified. The CPU quota is
`1600000 400000` (four CPUs), the default allowed CPU list is `0–4`, and Node's
quota-aware `availableParallelism` reports four.

TR: `cf53f2d2` kodunda üç tam Faz 0 koşusu doğru satır/generation/revizyonla
geçti. Koleksiyon sonrası Overview boşlukları 127,7 / 111,9 / 111,4 ms oldu.
Aynı kodun ayrı interaktif serisinde üçüncü Global Flow penceresinde tek
293,5 ms aşımı vardı; bu seri kabul edilmedi. Diğer iki koşu ve üç Backlog
penceresi 200 ms altında kaldı. Önceki başarısız seriler silinmedi veya
başarılı örneklerle değiştirilmedi.

EN: Three complete F0 runs at `cf53f2d2` passed row, generation and revision
checks. Overview gaps after Collection were 127.7 / 111.9 / 111.4 ms. A separate
interactive cohort at the same code had one 293.5 ms exceedance in its third
Global Flow window and was not accepted. The other two runs and all three
Backlog windows stayed below 200 ms. Earlier failures remain retained.

TR: Native CPU profilli tanısal seride iki koşu sınır altında kaldı; üçüncü
Backlog penceresinde aşım yeniden oluştu. Bazı profil aralıkları idle veya
küçük runtime çağrılarıyla eşleşti; küçük bir profile ait JSON parse süresi
tek başına hesaplama kök nedeni olarak kabul edilmedi. Bu yardımcıdaki CPU
zamanlayıcısı kancası, gözlemci modülü otomatik başladıktan sonra kurulduğu
için bağlanmamıştı; bu seriden per-thread CPU aralığı sonucu çıkarılmadı.
CPU profili, native çağrı zamanları ve GC kayıtları ise saklanır.

EN: Two native CPU-profile diagnostic runs stayed below the limit; the third
Backlog window reproduced exceedances. Some sampled ranges matched idle or
small runtime frames. A small profile's JSON parsing duration alone was not
treated as a computation root cause. This helper installed its timer hook
after the observer auto-started, so per-thread CPU interval data was absent
and is not claimed for that cohort. CPU profiles, native timings and GC
records remain retained.

TR: Sonraki kontrollü tanı serisinde dört ve beş izinli işlemciyle üçer koşu
dönüşümlü çalıştı. Beş işlemcili üç koşu sınır altında kaldı; dört işlemcili
iki koşuda aşım oldu. Bir aşımda ana thread yaklaşık 230,5 ms içinde yalnız
0,34 ms CPU kullandı; kontrol worker'ı da eşzamanlı bekledi. GC, cgroup kota
aşımı veya bellek reclaim kaydı bu aralıkla örtüşmedi. İşlemci sabitleme
çözüm olarak uygulanmadı. İlk denetleyicinin `availableParallelism` değerini
izinli liste uzunluğu sanan assertion'ı düzeltildi; asıl başarısız denetleyici
kaydı korundu ve uygulama kabul eşiği değiştirilmedi.

EN: A controlled diagnostic alternated three runs with four and five allowed
CPUs. All five-CPU runs stayed below the limit; two four-CPU runs exceeded it.
In one exceedance MAIN used only 0.34 ms CPU during roughly 230.5 ms wall time,
while the control worker waited concurrently. No GC, cgroup throttling or
memory reclaim overlapped that range. CPU affinity was not adopted as a fix.
The controller's assertion incorrectly equating `availableParallelism` with
affinity cardinality was corrected; its failed ledger remains retained and
the application acceptance threshold was unchanged.

TR: Ayrı, iş yapmayan bir Node süreciyle alınan üçlü tanıda eşzamanlı gecikme
örnekleri görüldü; ortak worker GC'si bu aşım aralıklarıyla örtüşmedi. Bu,
ortam/zamanlama bileşeni için kanıttır; ilk normal 293,5 ms örneğinin kesin
kök nedenini kanıtlamaz. Özel tanı yardımcıları kabul ölçümü sayılmaz.

EN: A further three-run diagnostic observed simultaneous delay samples in an
independent idle Node process; common-worker GC did not overlap the exceedance
ranges. This supports an environment/scheduling component, but does not prove
the exact cause of the original normal 293.5 ms sample. Diagnostic helpers are
not acceptance measurements.

TR: Normal benchmark gözlemcisi artık aynı 10 ms zamanlayıcıda per-thread
kullanıcı/çekirdek CPU farkını ve GC zaman aralıklarını da sayısal halkaya
yazar. MAIN'de RSS örneklemesi, stack üretimi, JSON/UTF-8 kodlama veya dosya
yazımı yoktur. GC için ayrı kayıt tipi kullanılır; GC kayıtları timer stall
sayısına eklenmez. Bozuk CPU/GC kaydı reddedilir. 200 ms eşiği ve sınırla
örtüşen boşluğu tam tutma kuralı aynıdır. Önceki gözlemci dosyaları korunur;
yeni composite hash ile önce/sonra yeniden ölçülür.

EN: The normal benchmark observer now records per-thread user/system CPU
deltas on the same 10 ms timer and numeric GC ranges in its shared ring.
MAIN performs no RSS sampling, stack construction, JSON/UTF-8 encoding or
observer disk writes. GC uses a separate record type and is not counted as a
timer stall. Malformed CPU/GC records reject. The 200 ms threshold and full-gap
boundary rule are unchanged. Historical observer bytes remain available;
before/after comparisons must use the new matching composite hash.

TR: Gözlemci mikro ölçümü altı taze süreçte, dönüşümlü üç önce/sonra koşusu ve
açılış sonrası iki saniyelik pencerelerle yapıldı. Ana thread CPU medyanı
9,295 → 10,273 ms/s oldu (ek yaklaşık 0,979 ms/s). Bu bir uygulama hızlanması
değildir; gözlemci maliyetidir. Ham dosyalar ve özet kanıtla birlikte tutulur.

EN: An observer-only micro used six fresh processes, three alternating
before/after runs and two-second windows after startup. Median MAIN CPU was
9.295 → 10.273 ms/s, an additional approximately 0.979 ms/s. This measures
observer overhead, not an application speedup. Raw files and the summary are
retained with the evidence.

TR: `/tmp` bir tmpfs'tir; geçmiş kanıtları korurken neredeyse doldu. Yeni
koşular yalnız komutun `TMPDIR` değeriyle özel overlayfs dizinini kullanır.
Fixture'ın doğrudan sistem temp dizininde olması, symlink reddi, sentetik
marker ve SHA kontrolleri değiştirilmez. Kaynak anchor dosyaları yeni temp
dizinine birebir SHA doğrulamasıyla kopyalanmıştır; eski anchor değişmez.
Önce ve sonra aynı yeni depolama/gözlemci koşulunda alınır. Eski sayılarla
doğrudan depolama kazancı veya soğuk OS cache iddiası yapılmaz. Geçmiş
dosyaların arşivlenmesi yalnız koşular arasında, byte/SHA ve mtime korunarak,
eski yolları symlink ile erişilebilir tutarak yapıldı; audit veya kimlik
dosyaları taşınmadı.

EN: `/tmp` is tmpfs and became nearly full while retaining historical evidence.
New runs use a private overlayfs directory through the command's `TMPDIR`.
Direct-child temp-root, symlink rejection, synthetic marker and SHA guards
remain unchanged. Source anchor files were copied to the new temp root with
exact SHA verification; the old anchor is unchanged. Both arms use the same
new storage and observer conditions. No storage speedup versus historical
numbers or cold OS-cache claim is made. Historical files were archived only
between runs, with byte/SHA and mtime preservation and symlinks retaining
their original paths. No audit or identity files were moved.
