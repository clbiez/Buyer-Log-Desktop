# Kendi kendini güncelleyen launcher / Self-updating launcher

## Sorun / Problem

Launcher (güncelleme altyapısı, `updater` sürümü) yalnız kurulum kökünde
(`resources\app\electron\launcher.js`) bulunuyordu. Uygulama güncellemeleri
`.buyerlog-versions\<sürüm>\app` altına kurulduğu için launcher hiç
güncellenmiyordu. 7.0.295 ile release'lerin `minimumUpdaterVersion` değeri
manuel yama alanının `BOOTSTRAP_VERSION=1.1.0` değerine bağlandı. Bu yüzden
updater 1.0.0 kullanan bütün kurulumlar (≤ 7.0.294) `UPDATE_UPDATER_TOO_OLD`
hatasında kalıcı olarak takıldı.

The launcher (update infrastructure) lived only in the installation root and
was never updated by app-core updates. Coupling `minimumUpdaterVersion` to the
manual-patch `BOOTSTRAP_VERSION` (1.1.0) blocked every updater 1.0.0
installation permanently.

## Mimari / Architecture

| Parça / Part | Görev / Role |
|---|---|
| `electron/launcher.js` (stage-0) | Electron'un tek giriş dosyasıdır. Küçüktür, bağımlılığı yoktur ve nadiren değişir. Launcher'ı şu sırayla seçer: yönetilen `current`, yönetilen `previous`, kuruluma gömülü `launcher-core.js`, korunan `launcher-legacy.js`. / Single entry point, picks the launcher in the order listed. |
| `electron/launcher-core.js` | Önceki launcher mantığının aynısıdır (kurtarma, doğrulama, deneme, geri alma). Yüklenirken yan etki üretmez; `start(host)` ile çalışır. / Former launcher logic. It has no load-time side effects. |
| `electron/update/launcher-version.json` | `launcherVersion` (1.2.0) ve `minimumActivationLauncher`, yani manifest tabanı (1.0.0). / Launcher version and the manifest activation floor. |
| `electron/update/launcher-host.js` | Doğrulanmış bir release çekirdeğinin launcher dosyalarını `.buyerlog-launcher\<sürüm>-<özet>` altına kopyalar. Ardından stage-0'ı kurar ve `data\local\updater\launcher.json` pointer'ını atomik olarak yazar. / Copies verified launcher files and switches the pointer atomically. |

- **Kaynak güveni / Source trust:** Launcher dosyaları yalnız iki kaynaktan
  alınır. Birincisi, sağlık onayı almış ve `app-integrity.json` ile bütünlüğü
  doğrulanmış çalışan çekirdektir. İkincisi, updater'ın Ed25519 imzalı manifest
  ve SHA-256 ile doğruladığı hazırlanmış çekirdektir. İndirilen kod etkinleşmeden
  önce çalıştırılmaz.
- **Tek kök değişikliği / Single root change:** Kurulum kökünde yalnız
  `launcher.js` değişir. Özgün dosya önce `launcher-legacy.js` olarak bayt bayt
  korunur, sonra `launcher-host.json` makbuzu yazılır, en son giriş dosyası
  atomik olarak değiştirilir. Bütünlük doğrulaması bu üç dosyayı makbuzla tam
  özet eşleşmesiyle kabul eder; diğer bütün dosyalar eskisi gibi denetlenir.
- **Geri dönüş / Fallback:** Stage-0, yönetilen launcher'ın her dosyasını her
  açılışta SHA-256 ile doğrular. Yükleme (require) hatası aynı açılışta bir
  sonraki adaya geçer. Onaylanmamış yeni bir launcher iki açılışta onay
  alamazsa `failed` listesine yazılır ve önceki launcher'a dönülür. Bilinçli
  güvenlik kapanışları (`UPDATE_*`, `PATCH_*`) geri dönüşle atlatılmaz.
  Uygulama çekirdeğinin hatası launcher'ı düşürmez; o hata deneme ve geri alma
  mekanizmasıyla ele alınır.
- **Ön kontrol / Preflight:** Kurulum kökü veya çalışan çekirdek imzalı paketle
  eşleşmiyorsa (ör. eski imzasız betikle değiştirilmişse) geçiş yapılmaz. Mevcut
  launcher çalışmaya devam eder ve panel nedenini gösterir
  (`UPDATE_LAUNCHER_BOOTSTRAP_UNVERIFIED`). Klasör yazılamıyorsa
  `UPDATE_LAUNCHER_BOOTSTRAP_READONLY` gösterilir. Yeni launcher hiçbir kurulumu
  açılamaz hâle getirmez. Kalıcı engellerde otomatik deneme günde bir kez yapılır.

## Akışlar / Flows

1. **Eski kurulumlar (updater 1.0.0 / 1.1.0) / Legacy installations:** Release
   manifest tabanı 1.0.0'dır. Eski updater bu yüzden yeni sürümü indirir; eski
   launcher sürümü deneme olarak açar. Sağlık onayından sonra (1.0.0'da
   `lastConfirmedTrial` yoktur; yazma politikası yalnız o launcher'ın bu denemeyi
   kapattığı durumu kabul eder) çekirdek launcher'ı kurar. Bir sonraki açılışta
   launcher 1.2.0 etkinleşir. Kullanıcı ek bir işlem yapmaz.
2. **Gelecekteki launcher değişiklikleri / Future launcher changes:** Updater,
   yeni release'in istediği `minimumUpdaterVersion` değerinden eski bir
   launcher'da çalışıyorsa `UPDATE_UPDATER_TOO_OLD` hatasında durmaz. Paketi
   doğrular, aynı paketin launcher'ını pending yazmadan önce kurar, sonra
   sürümü hazırlar. Artifact yeterli launcher sunmuyorsa hiçbir şey kurulmaz ve
   eski hata korunur. Yeni launcher, kendisinden yeni etkinleştirme protokolü
   isteyen bir çekirdeği hiç başlatmaz.
3. **Her sağlıklı sürüm / Each healthy release:** Çalışan çekirdeğin launcher'ı
   daha yeniyse (aynı sürümde daha yeni bir kaynak release'ten geliyorsa) eşitlenir.
   Böylece imzalı manuel yamaların güven kökü (`bootstrapHash`) her zaman etkin
   tam sürümle aynı olur.

## Yayın kuralları / Release rules

- `minimumActivationLauncher` değerini (manifest tabanı) yükseltmek ≤ 7.0.300
  istemcilerini yeniden kilitler. Bu değeri yalnız yeni çekirdek eski
  launcher'larla gerçekten güvensizse yükseltin ve önce ulaşılabilir bir köprü
  sürüm yayınlayın. Test (`updater-launcher-upgrade-gate.test.js`) bu değeri
  bilinçli olarak 1.0.0'da sabitler.
- Launcher davranışı değişirse `launcherVersion` artırılır. Launcher eski
  çekirdekleri çalıştırabilmelidir; geri alma hedefi eski bir çekirdek olabilir.
- Stage-0 (`launcher.js`) değişirse önceki stage-0 makbuzdaki
  `previousStage0Sha256` ile kabul edilir. Değişiklik yine de en aza indirilmelidir.

## Doğrulama sınırı / Verification boundary

`tests/launcher-self-update-migration.test.js` gerçek 7.0.294 (1.0.0) ve
7.0.300 (1.1.0) launcher dosyalarını, sahte bir Electron `app` nesnesiyle ayrı
Node süreçlerinde çalıştırır. Kapsanan senaryolar: geçiş, sonraki sürümde geri
alma (DB + WAL), kurcalanmış ve çöken launcher, değiştirilmiş veya yazılamayan
kurulum, yarıda kalan geçiş ve etkinleştirme koruması. Gerçek Electron ikili
dosyasıyla ve gerçek Windows kurulumunda uçtan uca açılış bu testlerin kapsamı
dışındadır; TEST kanalında doğrulanmalıdır.

The test suite runs the real legacy launcher files in separate Node processes
with a fake Electron `app`. An end-to-end launch with the real Electron binary
on Windows must be verified on the TEST channel.
