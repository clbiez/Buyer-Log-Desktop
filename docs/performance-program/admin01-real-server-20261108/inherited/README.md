# ADMIN-01 — CRC/SHA tanı ve test hazırlığı

**Durum: hazırlık tamamlandı; üretim uygulaması ve resmî önce/sonra kabulü bekliyor.**

Kaynak: `docs/performance/2026-11-05-codex-review-findings.md`, ADMIN-01 (Faz 7).
Yeni dal: `diag/admin-01-backup-crc-sha`. Donmuş uygulama kaynağı:
`5a1656e98deeb573f6245f4b24a8135cc77a0d7b` (Main, #892 merge commit'i).
İki tanı kolunda da aynı #892 kodu var. İnceleme dalları taşınmadı; rebase/force-push yok.

## Değişti

Yalnız yeni tanı script'i, deterministik fixture, bağımsız HTTP istemcisi,
dokuz hazırlık testi ve kanıtlar eklendi. `backup-service.js`, `backup-archive.js`,
`server.js`, ortak worker dosyaları, `app-main.js` ve Claude dosyaları değiştirilmedi.
Yeni worker mekanizması veya DB migrasyonu yok. Görünür davranış değişmediği için
yeni release-note/PNG eklenmedi; mevcut 32 kaydın validator'ı çalıştırıldı.

## Kaynakta doğrulanan sözleşme

- `server/lib/backup-service.js:createBackupService/create`: moderator sınırı,
  kullanıcı kapsam seçimi ve hassas veri temizliği arşiv çağrısından önce kuruluyor.
- `server/server.js`, `/api/backups`: `setImmediate` içinde aynı süreçte
  `backupService.create` çalışıyor; bu bir worker aktarımı değil.
- `server/lib/backup-archive.js:snapshotEntry` (46): 256 KiB dosya chunk'larında
  SHA-256 ve JavaScript `crcUpdate` (30) çalışıyor. Buffer girdisi tek chunk.
  Kaynak boyutu/mtime, okuma öncesi/sonrası ve bütün snapshot sonunda doğrulanıyor.
- `createBackupArchive` (368): veriler → ayarlar → son kaynak kontrolü → manifest
  → snapshot'tan ZIP → tam `validateZip` → final rename. Arşivleme canlı kaynağı
  yeniden okumuyor. Başarıdan önce CRC, manifest SHA ve içerik listesi doğrulanıyor.
- `inspectBackupArchive` ve `extractBackupArchive`: restore preflight'ı ve staging
  sırasında CRC/SHA denetimleri; iptal ve güvenli hedef kontrolleri korunuyor.
- Bu testler mevcut boyut/mtime ve özel snapshot sözleşmesini korur; bütün veri
  depoları için yeni bir atomik transaction/snapshot garantisi ileri sürmez.

## Dosya kilitleri ve faz kapıları

`artifacts/github-preflight.json` açık PR dosya listelerini kaydeder. #885
(`69950f289a012f0bb7c61290bec9890f340f6c64`) `server.js`, ortak compute havuzu,
`app-main.js` ve ilgili entegrasyon testlerinin sahibidir. #893 tanı, #891 Faz 6a,
#890 INT-06 hazırlığı da kontrol edildi; yeni dosyalarımızla çakışma yok.
ADMIN-02 için tamamlanmış bağımsız PR kanıtı bulunmadı; yokluğu tamamlanma sayılmaz.
#892'nin özel `app-main.js` istisnası bu işe uygulanmadı.

Üretim işi için iki kapı da açıkça sağlanmalı: **ana sohbetin Faz 7 sırası** ve
**Claude ADMIN-02 PR'ının tamamlanması / bu dosyalardaki kilidinin kalkması**.
Sonra güncel Main ve açık PR kilitleri yeniden okunur. Üretim öncesi baseline,
ADMIN-02 sonrası kodla yeniden alınır; bu eski hazırlık serisi kullanılamaz.

## Ölçüm

Linux x64, Node 24.19.0, cgroup 4 vCPU / 16 GiB. CPU modeli ve kaynak/harness
SHA'ları `artifacts/cohort-v1/manifest.json` içinde. Windows/Electron ölçülmedi.
GC zorlanmadı, OS disk cache temizlenmedi; ilk koşu ve bütün sapmalar saklı.

Fixture: seed 7, 8 × 32 MiB disk dosyası + 16 MiB ayar buffer'ı + boş dosya ve
CRC test vektörü; toplam **272 MiB + 9 byte**. Her koşu taze, yalnız sentetik
bir kökte oluşturuldu. Üretilen kaynakların SHA'ları, manifest içerik listesi ve
extract sonrası her dosyanın boyutu/SHA'sı doğrulandı. Aynı fixture SHA:
`artifacts/cohort-v1/summary.json`. Arşiv ZIP zaman damgaları değişebildiği için
farklı koşuların bütün ZIP SHA'larının eşitliği beklenmez.

Sıra **A1/B1/B2/A2/A3/B3**. A = baz, B = **değişikliksiz kontrol**; aynı üretim
kodunu çalıştırırlar. Her grupta üç koşu, tabloda koşu metriklerinin medyanı var.
Normal koşularda profiler kapalı; ek yedinci koşu yalnız CPU profili içindir.
Koşular/testler çakıştırılmadı; makine çapında özel tanı lock'u ve process preflight
saklandı. İlk fixture hazırlığı, restore/eşdeğerlik kontrolleri ve temizlik ölçüm
penceresi dışındadır. Arşiv süresi snapshot, ZIP yazma, tam doğrulama ve rename'i
içerir. CPU user+system aynı süreçteki tanı HTTP sunucusunu da içerir.

| Metrik (3 koşu medyanı) | Baz | Değişikliksiz kontrol |
| --- | ---: | ---: |
| Arşiv duvar süresi | 3593,15 ms | 3663,74 ms |
| Süreç CPU user+system | 3857,21 ms | 3858,74 ms |
| Event-loop delay p95 (1 ms çözünürlük) | 2,05 ms | 2,14 ms |
| Event-loop max | 87,36 ms | 88,80 ms |
| **Sentetik HTTP** p95 | 5,12 ms | 6,06 ms |
| HTTP denemeleri / hata (grup toplamı) | 1092 / 0 | 1054 / 0 |

Mevcut Main'de gerçek `/api/health` handler'ı yok. Bu prob **uygulama health'i
değildir**: arşivi çalıştıran Node sürecindeki minimal test HTTP sunucusuna,
ayrı süreçteki istemci 10 ms aralıklarla istek gönderir. Böylece ana thread
durunca istemci örneklemesi de durmaz. Başlangıç zamanı ölçüm penceresine giren
bütün istekler, durum/hata/gecikmeleriyle ham JSON'dadır; HTTP retry yok. Depodaki
koşu JSON'ları kayıpsız `.json.gz` biçimindedir; `compressed-evidence.json`
sıkıştırılmış ve açılmış SHA'ları kaydeder. Harness yeni koşuda `.json` üretir. Refresh
POST veya login POST çağrısı yapılmadı. Prob için süre sınırı 2000 ms; başarısız
HTTP denemesi olursa kanıt saklanıp seri durur. Health adı altında 404 başarısı
raporlanmadı. Bu sonuç gerçek uygulama yükü/health p95 kabulünü karşılamaz.

**[Doğrulandı] Ayrı Node CPU profili:** 3611,13 ms örnekleme penceresinde
`crcUpdate` self süresi **2548,80 ms** (%70,6); snapshot 1346,28 ms, son doğrulama
1202,52 ms. `node:internal/crypto/hash` altındaki SHA-256 `update` **362,86 ms**
(%10,0). Bunlar örneklenmiş self sürelerdir; izole kesin fonksiyon timer'ı veya
süreç CPU toplamı değildir. Ham profil ve ancestry hesabı saklıdır.

CRC maliyeti somut ve baskın; bu chunk boyutuyla sentetik HTTP p95 küçük kalıyor.
Ortak worker aktarımının gerçek uygulamada gerekli/faydalı olduğu ve toplam
arşiv süresini azaltacağı henüz kanıtlanmadı. **Üretim before/after yoktur;
iki gruptaki doğal fark hızlanma/gerileme olarak yorumlanmaz.**

Tekrar üretme (repo kökünden; çıktı dizini henüz mevcut olmamalı):

```sh
node resources/app/scripts/benchmark-backup-crc-sha.js --output /tmp/admin01-new-cohort
node docs/performance-program/admin-01/analyze-profile.cjs /tmp/admin01-new-cohort/trace-1.cpuprofile.gz
```

Script yalnız kendi fixture'ını üretir; gerçek kaynak dizini alma seçeneği yok.
Hatalı koşu `.failed.json`, başlangıç kaydı ve sentetik köküyle saklanır, retry yok.
SIGKILL'den kalan tanı lock'u varsa, kaydedilen PID'nin artık çalışmadığı ve başka
ölçüm olmadığı doğrulanmadan lock silinmez.

## Doğrulama

- Yeni harness önce **RED** (eksik modül), sonra **9/9 GREEN**. Mevcut davranışa
  karşı güvenlik/restore regression testleri eklendi; üretim davranışı değişmedi.
- Bilinen `123456789` CRC `cbf43926` / SHA vektörü, boş ve çok chunk'lı dosya;
  restore sonrası byte SHA eşdeğerliği.
- Stream sırasında ve dosyalar arasında kaynak değişimi reddi; snapshot
  sınırından sonraki kaynak değişiminin arşive karışmaması.
- CRC tekrar hesaplanıp ZIP'e yazılsa bile manifest SHA uyuşmazlığının reddi;
  yarım ZIP, hata callback'i ve SIGKILL öncesi final arşiv yayımlanmaması.
- Restore iptalinde tamamlanmamış staging kaydı/temp temizliği ve kaynak korunması.
- İlgili paket: **12 dosya / 73 test PASS**, fail/skip/cancel 0. Mevcut full restore,
  legacy güvenlik, seçmeli kapsam ve shared-personal retention/dedup testleri dahil.
- İlk paket **68 PASS / 5 FAIL**: benim dış test ortamımda `BUYER_LOG_TEMP_ROOT`
  `/tmp` geneli yerine dar fixture alt köküne ayarlanmışken testlerin `os.tmpdir()`
  altında ürettikleri hedefler izinli kökün dışında kalmıştı. `user-data.js:101`
  güvenlik koruması doğru reddetti. `TMPDIR/TMP/TEMP` ve `BUYER_LOG_TEMP_ROOT` aynı
  yeni sentetik köke ayarlandı; aynı 73 test yeniden geçti. Üretim/test/validator
  kodu değiştirilmedi. Başarısız log `artifacts/targeted-tests.txt` içinde korundu;
  GREEN ayrı dosyadadır. Bu bir flaky retry veya güvenlik istisnası değildir.
- `i18n:check`: yeni eksik **0**, baseline **0** ve baseline dosyası değişmedi.
  `release:notes:validate`: mevcut **32 PASS**. Canonical/TR/EN/Motion+/reduced-motion
  dosyaları değişmedi.
- Tam `npm test` bu hazırlık turunda çalıştırılmadı. **Faz 6 / son üretim PR'ı için
  tam test zorunluluğu sürer**; hedefli paket/fast checks bunun yerine geçmez.
  Kod değişirse etkilenen kontroller yeniden çalıştırılır. Kırmızı kontrol,
  yetki/eşdeğerlik/veri kaybı bulgusu kapatılmadan ilerleme veya merge yok.

## Ana sohbete entegrasyon isteği (bekleyen iş)

Faz 7 ve ADMIN-02 kapıları açılınca ana sohbetten şunları iste:

1. Güncel ortak compute havuzuna, mevcut byte/queue bütçeleri ve iş öncelikleriyle
   uyumlu arşiv işi kaydı; arşiv ağır işleri için **tekil serializationKey** ve
   sınırlı kuyruk. Yeni Worker/pool/client mekanizması oluşturulmayacak.
2. `server.js` üzerinden servis enjeksiyonu, gerçek `/api/health` ile ölçüm noktası,
   progress, shutdown/timeout/abort/worker-exit yaşam döngüsü. Bu dosyaların sahibi
   ana sohbettir; bu dal doğrudan yazmayacak.
3. ADMIN-02'nin son snapshot sözleşmesine göre yetkisi/kapsamı/hassas veri temizliği
   ana süreçte doğrulanmış, yalnız güvenli iş descriptor'ı. Buffer aktarım/maliyet
   bütçesi, özel temp kökü sahipliği, kaynak değişimi denetimi, writer kilitleri,
   final rename ve temizliğin hangi süreçte olduğu açıkça tanımlanacak.
   Yalnız ZIP yazmayı taşımak snapshot CRC maliyetini ana thread'de bırakır;
   ölçülen iki CRC aşaması da tasarımda hesaba katılmalı.
4. Tam CRC/SHA/manifest doğrulaması, restore/retention uyumu ve fail-closed sonucu
   korunacak; timeout/crash/iptalde kısmi dosya başarı olarak dönmeyecek.

Uygulama öncesi her yeni davranış için RED; sonra GREEN. Resmî kıyas, güncel
ADMIN-02 sonrası Main'de iki kolda da **aynı #892 koduyla**, aynı fixture/harness/
ortamda çakışmasız **en az üç önce ve üç sonra** koşu ve medyan ister. Gerçek
uygulama health p95, event-loop ve doğruluk sonuçları birlikte değerlendirilecek.
Görünür iyileştirme/mesaj varsa kendi TR/EN release-note'u ve incelenmiş gerçek
post-change PNG gerekecek. Güvenlik doğrulamaları kaldırılmayacak.

## GitHub / Yayın / Karar-risk

Bu hazırlık taslak PR olarak incelenebilir; **merge öncesi durulur**. Uzak fast
checks sonucu yerel testten ayrı raporlanır; branch protection etkin varsayılmaz.
TEST: yapılmadı. STABLE: yapılmadı. Faz 7 tamamlandı/worker iyileştirmesi kabul
edildi denemez. Tek bağımsız Claude turu için paket `independent-review.md`;
tur kullanılmadı, P1 uygulamasının somut son diff'ini bekler.

EN: Preparation only: deterministic synthetic archives, nine safety/restore tests,
six unchanged-code measurements and a separate Node CPU profile. CRC dominates
sampled CPU; the HTTP endpoint is a synthetic responsiveness probe, not application
health. No production edits, worker implementation, official before/after
acceptance, merge or TEST/STABLE publication. Phase 7 and ADMIN-02 completion gate
all production work; full final regression and one user-mediated Claude review
remain pending.
