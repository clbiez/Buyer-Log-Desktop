# Ön kayıt — 2026-11-09 / #952

Base origin/main: d0fdb888 (tam SHA provenance.json). Risk: izole araştırma;
ürün runtime davranışı değişmez. Yalnız bu kanıt dizini ve
scripts/prototypes/sqlite-decision-20261109/ değişebilir.
Arşiv abc683e4bcc247a7e8e412c07532bc8059fe3adb kaynak olarak yeniden
kullanılır; branch merge edilmez. Diğer iki aday kullanılmaz.

Bütçe (ölçüm ve prototype uyarlamasından önce): doğruluk farkı=0,
onaylı yazı kaybı=0, eksik backup restore=0; repeatable süre/CPU/peak RSS/heap
artışı=0. SQLite daha hızlı open ile hydrate maliyetini gizleyemez.
Tam API/owner/conflict/ACK/backup/platform kapısı eksikse teslim BLOCKED,
öneri WAIT. Gürültüyle PASS üretilecekse 3 A/A gerekir; aksi halde farklar
ham gözlem olarak kalır. p95 yalnız sınıf başına >=20 gözlemde.

Mevcut 10k ve 200k event fixture; 300 mixed operation; concurrency=1.
Üç dönüşümlü fresh-process local/sqlite çifti (AB,BA,AB), aynı olay hash'i
ve bağımsız workload oracle. Süre: open/replay+ilk tüm-record hydrate;
tekrar hydrate, read/write/batch, compaction, CPU/event-loop gap, peak RSS
ve sampled heap, disk aileleri ve bağımsız consistent backup/restore.
OS cache sıcak; process-cold ve process-warm ayrı. Fiziksel cold disk
ve imzalı Windows/Electron UI kabulü yoksa açık BLOCKED.

Backup alt sınaması: yazar yokken her iki motorda tüm dosya ailesinin
bağımsız kopyası + hash manifest + restore/reopen/oracle. Bu sınama üretim
backup API'sinin eşdeğerliği veya concurrent backup güvencesi değildir.
SIGKILL: ACK, append/commit öncesi, compaction, checkpoint ve backup
sınırları; desteklenmeyen sınır açık kalır. Power-loss iddiası yok.
200k SHARED_LEASE_LOST stdout/stderr korunarak tekrar aranır;
geçersiz kontrol PASS sayılmaz ve ürün lease'i değiştirilmez.

Prototype değiştiği için ilgili prototype, local-db/sync/backup testleri,
standart kesintisiz npm test (concurrency=4), i18n/not kontrolleri ve son
head gerçek PR CI zorunlu. Test hataları saklanır; batch birleştirerek PASS yok.
Release notes/PNG N/A: ürün görünür davranışı ve kaynakları değişmez.
