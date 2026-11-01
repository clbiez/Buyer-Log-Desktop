# Buyer Log GitHub release dağıtımı

Bu akış mevcut `BuyerLogUpdater` doğrulama, staging, activation, health check ve rollback zincirini kullanır. İstemcideki tek yeni kaynak biçimi `github:OWNER/REPO` değeridir. Bu repo **public ve release-only** olmalıdır; normal kullanıcı hesabı veya token kullanmadan `test/latest.json`, `stable/latest.json` ve GitHub Release ZIP asset'lerini HTTPS üzerinden okur. Source repo private kalabilir. Release repo ağacında yalnız kanal manifestleri ve isteğe bağlı README tutulur; uygulama kaynak ağacı checkout edilmez.

## Kurumsal ağlarda güncelleme / Updates on managed networks

`release-assets.githubusercontent.com` engelli olsa da eski istemciler tam STORE
ZIP paketini `raw.githubusercontent.com/.../raw-dist/<kanal>/` adresinden alabilir.
Bu nedenle GitHub güncelleme paketi 100 MiB sınırını aşamaz. Build ve yayın bu
sınırı zorunlu tutar; TEST/STABLE `latest` ilerlemeden önce **yalnız raw adresinden**
indirilen paketin boyutu ve SHA-256 değeri doğrulanır. Release CDN'deki başarılı
bir indirme bu kontrolün yerine geçmez. Büyük eski karşı kanal, küçük kurtarma
sürümünün yayınını engellemez; yeni hedef sürümün raw kopyası zorunludur.

GitHub paketlerinde son üç görselli sürüm çevrimdışı tutulur. Daha eski sürümlerin
metinleri yerel kalır; ekran görüntüleri arşiv açıldığında `release-visuals` dalından
istenir. Her görsel ayrı Git blob'udur; yayın eklemelidir, mevcut bir görselin
baytlarını değiştiremez. `asset-locations.json` yalnız paketleme sırasında üretilir
ve çekirdek bütünlük manifestine dahildir. Kaynak arşiv ve imzalanmış eski paketler
değiştirilmez. GitHub kaynağı olmayan çevrimdışı/klasör paketleri bütün görselleri
taşımayı sürdürür.

Existing clients can fetch the complete STORE ZIP from the raw mirror even when
the Release CDN is blocked. GitHub update builds must fit within 100 MiB; publishing
must verify the raw ZIP's exact size and SHA-256 before advancing either channel.
The latest three visual releases remain offline. Older descriptions stay local;
their original images load on demand from the additive, immutable `release-visuals`
branch. Source archives, existing signed packages and offline/folder builds retain
their original images. A new version is required to recover clients from 7.0.322;
rebuilding different bytes under that version is prohibited.

## Kurulum

1. Public release-only repo oluşturun; varsayılan branch `main` olsun. `test/` ve `stable/` klasörleri ilk yayın sırasında workflow tarafından oluşturulur.
2. Private source repo'da `BUYER_LOG_RELEASE_REPO` Actions variable'ını `OWNER/REPO` yapın.
3. `BUYER_LOG_RELEASE_TOKEN` Actions secret'ı ekleyin. Token yalnız release-only repo için **Contents: Read and write** izni taşıyan fine-grained PAT veya GitHub App installation token olmalı. İstemciye, artifact'e ya da source koduna credential yazılmamalı. App token kullanılırsa workflow checkout ve yayın adımlarında bu secret yerine kısa ömürlü App token üreten adım bağlanır.
4. Canonical `resources/app/package.json` sürümünü yeni ve daha önce yayınlanmamış bir semantic version olarak commit edin. TEST workflow'unu bu commit'in tam 40 haneli SHA'sı ile çalıştırın. Workflow `npm ci`, version assertion, mevcut release smoke testleri ve bir kez artifact build yapar. Artifact ve per-version manifest yayınlanır, uzaktan SHA ve boyut doğrulanır; ancak sonra `test/latest.json` ileri alınır.
5. Moderatör TEST kanalında yeni sürümü doğruladıktan sonra STABLE promotion workflow'una aynı sürümü verin. İşlem TEST release asset'ini indirir, hash doğrular, aynı byte'ları STABLE release'e yükler, tekrar doğrular ve yalnız bundan sonra `stable/latest.json` dosyasını günceller. Promotion build yapmaz.

GitHub Actions release repo secret'ının yetkisi yalnız hedef repoyla sınırlı olmalıdır. GitHub hesabı, PAT, `gh` veya Git istemcide gerekmez. `GH_TOKEN` yalnız CI yayın scriptinde okunur.

## Eski istemciler için bridge

Eski istemciler klasör kaynağından başka kaynak bilmediği için doğrudan GitHub'a yönlenemez. TEST workflow'unun `buyerlog-bridge-bundle` çıktısı, **aynı build** ZIP'i ile `latest.test.json` içerir. Bundle'ı yetkili yayın makinesine indirin:

```text
npm run release:bridge -- BUNDLE_DIR OLD_RELEASE_FOLDER
```

Bu komut mevcut klasör publish yoluyla bridge sürümünü eski TEST kaynağına koyar. Moderatör testinden sonra aynı klasörde mevcut `npm run release:promote -- VERSION --source OLD_RELEASE_FOLDER` komutuyla STABLE'a taşıyın. Eski istemci bridge sürümünü klasörden alır; yeniden başlatma sonrası bridge artifact içindeki public `github:OWNER/REPO` kaydı eski klasör ayarından GitHub provider'ına geçişi sağlar. Ardından bir sonraki sürüm GitHub üzerinden gelir. Bridge ZIP'inin kendi sürümünü ayrıca GitHub TEST/STABLE release olarak doğrulamadan `latest` ilerletmeyin. Geçiş gerçek eski istemci ve gerçek klasör/OneDrive paylaşımı üzerinde doğrulanana ve tüm aktif istemciler bridge'e yükselene kadar eski klasör kaynağını koruyun.

Klasör kaynağına otomatik yazma CI'da yoktur; kurumun OneDrive/SharePoint erişimi ve aktif istemci envanteri yerel dağıtım sorumlusundadır. Mevcut sürüm GitHub veya Shared Hub erişilemezken çalışmaya devam eder. Release ZIP'inde kullanıcı verisi bulunmamalıdır.
# Source synchronization and version branches

The private source repository is `clbiez/Buyer-Log-Desktop`. Mutable user data,
machine configuration, caches, logs, backups, generated update bundles and
installed dependencies are intentionally excluded from source control.

For a normal patch update, run from `resources/app`:

```powershell
npm run github:sync:patch -- --message "Describe the update"
```

The command bumps the canonical patch version, validates the staged paths, runs
the complete test suite, commits the update and atomically pushes both `main`
and the immutable `updates/vX.Y.Z` branch. A version branch can never be moved
to different content; bump the version for the next update.

`npm run github:sync` performs the same validation without changing the version.
It is useful only while the current `updates/vX.Y.Z` branch does not yet exist.
GitHub Actions also verifies every `main` push and creates the version branch if
the local sync command was not used.

## Yeni kullanıcı kurulum paketi

STABLE promotion başarıyla bitince `buyerlog-installer.yml` aynı STABLE artifact'i indirir, SHA-256 doğrular ve Electron çalışma zamanı + sabitlenmiş `BuyerLog.exe` ile `BuyerLog-Kurulum-<sürüm>.zip` paketini üretir. Paket aynı `stable-v<sürüm>` release'ine eklenir; mevcut bir paketin üzerine asla yazılmaz. Ayrıntı: `docs/YENI_KULLANICI_KURULUMU.md`.
