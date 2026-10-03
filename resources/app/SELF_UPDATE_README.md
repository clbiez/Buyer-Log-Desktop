# Buyer Log Self-Update — 7.0.82

Buyer Log sürümü için tek kaynak `resources/app/package.json -> version` alanıdır. Runtime, UI, release manifestleri, update karşılaştırması ve build artifact adı bu canonical SemVer değerinden türetilir. `7.0.82` UI'da yalnız görsel olarak `7.82` gösterilebilir; update mantığı her zaman `7.0.82` kullanır.

## İlk kurulum

Update kaynağı Shared Hub'dan bağımsızdır. Kurumsal bir klasörde `BuyerLog-Releases` oluşturun; publisher yazabilsin, normal kullanıcılar yalnız okuyabilsin. En düşük müdahale için dış `config.json` içindeki `updates.releaseSource` değerini dağıtım sırasında önceden tanımlayın. UNC yol, kurumsal senkronize OneDrive/SharePoint klasörü veya `%OneDrive%\\...` gibi environment-variable içeren yol kullanılabilir. Yol boş/erişilemezse Buyer Log normal açılır; updater yalnız degraded/IDLE kalır.

Normal kullanıcı kanalı `stable`dır. `test` kanalı yalnız backend tarafından doğrulanan moderator kullanıcı için etkinleşir. Moderator Version History / Update alanından release source ve kanal seçebilir.

## TEST publish

Komutları `resources/app` klasöründe çalıştırın.

Patch sürümü artır + smoke test + build + SHA-256 + TEST publish:

```bash
npm run release:patch -- --source "\\\\SERVER\\BuyerLog-Releases" --notes "Kısa release notu"
```

Aynı mantıkla `release:minor` ve `release:major` kullanılabilir. Bump ile build ayrıdır; `release:build` mevcut version'ı artırmadan deterministic artifact üretir. Aynı SemVer için hedefte farklı SHA varsa publish fail eder.

Canonical sürüm doğrulaması:

```bash
npm run version:assert
```

Portable package manifestini yeniden üretmek için:

```bash
npm run portable:manifest
```

## STABLE promote

TEST'te doğrulanan binary yeniden compile edilmez:

```bash
npm run release:promote -- 7.0.82 --source "\\\\SERVER\\BuyerLog-Releases"
```

TEST ve STABLE artifact SHA-256 değerleri aynı olmak zorundadır.

## Client update akışı

Buyer Log önce local olarak açılır. Network update kontrolü startup sonrasında arka planda yapılır. Yeni SemVer varsa artifact `.partial` dosyasına kopyalanır, boyut + SHA-256 doğrulanır, zip-slip/path traversal kontrolleriyle staging'e açılır ve `READY_TO_INSTALL` durumuna gelir. Çalışan application files yerinde overwrite edilmez.

Hazır update yeniden başlatmada persistent launcher tarafından `.buyerlog-versions/<version>/app` içinden aktive edilir. `BuyerLogLocal.db`, WAL, preferences, cache ve Shared Hub ayarları replace edilen version klasörünün dışındaki persistent data alanında kalır.

## Health check ve rollback

Yeni sürüm trial olarak başlar. Başarılı sayılması için Electron/main başlangıcı yanında local backend, local DB ve renderer-ready sinyalleri gerekir. Trial başarısız olursa launcher current pointer'ı last-known-good sürüme döndürür ve update öncesi local DB checkpointini restore eder. Başarısız `version + SHA` kaydı tutulur; aynı broken artifact explicit retry olmadan yeniden kurulmaz.

Updater network/release-source hatası Buyer Log startup'ını bloke etmez. Development (`npm start`) modunda auto-apply kapalıdır.

## Release klasörü

```text
BuyerLog-Releases/
  test/
    latest.json
    releases/
      BuyerLog-7.0.82.zip
      BuyerLog-7.0.82.zip.sha256
      BuyerLog-7.0.82.json
  stable/
    latest.json
    releases/
      BuyerLog-7.0.82.zip
      BuyerLog-7.0.82.zip.sha256
      BuyerLog-7.0.82.json
```

## Güvenlik sınırı

Artifact integrity SHA-256 ile korunur. Bunun üstüne manifest **Ed25519 imzası**
eklendi (`electron/update/signature.js`): imza `version`, `artifact`, `sha256`,
`size`, `mandatory`, `releaseNotes` ve `minimumUpdaterVersion` alanlarını kapsar;
`channel`/`publishedAt` kapsam dışıdır ki TEST → STABLE promotion aynı imzayla
yeniden yayınlanabilsin. Güvenilen public key'ler yalnız **çalışan** uygulamanın
`electron/update/release-signing-keys.json` dosyasından okunur; indirilen paketin
kendi anahtar dosyası dikkate alınmaz.

- `keys` listesi **boşken** updater eski SHA-256-only davranışıyla çalışır
  (`signature-not-enforced` log kaydı).
- Listede en az bir anahtar varsa imzasız, değiştirilmiş veya yabancı anahtarla
  imzalanmış manifest indirmeden önce reddedilir (`UPDATE_SIGNATURE_MISSING` /
  `UPDATE_SIGNATURE_INVALID`). CI da bu durumda imzasız release yayınlamaz.

### İmzayı devreye alma (bir kerelik yönetici adımı)

1. Repo dışında, güvenli bir makinede: `node scripts/release-signing.js keygen <repo-dışı-klasör>`
2. Oluşan `*.private.pem` içeriğini GitHub → Settings → Secrets and variables →
   Actions altında `BUYER_LOG_RELEASE_SIGNING_KEY` secret'ı olarak kaydedin
   (tercihen korumalı bir *environment* secret'ı). Private key'i repoya,
   uygulama paketine veya Shared Hub'a koymayın; çevrimdışı yedeğini saklayın.
3. Komutun yazdırdığı `publicKey` (ve `keyId`) değerini
   `electron/update/release-signing-keys.json` içindeki `keys` listesine ekleyip
   commit edin. Bu sürümden itibaren istemciler imzayı zorunlu tutar.
4. Anahtar rotasyonu: yeni public key'i listeye ekleyin, bir sürüm boyunca iki
   anahtarı birlikte taşıyın, sonra secret'ı değiştirip eski anahtarı çıkarın.

Persistent launcher v1 normal app-core sürümlerini günceller; launcher'ın kendi
binary/protocol yükseltmeleri `minimumUpdaterVersion` ile bloke edilip ayrı
bootstrap-upgrade mekanizması gerektirir.
