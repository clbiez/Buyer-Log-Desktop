# SHELL-05 — Native sekmeye özel modül hazırlığı

Issue: https://github.com/clbiez/Buyer-Log-Desktop/issues/937 (Paket 2).
İlk Base Main: `511cb2fae629cd6e0c1ad31eb773775e5c95841d`.
PR tabanı / son Main eşitlemesi: `3b38cab887d9a5590a234f6c6f73c8dec0b01c6b`.
Main, çalışma sırasında 7.0.343 notlarını arşivledi. Yalnız `next.json`
çakışması mevcut bekleyen kaydı koruyup kendi ID'mizi ekleyerek çözüldü.
Main'in üç commit'i yalnız release-note metadata/PNG arşivlemesidir; uygulama
kodu değişmedi. Başka iş dalı alınmadı; Main'e merge/yayın yapılmadı.
Branch: `perf/followup-native-module-warmup-20261109`.
Worktree: `/workspace/shell05`; ortak checkout'ta branch değiştirilmedi.
Risk: P2; renderer içindeki arka plan hazırlığının uygunluk filtresi.

## Davranış ve sınır

`public/app-main.js` içindeki `backgroundWarmupSteps` artık mevcut native
`workspaceTab` bağlamında yalnız `currentActiveTab()` modülünü plana alır.
`scheduleBackgroundModuleWarmup` idle gecikmesi sonrasında görünür modülü yeniden
kontrol eder. URL'deki açılış `module` değeri kullanıcı gezindikten sonra eski
kalabildiğinden modül seçimi için kullanılmaz. Native bağlamı okuyan dar yardımcı:
`backgroundWarmupNativeTab`.

Mevcut yetki/kaynak/bellek/hazır veri kontrolleri, Continue bekleme davranışı,
`ready('modules')` ve ilk ekran kapıları korunur. Kullanıcının normal navigasyonu
aynı `switchTab` / on-demand yükleyicilerinden geçer. Tarayıcıda mevcut çok modüllü
hazırlık sürer. Yeni API, lifecycle, unload/restore veya projection eklenmedi.

`electron/workspace-manager.js` zaten `workspaceTab` ve `module` taşıdığından
değişmedi. `pollSharedRevisions`, `sharedRevisionSnapshot`, `initLiveSync`,
`public/perf-runtime.js`, sunucu, PLM/BOM, IAM, compute limitleri ve #916 motorları
değişmedi. Kaynak diff'i yalnız warmup bloğundaki üç dar hunk'tır.

Bu değişiklik native renderer'ın **bütün** veri bağımlılıklarını kaldırmaz:
Siparişler mevcut ilk yükleme yolunda Koleksiyon kataloglarını da ister;
Genel Bakış kendi ekranı için CP verisini okuyabilir. Bunları ayrı warmup işi
saymadık, kaldırmadık ve istek kanıtından gizlemedik.

## Kanıt

- [red.log.gz](red.log.gz): Main warmup kodunda yeni altı testin 5'i FAIL, 1'i PASS.
  Boş belleğe sahip üç scheduler fixture'ı önce 9, sonra 3 modül yüklemesi yapar.
- [green.log](green.log): yeni yedi test ve mevcut startup/workspace testleri;
  **48 PASS, 0 FAIL/SKIP/CANCEL**. Yetki, kaynak filtresi, bellek sınırı,
  hazır/snapshot veri, idle sırasında kullanıcı geçişi, eski açılış URL'si,
  Continue ve boş planda modules kapısı kapsanır.
- [acceptance.json](acceptance.json) / [acceptance.log](acceptance.log): gerçek
  Electron 45.2.3, Chromium 156.0.8078.80, üretim workspace manager, WebContentsView,
  shell ve içerik preload'u; 20 satırlık seed=7 sentetik çalışma kitabı ve gerçek
  yerel Buyer Log sunucusu. İlk renderer profili boş olarak açılır; ayrıca aynı
  native Siparişler görünümü mevcut sunucu snapshot'ından yeniden açılır.
- [baseline-acceptance.json](baseline-acceptance.json) /
  [baseline-acceptance.log](baseline-acceptance.log): aynı düzenekte yalnız
  `app-main.js` HTTP yanıtı belirtilen Main blob'undan sağlanır. Sunucu ve native
  workspace aynı kalır. JSON'daki `sourceSha256` hangi istemci kaynağının
  çalıştırıldığını sabitler; PR kodunun hash'i post-change raporundadır.

Dar Electron karşılaştırması:

| Senaryo | Main | Değişiklik sonrası |
| --- | --- | --- |
| Tek native Siparişler, warmup başlangıcı | CP: 1 | 0 |
| Bu ekrandaki projection istekleri | Siparişler + katalog + CP: 3 | Siparişler + katalog: 2 |
| Kullanıcı CP'ye geçince CP isteği | zaten bellekte: 0 | on-demand: 1 |
| Üç native görünümde toplam warmup başlangıcı | 4 | 0 |
| Native Siparişler snapshot yeniden açılışı | CP warmup: 1 | 0 |
| Normal Chromium tarayıcı kontrolü | CP warmup: 1 | CP warmup: 1 |

Üç görünüm, ilk Siparişler renderer'ında kullanıcı CP'ye geçtikten sonra iki yeni
Siparişler/Koleksiyon native sekmesi açılarak oluşur; üç eşzamanlı soğuk proses
ölçümü değildir. Katalog mevcut ilk yükleme yolunda geldiğinden tarayıcı kontrolü
üç yeni warmup isteği üretmez. Ham JSON tüm API isteklerini içerir; tabloda yalnız
ilgili projection istekleri sayılır. Unit fixture'ındaki 9→3 ile gerçek uygulama
sayılarını birbirinin yerine kullanmıyoruz.

Kullanıcı navigasyonu gerçek sol menü düğmesinin click olayından çalıştırıldı.
CP'nin gerçek `suppfob` hücresine sentetik `12.34` değeri yazılıp `change` olayıyla
üretim düzenleme işleyicisi çağrıldı. Dirty satır kimliği ve düzenlenen değer
Siparişler'e/CP'ye dönüşte ve iki ek native sekme açılırken korundu; kayıt/yayın
istenmedi. Başlangıç perdesi altında warmup başlamadığı, perdenin gerçek ready
bayrağı ve warmup sonunda `ready('modules')` çağrısı doğrulandı.

Kabul host'u gerçek Electron kullanır; Windows portable launcher/updater ve
bütün `electron/main.js` entegrasyonunun kabulü değildir. Kurumsal/üretim verisi,
PLM servisi veya credential kullanılmadı. Soğuk renderer profili ve hazır sunucu
snapshot'ı doğrulandı; boş/verisiz sunucunun ilk ingest akışı ölçülmedi.
Süre/RSS veya üretim hızlanması iddiası yoktur.

## Regresyon ve ortam

Standart runner `resources/app` içinden `npm test` / `tests/run-tests.js`;
varsayılan concurrency=4, tüm batch'ler tek runner çağrısında çalıştırılır.
Bütün ağır kabul/test koşuları `/tmp/buyerlog-performance-measurement.lock` ile
seri alındı. Testler, eşikler ve skip kuralları değiştirilmedi.

İlk tam koşu [full-test-initial-environment-failure.log](full-test-initial-environment-failure.log)
batch 1'de durdu: 1571 PASS, 29 FAIL, 0 SKIP/CANCEL. Sebep ortamın yazılamayan
`/home/agent/.buyer-log/write-recovery` varsayılanıydı. Desteklenen APPDATA ve
LOCALAPPDATA ayarları `/tmp/shell05-test-profile/{appdata,localappdata}` yapıldı;
HOME değiştirilmedi. [test-environment-probe.log](test-environment-probe.log)
aynı hatayı veren iki dosyadaki 33 testi PASS doğruladı. Ardından tam runner
baştan çalıştırıldı; kalan batch'ler elle birleştirilmedi.

Main eşitlemesinden önceki başarılı tam koşu
[full-test-before-main-freeze.log.gz](full-test-before-main-freeze.log.gz)
olarak saklandı (1315 dosya / 10 batch, 9028 PASS, 0 FAIL, 65 SKIP, 0 CANCEL).
Son manifest için standart tam runner yeniden baştan çalıştırıldı: **PASS**,
1315 dosya / 10 batch / concurrency=4; 9028 PASS, 0 FAIL, 65 SKIP,
0 CANCEL; 212.2 saniye. Son koşu APPDATA/LOCALAPPDATA kökleri
`/tmp/shell05-final-test-profile/{appdata,localappdata}` oldu.
Son koşunun ham çıktısı: [full-test.log](full-test.log).
Kesin dosya/batch ve PASS/FAIL/SKIP/CANCEL sayıları [summary.json](summary.json)
ve issue'daki final yorumdadır. Ortam: Debian 13 x86_64, Node v24.19.0.

[i18n.log](i18n.log): yeni eksik 0, eski baseline eksik 0.
[release-notes.log](release-notes.log): güncel Main'in 1 bekleyen kaydı + tek yeni kayıt geçerli.
Release-note ID: `shell05-native-module-warmup-20261109` (TR/EN).
Gerçek post-change PNG:
[Electron Siparişler ekranı](../../../../resources/app/public/release-notes/next-assets/shell05-native-module-warmup-20261109.png).
1439×871 görüntü görsel olarak incelendi: CP Bekliyor, Siparişler Hazır ve 20
sentetik satır görülür. Ortak `next.json` dosyasındaki eski kayıtların alanları
ve ekleme dışındaki bütün baytlar güncel Main'e göre korunur; [review.json](review.json).

## Tekrarlama

App bağımlılıkları kilit dosyasından `npm ci` ile yüklenir. Kabul araçları repo
bağımlılıklarına eklenmedi: `/tmp/shell05-tools` altında Playwright 1.65.0 ve
Electron 45.2.3 kullanıldı. `xorg.conf` mevcut Xorg dummy sürücüsü içindir.

```sh
/usr/lib/xorg/Xorg :95 -config "$PWD/docs/performance/followup-20261109/shell05/xorg.conf" -logfile /tmp/shell05-xorg.log -noreset -nolisten tcp
# Başka terminalde, repository kökünden:
PLAYWRIGHT_MODULE=/tmp/shell05-tools/node_modules/playwright \
ELECTRON_PATH=/tmp/shell05-tools/node_modules/electron/dist/electron \
flock /tmp/buyerlog-performance-measurement.lock \
node docs/performance/followup-20261109/shell05/acceptance.cjs
# Aynı komuta --baseline eklemek belirtilen Main istemcisini ölçer.
```

PR, son SHA'nın gerçek CI bağlantısı ve final durumunun kanonik yeri #937'deki
tek `[SHELL-05]` yorumudur. Merge, dal silme ve TEST/STABLE yapılmadı.
