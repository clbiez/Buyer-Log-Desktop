# Yalıtılmış dayanıklılık (soak) testi — iki Windows makinesi

Buyer Log'un bir dalını **gerçek kurulumun, gerçek verinin ve gerçek Shared Hub'ın dışında**, ayrı bir veri klasörü ve ayrı bir OneDrive test klasörüyle çalıştırır.

- Yeni bir dağıtım ya da ikinci uygulama değildir: dalın `resources/app` kodu, uygulamanın desteklediği veri kökü değişkenleriyle doğrudan çalıştırılır.
- Kurulu `BuyerLog.exe` yalnız Node çalışma zamanı olarak kullanılır; kuruluma ve verisine dokunulmaz.
- GitHub ZIP'i `node_modules` taşımaz. Başlatıcı eksik bağımlılıkları kurulu uygulamanın çekirdeğinden test kod klasörüne **kopyalar** (kurulum yalnız okunur). `express` gibi sabit sürümlü paketlerin sürümü eşit değilse test başlamaz.
- Ayrıntılı kapsam ve kabul ölçütü: `docs/design-proposals/ADR-0001-cakismasiz-ortak-yazim.md` §12.

## Güvenlik kontrolleri (biri tutmazsa başlamaz)

1. Soak kökü (`C:\BuyerLogSoak\<makine>`) boş olmalı ya da başlatıcının işaret dosyasını taşımalı.
2. Soak kökü gerçek veri klasörlerinin (`%APPDATA%\Buyer Log`, `%LOCALAPPDATA%\BuyerLog`) ya da bir kurulumun (`BuyerLog.exe` yanındaki klasörler) içinde olamaz.
3. Hub klasörü boş olmalı (başlatıcı `BUYERLOG-SOAK-HUB.txt` yazar) ya da bu işareti taşımalı. **İşaretsiz dolu klasör, örneğin gerçek Shared Hub, reddedilir.**
4. Her başlatmada kayıtlı sync klasörü yeniden denetlenir. Uygulama içinden gerçek Hub seçildiyse sonraki başlatma reddedilir.
5. Test kodu bir kurulum klasörünün içine açılamaz.
6. Port gerçek uygulamanın 6194 portundan farklıdır (varsayılan 6294). Gerçek Buyer Log aynı anda açık kalabilir.
7. `APPDATA`, `LOCALAPPDATA` ve `TEMP` de soak köküne yönlendirilir.

## Sizin yapacaklarınız

**Hazırlık (bir kez):**
1. **Sabit test commit'ini** indirin (GitHub'da oturum açıkken tarayıcıdan): `https://github.com/clbiez/Buyer-Log-Desktop/archive/<COMMIT>.zip`. `<COMMIT>` değerini size bildirilen commit ile değiştirin. Her iki makinede aynı commit kullanılmalıdır.
2. ZIP'i açın. Çıkan `Buyer-Log-Desktop-<COMMIT>` klasörünü `C:\BuyerLogSoakKod` olarak yeniden adlandırın. İçinde `tools\soak\` ve `resources\app\` görünmelidir. Bu klasör Buyer Log kurulumunun **dışında** olmalıdır.
3. **Yalnız A makinesinde** OneDrive içinde boş bir klasör oluşturun: `%OneDrive%\BuyerLogSoakHub`. Kurumsal OneDrive kullanıyorsanız `%OneDriveCommercial%` kullanın. B makinesi aynı OneDrive hesabıyla bu klasörü otomatik eşitler; farklı hesapsa klasörü paylaşıp B'de "OneDrive'ım'a kısayol ekle" seçin. İçine gerçek veri koymayın.
4. B'de klasörün göründüğünü ve `BUYERLOG-SOAK-HUB.txt` dosyasının eşitlendiğini kontrol edin (A'nın ilk başlatmasından sonra).
5. Her iki makinede kurulu `BuyerLog.exe`'nin yolunu not edin (örneğin `D:\BuyerLog\BuyerLog.exe`). Gerçek Buyer Log açık kalabilir.

**Başlatma — A makinesi (ilk kez test satırlarıyla):**
```
cd C:\BuyerLogSoakKod\tools\soak
soak-start.cmd A "%OneDrive%\BuyerLogSoakHub" "D:\BuyerLog\BuyerLog.exe" --seed-password Soak-Test-2026
```
Tarayıcı `http://127.0.0.1:6294` adresinde açılır. `moderator` / `Soak-Test-2026` ile giriş yapın. Koleksiyon'da 40 test satırı görünmelidir.

**Başlatma — B makinesi:**
```
cd C:\BuyerLogSoakKod\tools\soak
soak-start.cmd B "%OneDrive%\BuyerLogSoakHub" "D:\BuyerLog\BuyerLog.exe"
```
Tarayıcıda `moderator` için **aynı şifreyi** belirleyin. Bu, "sahibin iki cihazı" senaryosudur. Koleksiyon, A'nın satırlarını OneDrive eşitlemesinden sonra almalıdır.

**Test:** ADR-0001 §12'deki 8 senaryoyu uygulayın:
- Aynı ve farklı satır/alan düzenlemeleri.
- OneDrive'ı **Duraklat** → iki tarafta düzenle → **Devam ettir**.
- Ağ kesintisi ve uyku modu.
- Yayım sırasında süreci sonlandırma: başlatıcı penceresini kapatıp yeniden başlatmak.
- Silme + eşzamanlı düzenleme.

Durdurmak için başlatıcı penceresinde `Ctrl+C`. Yeniden başlatmak için aynı komut; ikinci kez `--seed-password` gerekmez.

**Test sonu denetimi:** B'nin `C:\BuyerLogSoak\B` klasörünü A'ya kopyalayın (örneğin `C:\BuyerLogSoak\B-kopya`). Sonra A'da çalıştırın:
```
set ELECTRON_RUN_AS_NODE=1
"D:\BuyerLog\BuyerLog.exe" C:\BuyerLogSoakKod\tools\soak\soak-audit.js --a C:\BuyerLogSoak\A --b C:\BuyerLogSoak\B-kopya --hub "%OneDrive%\BuyerLogSoakHub"
```
Çıktıdaki `converged: true` iki makinenin aynı duruma ulaştığını gösterir. `hubConflictCopies`, `openMergeConflicts` ve `pendingLogs` değerlerini rapora ekleyin. Tek bir ıraksama ya da açıklanamayan kayıp **durdurma ölçütüdür**.

**Temizlik:** `C:\BuyerLogSoak\` ve OneDrive `BuyerLogSoakHub` klasörlerini silmeniz yeterlidir. Gerçek kurulum değişmemiştir.

## Sınırlar

- Arayüz tarayıcıda açılır; masaüstü penceresi ve Excel/PowerShell bağımlı özellikler bu testin kapsamı dışındadır. Senkron ve Koleksiyon yolu aynı sunucu kodudur.
- İki makine aynı `moderator` kullanıcısını kullanır. Farklı kullanıcılar arası yetki senaryosu bu kurulumda yoktur.
- **Linux'ta doğrulandı (2026-11-26):**
  - 4 güvenlik kontrolü (gerçek Hub benzeri klasör, işaretsiz dolu kök, 6194 portu, sonradan değiştirilen sync klasörü) çıkış kodu 2 ile reddetti.
  - İki sunucu (A: 6294, B: 6295) ve ortak bir test klasörüyle: A'nın 10 test satırı B'ye ulaştı; A → B ve B → A düzenlemeleri karşı tarafa yayıldı; denetim `converged: true` verdi.
  - Gerçek ev dizini klasörlerine (`~/.buyer-log`) hiçbir dosya yazılmadı.
- **Linux'ta doğrulandı:** Bağımlılığı olmayan ZIP benzeri kod kopyası, sahte kurulumdan kopyalanan bağımlılıklarla ayağa kalktı. Kurulum verilmeyince, `express` sürümü uyuşmayınca ve kod kurulum içindeyken başlatıcı reddetti.
- **Doğrulanmadı:** Windows, `soak-start.cmd`, `BuyerLog.exe`'nin Node modu ve gerçek OneDrive eşitlemesi. Komut ya da yol hatası görürseniz ekran çıktısını iletin.
