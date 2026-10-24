# Buyer Log Desktop — başka Codex hesabına güvenli devir

> **Tarihsel checkpoint:** Kullanıcı daha sonra geliştirmeye devam edilmesini ve
> doğrulanmış işlerin merge edilmesini yetkilendirdi. Hazır düzeltmeler #707 ile,
> BL-003/005/011 ise #688 ile (`991135c6`) ana dala birleşti. Güncel updater
> sözleşmesi `../SIGNED_MANUAL_PATCH.md`, Windows kanıtı
> `bl-003-005-011-windows-acceptance-20261024.json` içindedir. Proje bütünü henüz
> tamamlanmadı; TEST, STABLE veya manuel patch yayını başlatılmadı. Aşağıdaki
> durdurma/merge edilmedi ifadeleri eski devir anını anlatır.

Checkpoint: **24 Ekim 2026, 16:10 Türkiye saati civarı**. Kullanıcı yeni geliştirmeyi
durdurup başka hesapta devam etmek istedi. Bu dosya o durma noktasını kaydeder.
Proje tamamlanmış değildir. **13 PR açık; hiçbiri birleştirilmedi. Hiçbir TEST,
STABLE, production veya manuel patch yayını başlatılmadı.** Test/demo/alt-agent
süreçleri çalışmıyor; zamanlanmış arka plan devamı yok.

## Yeni hesaba yapıştırılacak başlangıç talimatı

> Buyer Log Desktop için önceki mühendislik çalışmasına bu checkpoint'ten devam et.
> Repo `clbiez/Buyer-Log-Desktop`, hedef `main`. Önce bu devir dosyasını,
> `docs/audits/buyer-log-execution-progress.md`, mevcut AGENTS.md / CLAUDE.md ve
> ekli orijinal audit Markdown'ının tamamını oku; ZIP envanterini incele. Audit
> commit'i `a9183b319dd4927642bf153defc653bf67b74ccd`, bu checkpoint'in son
> doğruladığı main `5a5c3bcafd4de929019b3bba522ef5771670b171`. Main'i fetch edip
> yeni farkları değerlendir; mevcut dalları/işleri koru, force-reset/push yapma.
> Tüm BL-001–026 kapsamı sürüyor; tamamlanmış gibi davranma ve yalnız plan yazma.
> Öncelik: yeni doğrulanan ND-003 WAL kaybına gerçek regresyon testi ve düzeltme;
> ardından birleşik testteki 13 hata ve BL-002/003 uyumluluk blokları. Aşağıdaki
> kanıtları bağımsız doğrula. Hataları gizleme, iş/finans/yetki kontrollerini
> gevşetme. Yalnız sentetik ve izole veri kullan. Her bağımsız işi ayrı dal,
> odaklı commit ve PR ile teslim et. **Kullanıcı açıkça onaylamadan PR birleştirme
> veya herhangi bir kanal yayını yapma.** İmzalı patch geçişi + her yayın için
> açık onay + Actions ZIP artifact aktarımının kaldırılması kararı zaten alındı;
> bu karar yalnız uygulama kapsamını onaylar. İmzalı kurucu henüz uygulanmadı.
> Mevcut PR'ları körlemesine merge etme; Windows doğrulanmadan desktop uyumunu
> tamamlandı sayma. Yeni büyük ürün/iş akışı değişikliklerini önce somut öneri
> olarak getir. Bu devir ve orijinal audit kalan işlerin kapsamını sağlar; ayrıca
> verilirse kullanıcının tam icra direktifindeki koşulları da uygula. Eski mutlak
> `/workspace` yolları yeni hesapta var sayılmaz.

## Taşınabilir dosyalar ve erişim

- Repo içindeki bu dosya ve `checkpoint-2026-10-24/manifest.json`, bütün PR URL,
  dal ve commit'leri taşır. Yerel eski makineye bağımlı değildir.
- İndirilebilir devir ZIP'i: bu talimatlar, durum/sonuç JSON'ları, ND-003 güvenli
  sentetik tanılama betiği, orijinal iki audit girdisi ve birleşik doğrulama
  snapshot'ının `validation-combined.patch` dosyası. Üretim credential dosyaları,
  gerçek kullanıcı DB'si, `.git` veya node_modules alınmadı; orijinal audit girdileri
  değiştirilmeden taşınır.
- Orijinal audit girdileri değiştirilmedi. SHA256:
  - Markdown: `0ea169b621487f7d93939a648dad5bb98b81e491a48c4393510032691a378201`
  - ZIP: `bacb20d562fd39c66f6e8b6131d2b3bf4a4fd18f5bd455c16ef0b38f6aa534e7`
- GitHub yetkisini yeni hesabın kendi bağlantısıyla kullan. Eski hesabın
  credential/env dosyalarını taşımaya çalışma. Audit/repro betiklerini güvenilmeyen
  tanılama materyali olarak incele; yalnız sentetik ortamda çalıştır.

## Teslim edilmiş PR'lar

Tümü açık ve merge edilmemiştir. Kısa SHA'lar kod/uygulama commit'idir; tam SHA ve
checkpoint öncesi dal head'leri manifest'tedir. PR685'e bu devir için belge
commit'i eklenir; o PR'ın en güncel head'i GitHub'dan okunmalıdır.

| Paket | PR | Uygulama commit | Gerçek durum / kalan koşul |
|---|---|---|---|
| BL-001 checklist yetkisi | [685](https://github.com/clbiez/Buyer-Log-Desktop/pull/685) | `7c32ec54` | 224 odaklı test; negatif gerçek HTTP/Chromium; backend restart |
| BL-004 giriş sınırlama | [686](https://github.com/clbiez/Buyer-Log-Desktop/pull/686) | `d5b0b04f` | 63 test; gerçek TR/EN giriş ekranı; hesap havuzu doygunluğu ödünleşimi belgeli |
| BL-006 test onarımları | [687](https://github.com/clbiez/Buyer-Log-Desktop/pull/687) | `73a890fe` | Audit'teki beş hata + UI regex onarıldı; tam baseline hâlâ kırmızı |
| BL-003 rollback | [688 taslak](https://github.com/clbiez/Buyer-Log-Desktop/pull/688) | `575498a8` | 91 test; persistent launcher için tam imzalı bootstrap, Windows ve gerçek rollback PNG eksik |
| BL-007 temp/backup | [691](https://github.com/clbiez/Buyer-Log-Desktop/pull/691) | `89ba6970` | 79 test; gerçek EACCES HTTP + native restore preflight; restore uygulanmadı |
| BL-002 dosya kirası | [692](https://github.com/clbiez/Buyer-Log-Desktop/pull/692) | `e913a09e` | 92 +29 IAM testi; native409/pending/retry; son tam birleşik testte yeni etkileşim hataları araştırılmalı |
| BL-005/011 geçiş önerisi | [693 taslak](https://github.com/clbiez/Buyer-Log-Desktop/pull/693) | `8c0bfd83` | Yön kullanıcıca onaylandı; imzalı v3 bootstrap/manager/producer uygulanmadı |
| BL-011 yayın kapısı | [695](https://github.com/clbiez/Buyer-Log-Desktop/pull/695) | `01dd915a` | Onaylı geçiş için imzasız otomatik publisher validation-only olur; henüz main'e uygulanmadı |
| BL-009 dialog odağı | [696](https://github.com/clbiez/Buyer-Log-Desktop/pull/696) | `25badecc` | 10 Chromium testi + gerçek nested native dialog; Windows screen reader yok |
| BL-010 lisans yükleme | [697](https://github.com/clbiez/Buyer-Log-Desktop/pull/697) | `176136b4` | 59 test; gerçek503 sonrası skeleton yok; sentetik retry/empty/stale POST testleri ayrıca etiketli |
| BL-015 dar token düzeltmesi | [698](https://github.com/clbiez/Buyer-Log-Desktop/pull/698) | `5cecb247` | 53 test; üç tema/TR-EN/Standard-XL native PNG; geniş BL-015 tamamlanmadı |
| ND-001 / BL-006 TL sütunu | [699](https://github.com/clbiez/Buyer-Log-Desktop/pull/699) | `336f38f6` | FX V:W / özet-pivot B origin düzeltmesi; gerçek import200, eski set korunuyor |
| ND-002 model downgrade | [700 taslak](https://github.com/clbiez/Buyer-Log-Desktop/pull/700) | `c64cfa7c` | Gerçek karışık USD dosyası422; gerçek TL varyantları ve bağımsız finans sınırı incelemesi eksik |

Hızlı GitHub PR kontrollerinde 691/692/695/696/697/698/699/700 başarı gözlendi;
685'in devir öncesi head'inde de başarı vardı. **Bunlar tam regresyon değildir.**
Yeni head veya merge sonrası kontrolleri yeniden oku; eski yeşili aktarılmış sayma.
Branch protection/required checks etkinliği doğrulanmadı.

## İlk kritik iş: ND-003 — bozuk WAL'dan sonra onaylanan kayıt kayboluyor

**Confirmed defect / P0, düzeltilmedi, PR yok.** Performans araştırması sırasında
orijinal runtime üzerinde sentetik olarak doğrulandı:

1. Yeni JSON-snapshot+WAL DB oluştur; `before` kaydını yaz.
2. WAL sonuna yarım `{"v":1,"op":"pat` satırı ekle.
3. Normal `queuePatch({id:'after',patch:{n:2}})` başarıyla dönüyor.
4. Sıcak okuma `after.n=2`; yeni `createLocalDb(file).read()` ise `after` bulamıyor.

Kanıt: `checkpoint-2026-10-24/nd003-reproduction.json`; incelendikten sonra yalnız
izole veriyle çalıştırılabilen `docs/audits/nd-003-wal-tail-repro.cjs`. Betiğin
exit0 sonucu mevcut hatanın yeniden üretildiği anlamına gelir, bir düzeltme testi
geçtiği anlamına gelmez. Düzeltmede `cold===2` bekleyen gerçek RED/GREEN test yaz.

Kod: `server/lib/local-db.js` içindeki `parseWal`, `loadStateFromDisk`, `walWrite`.
`parseWal` bozuk/yarım satırda duruyor ve `truncated` döndürüyor; bayrak tüketilmiyor.
Yeni satırlar okunamayacak kuyruğun arkasına fsync edilip başarıyla onaylanıyor.
Mevcut WAL testleri yarım satırın önceki prefix'i koruduğunu test ediyor, **sonraki
yazma + yeniden açılış** zincirini test etmiyor.

Olası yöntem bir hipotezdir: kira içinde doğrulanmış prefix'i güvenle checkpoint
edip bozuk kuyruğu koruyarak yeni WAL'a geçmek veya güvenli kurtarma yapılana dek
yazmayı açık hata ile durdurmak. Snapshot/WAL/BAK sırası, fsync, checksum,
idempotency, BL-002 fencing ve BL-003 rollback tutarlılığı bağımsız doğrulanmalı.
Bozuk WAL'ı önce silme; sessiz veri kaybını daha hızlı hale getirme. Bu çözülmeden
BL-012 sayaç/parse optimizasyonuna geçme. SQLite varsayımı yapma.

## Son birleşik doğrulamanın gerçek sonucu

Snapshot: ayrı, detached `/workspace/buyer-log-wave1-validation`; **yerel test
ağacı**, PR/merge değil. 12 uygulama dalının farkları birleştirildi. Pending JSON
kayıtları unique ID ile birleştirildi; 30 not + gerçek PNG'ler doğrulandı. BL-001
yetki ve BL-003 başlangıç kapısı ile BL-002/007 ortak dosya helper'ı birlikteydi.

| Kontrol | Sonuç |
|---|---|
| Odaklı entegrasyon | 86 dosya, **604 pass,0 fail,0 skip** |
| Endeksmatik + tasarım entegrasyonu | 15 dosya, **124 pass,0 fail,0 skip**; eski yedi residual burada giderildi |
| Birleşik gerçek Chromium dialog testi | **10 pass,0 fail,0 skip** |
| Pending not doğrulaması | **30 kayıt geçerli** |
| Son tam `npm test` / Linux Node24.19 | Runner1038 dosyayı5 batch'e ayırdı; batch1 geçti, batch2 **13 hata** ile durdu |
| Çalışmış iki batch toplamı | **4285 test:4209 pass,13 fail,63 skip** |
| Son snapshot batch3/4/5 | **Not executed**; eski baseline'ın sonuçlarını buna ekleme |
| Gerçek Windows/Electron/NTFS/SMB/Excel/Outlook/şirket entegrasyonu | **Blocked / Not executed** |

13 hatanın konumları ve kısa çıktıları `checkpoint-2026-10-24/combined-full-results.json`:

- `delta-store-overrides-v806.test.js`: **9 hata** (shadow/delta/delta-only,
  settings/revision/merge/email/collection mirror). `horizon-template-native-service.test.js`:
  **1 hata**. **Hipotez:** BL-002 AsyncLocalStorage ile devralınan eski kira
  bağlamı, ayrı/ertelenmiş mirror yazmasının durable guard'ını düşürüyor.
  Kök neden henüz doğrulanmadı. Önce yeniden üret; aynayı veya yetki recheck'ini
  kapatarak, istisnayı yutarak veya testi gevşeterek çözme.
- `github-release-provider-v7084.test.js`: **2 hata** (`selected` / `activation`
  null). BL-003'ün legacy trial/protocol reddi ve fixture/bridge uyumu araştırılmalı.
  Eski bootstrap migration'ını yok sayma; watchdog/live-writer güvenlik kapısını
  kaldırarak testi yeşil yapma.
- `master-releases-v20261009.test.js:139`: **1 hata**; klasör listesine yeni kalıcı
  `archive.write-fence.json` eklendi. Gerçek archive okuyucu ve generation
  sözleşmesini doğrula; yalnız beklenen metadata için anlamlı assertion ekle.

Önceki 604 entegrasyon çalışması ayrıca yaşa göre takeover bekleyen bir IAM
testini ortaya çıkarmıştı; `8525951b` takip commit'i onu ilk yazarın korunması ve
eski revizyonun reddiyle güçlendirdi. O ayrı 603/1 sonuçtan sonra604/0 elde edildi.
Son **13 hata farklıdır**; bunları o düzelmiş test sanma.

## Başka makinede snapshot'ı yeniden kurma

1. GitHub erişimini kur, repoyu clone/fetch et ve güncel main'i incele. Orijinal
   audit girdilerini ZIP'ten aç; diagnostic scriptleri incelemeden çalıştırma.
2. Tarihsel sonucu aynen çoğaltmak için yeni bir **ayrı** worktree'yi manifest'in
   `5a5c3bca...` baseline'ından aç. Bu current main'in yerine geçmez.
3. Bundle'daki `validation-combined.patch` SHA256'sını manifest ile doğrula.
   `git apply --check` sonra `git apply --binary` ile yalnız o yeni test ağacına
   uygula. Patch baseline'a geçici git index üzerinden uygulanabilirlik kontrolünü
   geçti. node_modules dahil değildir; `resources/app` içinde `npm ci` kullan.
4. Alternatif: manifest'teki PR dallarını/pinned SHA'ları fetch edip
   `git diff --binary --full-index <common-base>...<branch>` farklarını uygula.
   `next.json` farklarını doğrudan üst üste uygulama; unique change ID'leri
   birleştir, bütün gerçek PNG'leri koru. Sadece `git diff` kullanmak binary
   screenshot patch'ini üretmez; `--binary --full-index` gerekir.
5. Testler için yalnız yeni sentetik dizinler ayır. `TMPDIR`, `BUYER_LOG_TEMP_ROOT`,
   `APPDATA`, `LOCALAPPDATA` aynı kontrollü senaryoya ait olmalı; TMPDIR ile
   BUYER_LOG_TEMP_ROOT eşleşsin. Global temp'teki yabancı chmod000 fixture'ları
   test sonucunu kirletebilir. HOME/CODEX_HOME değerlerini değiştirme.
6. Önce 13 hatanın dört dosyasını ve ND-003 yeni testini hedefle; sonra ilgili
   entegrasyonu çalıştır. Kodu/testi değiştirdikten sonra eski sonucu geçerli
   sayma. Milestone'da tam desteklenen-runtime regresyonunu çalıştır; skip ve
   platform bloklarını ayrı raporla. Tam suite'i körlemesine art arda tekrarlama.

Odaklı başarılı entegrasyon komutunun filtresi:

```text
npm --prefix resources/app test -- checklist test-report cp-checklist login-thrott user-access central-iam auth.test file-lease local-db durable-file shared-lease single-instance-lease shared-revision worker collection-workspace launcher rollback snapshot startup-gate backup full-system-restore user-data data-cleanup license-cards capacity-request-workbook collection-mb-month-locale-filter notes-editor-persistence revision-v476 manual-patch-publication-policy agent-instructions
```

## Kalan backlog ve sıra

- **BL-001/002/004/006/007/009/010/011:** PR'lar açık. Özellikle BL-002 ve BL-006
  için son birleşik test kırmızısı çözülmeden verified/full-green deme.
- **BL-003:** draft; tam checkpoint seti/journal/trial-writer protokolü kodlandı.
  Persistent launcher eski kurulumda app-core-only patch ile değişmez. Gerçek
  signed-bootstrap migration, Windows trial-edit/quiescence/NTFS ve gerçek
  rollback PNG/pending note olmadan deploy/desktop-uyum iddiası yok.
- **BL-005:** proposal yönü onaylandı; trusted installed entry point, signed-v3
  producer/manager, replay/downgrade, key rotation ve offline Windows kabulü
  uygulanmadı. İmza doğrulayıcısını aynı indirilen değiştirilebilir scriptin
  içine eklemek kendi başına güven kökü kurmaz. Üretim anahtarlarını değiştirme.
- **BL-008:** timer bloke olma doğrulandı (~305ms/300ms contention); awaited
  request-store dönüşümü/aynı benchmark yapılmadı. BL-002 ile koordine et.
- **BL-012:** WAL parse/count overhead doğrulandı, optimizasyon yok. Önce ND-003.
- **BL-013/014:** peer sync/pricing optimizasyonu uygulanmadı; canonical identity,
  zero/missing ayrımı ve mevcut hesap kuralları korunmalı. Aynı ölçüm önce/sonra.
- **BL-015:** yalnız PR698 scoped token düzeltmesi; geniş tipografi/density ve
  tüm ekran temaları/erişilebilirliği henüz yapılmadı. Paralel design system ekleme.
- **BL-016:** test-report scope resolver user-managed row ile yetki genişletiyor
  olabilir; **Suspected risk**, yeniden üretmeden doğrulandı deme.
- **BL-017:** pricing/FX/indexation provenance sözleşmesi henüz yapılmadı.
  Yerel `/workspace/buyer-log-bl017` adı yanıltmasın: o ağaç ND-001/PR699'dur.
- **BL-018:** paket/vendored dependency envanteri henüz yapılmadı.
- **BL-019:** gerçek Windows temsilci desktop performansı blocked.30k orders,
  300 collections,50 manufacturers,20 licenses,10 kullanıcı hedefi hâlâ geçerli.
  BL-002'nin120 örnek mikrobench'i desktop hızlanması değildir.
- **BL-020–026:** feedback/motion, release-note deneyimi, contextual palette,
  bulk preview/receipts, pricing/FX açıklaması, saved views ve exception inbox
  uygulanmadı. Özellikle23–26 büyük iş akışlarını önce somut öneriyle onaya sun.

İlk iş yeni rapor yazmak değil: ND-003 için güvenli RED/GREEN ve son13 birleşik
hata üzerinde kanıtlı düzeltme. Sonrasında audit dalgalarını bağımlılıklara göre
sürdür. Mevcut snapshot store JSON+WAL'dır, SQLite değildir. TR/EN, gerçek PNG'li
pending release notes, mevcut üç tema/iş kuralları, LCW AI tek sağlayıcı sınırı,
durability ve kullanıcı veri güvenliği korunur.
