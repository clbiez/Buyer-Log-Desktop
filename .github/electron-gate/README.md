# Windows/Electron otomatik kapı (CI-only)

`.github/workflows/buyerlog-electron-gate.yml` bu klasörü kullanır. Ürün paketine
girmez: `build-installer.js` `^\.github/` yollarını dışlar, `release:build`
yalnız `resources/app` çekirdeğini paketler.

## Akış

1. `npm run release:build -- --allow-dirty`: TEST artefaktıyla aynı derleme
   betiği. Yalnız derler; publish ve imza yapılmaz, secret kullanılmaz.
2. SHA-sabitli `BuyerLog.exe` (`.github/installer/runtime.json`) indirilir.
   Bu deponun kendi release asset'idir; `github.token` ile okunur.
3. `scripts/build-installer.js` yeni kullanıcı kurulum paketini birleştirir;
   paket, güncelleyicinin `extractZipSafe`'i ile açılır.
4. `gate.js` kurulu `BuyerLog.exe` ile çalıştırılır (`ELECTRON_RUN_AS_NODE=1`,
   gömülü Node). Backend, kurulu uygulamanın `electron/backend.js`
   `BackendProcess` sınıfıyla başlatılır: BuyerLog.exe → watchdog → server.
   Veri kökleri ve ortam üretimdekiyle aynıdır; heap bütçesi
   `BUYER_LOG_MAX_HEAP_MB` ile verilir (varsayılan 3686 = <~15 GB RAM politikası).
5. `server-hook.js` (`NODE_OPTIONS --require`) yalnız server.js'te bellek
   (RSS, tepe RSS = `resourceUsage().maxRSS`, heap, heap sınırı), işçi ve
   havuz `retained` değerlerini kaydeder.

Fixture sentetiktir: `generate-demo-data.js --rows 30000 --seed 7`. Ayrıca her
4. ASAS satırında yükleme onayı boşaltılır, böylece Ex-factory elle
düzenlenebilir olur. Gerçek iş verisi kullanılmaz.

## Kapılar

| Kapı | Ölçüt |
|---|---|
| G01 | Soğuk/sıcak açılış, 30k yenileme, CP + Siparişler 200 (sıcak açılış < 90 sn) |
| G02 | CP sorgu satırı = computed satırı |
| G03 | Supp. FOB tekli + toplu görünür; tekli kayıt satır yaması yolunda |
| G04 | Not tekli + toplu (5) görünür |
| G05 | Del. Type (açık niyet, ikinci kullanıcı) görünür; sonraki Supp. FOB/not Del. Type'ı değiştirmez; okuma yolu satır yaması veya güvenli tam kurulum (#1260); satır sıfırdan tam kurulumla (G10) alan alan eşit |
| G06 | Elle düzenlenebilir Ex-factory PATCH + /batch 2xx, görünür; okuma yolu satır yaması veya güvenli tam kurulum; satırlar tam kurulumla eşit |
| G06b | #1260 artımlı lojistik yaması: aynı oturumun Del. Type kaydı ve en az bir Ex-factory kaydı satır yaması yolunda (rowPatch.steps>0) okunur, değer görünür, satır tam kurulumla eşit |
| G07 | Otomatik Ex-factory 409 `AUTOMATIC_DATE_READ_ONLY`; değer korunur |
| G08 | Aynı kullanıcının iki oturumu eşzamanlı yazar; iki alan korunur; iki oturum aynı veriyi görür |
| G08b | Bayat oturum (#1257 istemci sözleşmesi: kırpılmış gövde + yalnız kendi onaylı yazımıyla ilerleyen `If-Match`): Supp. FOB kaydı başka oturumun yeni notunu ezmez (409 `REVISION_CONFLICT` ya da not korunur) |
| G08c | Aynı senaryo Sub-Manufacturer için; fixture'da DTR olmayan satır yoksa **N/A** (istemci DTR satırında alanı göndermez) |
| G08d | Bayat oturum: not kaydı başka oturumun daha yeni Supp. FOB değerini ezmez |
| G08b-eski / G08d-eski | **INFO**: #1257 öncesi istemci gövdesi (bayat tam gövde, `If-Match` yok). Sunucu bunu kabul eder; koruma istemci sözleşmesindedir. Bilgi amaçlıdır, karar vermez |
| G09 | Yeniden başlatma sonrası karar demeti + CP satırları birebir |
| G10 | Projeksiyon önbelleği silinip sıfırdan tam kurulum, oturum verisiyle birebir |
| G11 | Kurtarılamayan 503 = 0 (toplam 503 > 0 ise WARN) |
| G12 | Heap sınırı = bütçe (±96 MB); ana heap tepe < %85; işçi OOM yok; beklenmedik çıkış yok |
| G13 | Sınırlı soak: kayıtlar 2xx; artımlı birikim = tam okuma; yazılan değerler görünür (RSS eğimi > ×1,25 ise WARN) |
| G14 | `backend.stop()` sonrası sunucu süreci 20 sn içinde biter (öksüz süreç yok) |

Durumlar: PASS · FAIL · WARN · BLOCKED · N/A · INFO · KNOWN (belgelenmiş
bulgu sürüyor; engellemez) · XPASS (bulgu artık üretilmiyor; kapıyı normale
çevirin). İş yalnız FAIL ya da BLOCKED olduğunda kırmızı olur. `--strict-known`
(iş akışında `strict_known=true`) ile KNOWN de FAIL sayılır; bu, birleşik main
nihai doğrulaması içindir.

## Yerel koşu (Linux, ölçüm amaçlı)

```bash
EL=<electron@44.3.0>/dist/electron
ELECTRON_RUN_AS_NODE=1 $EL .github/electron-gate/gate.js --app $PWD/resources/app --fixture-app $PWD/resources/app --out /tmp/gate --rows 30000 --soak-min 15
```

Kapsam dışı (otomatikleştirilemez): gerçek Chromium arayüzü/pencere, gerçek
OneDrive istemcisi, gerçek çok makine, gerçek kullanıcı verisi.
