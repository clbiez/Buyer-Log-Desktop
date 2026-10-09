# Buyer Log — yeni kullanıcı kurulumu

Yeni bir kullanıcıya Buyer Log kurmanın **tek** desteklenen yolu kurulum paketidir.

## Kurulum

1. Public release reposunda (`BUYER_LOG_RELEASE_REPO`, ör. `clbiez/Buyer-Log-Releases`)
   en güncel `stable-v<sürüm>` release'ini açın.
2. `BuyerLog-Kurulum-<sürüm>.zip` dosyasını indirin. İsterseniz yanındaki
   `.sha256` dosyasıyla doğrulayın.
3. ZIP'i kullanıcının kendi bilgisayarında **yazılabilir** bir klasöre çıkarın
   (örn. `C:\BuyerLog`). Program Files veya salt okunur ağ klasörü kullanmayın.
4. `BuyerLog.exe` dosyasını çalıştırın. Yönetici hakkı gerekmez.
5. İlk açılışta Shared Hub / senkron klasörünü seçin ve kullanıcı **kendi hesabıyla**
   giriş yapsın.

Sonraki sürümler STABLE kanalından otomatik gelir; yeniden kurulum gerekmez.

## OneDrive / SharePoint senkron klasörü

Buyer Log ve yerel veritabanını kullanıcının bilgisayarındaki yerel, yazılabilir
klasörde tutun. OneDrive / SharePoint yalnız ortak SYNC dosyalarını taşır.

Windows Dosya Gezgini'nde seçtiğiniz ortak SYNC klasörüne sağ tıklayıp
**Her zaman bu cihazda tut / Always keep on this device** seçin. İlk indirme
bittikten sonra klasörün çevrimdışı kullanılabildiğini ve OneDrive'ın
eşitlemesinin tamamlandığını kontrol edin. Böylece yalnız bulutta bulunan
dosyaların SYNC sırasında tek tek indirilmesi azalır.

Mümkünse şirketin yönettiği **SMB ağ paylaşımını** ortak SYNC kökü olarak
tercih edin. SMB, cihazlara aynı dosya sistemini gösterir; ayrı OneDrive
kopyalarındaki dosya kilitleri bütün cihazlar için ortak bir kilit değildir.
Buyer Log uygulaması ve yerel DB yine kendi bilgisayarınızda kalmalıdır.

### English

Keep Buyer Log and its local database in a writable local folder on the user's
computer. OneDrive / SharePoint transports shared SYNC files only.

In Windows File Explorer, right-click the selected shared SYNC folder and choose
**Always keep on this device / Her zaman bu cihazda tut**. Wait for the initial
download and OneDrive synchronization to finish, then verify that the folder
is available offline. This reduces on-demand downloads during SYNC.

Prefer a company-managed **SMB network share** for the shared SYNC root when
available. SMB exposes one shared filesystem; locks in separate OneDrive
replicas are not a common lock across devices. Keep the application and local
database on each user's own computer.

## Yapmayın

| Yöntem | Neden çalışmaz |
| --- | --- |
| GitHub **Code → Download ZIP** + `BuyerLog.exe` | Kaynak kod `node_modules` içermez; sunucu açılamaz. 7.0.178'den beri uygulama bunu açıkça söyler. |
| Başka bir kullanıcının Buyer Log klasörünü kopyalamak | `data\` klasörü cihaz kimliğini, sürüm işaretçilerini ve kaynak kullanıcının yerel ayarlarını taşır. |

## Daha önce klasör kopyalanarak kurulan bilgisayarlar

7.0.178 bu kurulumları otomatik onarır; kullanıcıdan işlem beklenmez:

- **Cihaz kimliği:** Kopyalanmış kurulum ilk senkronda yeni bir cihaz kimliği alır.
  Kendi yerel değişikliklerini yeni kimlikle yeniden yayımlar ve kardeş kopyaların
  kaçırdığı değişiklikleri alır. Aynı alanı iki kopyanın farklı değiştirdiği durumlar
  sessizce ezilmez, çakışma olarak gösterilir.
- **Sürüm:** Başka bilgisayarın mutlak yolunu taşıyan sürüm işaretçisi bu kurulumdaki
  aynı sürüme yeniden bağlanır; eski çekirdeğe düşülmez.

Kopyalanan kurulumların güncellemeyi alması için Buyer Log'un bir kez STABLE güncellemesini
indirip yeniden başlatılması yeterlidir.

## Kurulum paketi nasıl üretilir

STABLE promotion tamamlanınca `Buyer Log new-user installer` workflow'u otomatik çalışır.
Elle çalıştırmak için Actions'tan `version` vererek tetiklenebilir. Paketin içeriği:

- uygulama çekirdeği = STABLE güncelleme artifact'inin birebir aynısı (bağımlılıklar dahil),
- repo kökündeki Electron çalışma zamanı dosyaları,
- SHA-256 ile sabitlenmiş `BuyerLog.exe` (`.github/installer/runtime.json`).

Electron çalışma zamanı değişirse yeni `BuyerLog.exe`'yi `BuyerLog` release'ine yükleyin ve
`runtime.json` içindeki `sha256` ile `electronVersion` değerlerini güncelleyin. Paket
kullanıcı verisi, `config.json`, `.buyerlog-versions` veya geliştirici dosyası içerirse
derleme durur.
