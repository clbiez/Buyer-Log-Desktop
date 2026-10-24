# İmzalı masaüstü yaması / Signed desktop patch

## Güven sınırı / Trust boundary

Kalıcı Electron başlatıcısı 1.1.0, v3 yama doğrulayıcısını tam kurulumun
korumalı `electron/` ağacından çalıştırır. İndirilen ZIP'ten kod, anahtar veya
kurulum betiği çalıştırmaz. Ed25519 anahtarları mevcut resmi yayıncıya aittir;
v3, normal sürüm imzasından ayrı `buyer-log-manual-patch/v3` alanını kullanır.

The persistent Electron 1.1.0 launcher runs the v3 verifier from the protected
full installation. It never executes an installer or imports keys from a patch.
The existing official publisher keys authorize the separate v3 signature domain.

İmza; taban sürümü ve kaynak commitini, hedef commitini, artan sıra numarasını,
başlatıcı dosyalarının özetini, ZIP kimliğini, tam hedef dosya envanterini,
değişen dosyaların kabul edilen önceki özetlerini ve TR/EN açıklamaları kapsar.
`public/` ve `server/` dışındaki değişiklikler tam kurulum gerektirir. Lease
çekirdeği ve trial yazıcı protokolü bu dizinlerde olsa da yama ile değiştirilemez.

The signature binds both commits, base version, sequence, bootstrap identity,
archive identity, complete target inventory, accepted prior hashes and bilingual
notes. Changes outside public/server require a full installation. The lease
kernel and trial writer protocol also require a full installation.

## Bir defalık geçiş / One-time migration

Eski 1.0 başlatıcı, kendi doğrulama kodunu indirilen bir yamayla değiştirmez.
Önce resmi imzalı uygulama artifact'i ve repodaki SHA ile sabitlenmiş Electron
çalışma zamanından üretilen **tam 1.1 kurulum** kabul edilmelidir. Normal yeni
artifact'lerin `minimumUpdaterVersion` değeri 1.1.0 olur. Eski istemciler bu
gereksinimi hata olarak gösterir; kendi başlatıcılarını sessizce yükseltmez.

Accept a full 1.1 bootstrap built from the official signed app artifact and
SHA-pinned Electron runtime before using v3 patches. The 1.0 launcher cannot
securely replace its own trust boundary through an app-core patch. Future app
artifacts require updater 1.1.0. Legacy clients report that requirement.

Geçişten önce eski başlatıcının devam eden denemesi tamamlanmalı veya kendi
doğru kurtarma koduyla kurtarılmalıdır. Yazıcı kimliği doğrulanamayan eski
denemeler ve eksik/çakışan checkpointler yeni başlatıcıda kapalı kalır; durum
dosyalarını veya yedekleri silerek bu koruma atlanmamalıdır.

Complete or recover any in-flight legacy trial with its matching recovery
code before migration. Unverified legacy writers and incomplete/conflicting
checkpoints fail closed in the new launcher; preserve their state and backups.

Eski yayımlanmış dosya ve feed'ler bu değişiklikle değiştirilmez. İmzasız eski
yama yayıncısı doğrulama kipinde kalır. Yeni kurulumda dışarıdan eski betikle
değiştirilen uygulama dosyaları bir sonraki açılışta bütünlük kontrolünden geçmez;
temiz imzalı tam kurulumla onarım gerekir.

Existing legacy downloads and feeds remain in place. The unsigned publisher
remains validation-only. A migrated installation rejects application files
modified by an external legacy script at the next launch; repair requires a
clean signed full installation.

## Kullanım / Usage

1. Moderatör, kullanıcı menüsünde **Güncellemeleri Kontrol Et → İmzalı Yama
   Yükle** yolunu açar. JSON ile aynı klasördeki ZIP birlikte saklanır.
2. Dosya penceresi yalnız JSON seçtirir. İmza doğrulanır; açıklama ve sıra
   gösterilir. Onaydan sonra etkin masaüstü oturumunun moderatör yetkisi tekrar
   kontrol edilir. Renderer'ın gönderdiği farklı kullanıcı kimliği yetki vermez.
3. Yama ayrı, değiştirilemez bir uygulama klasöründe hazırlanır. Etkin dosyalar
   ve iş verisi bu aşamada değişmez. Kullanıcı işini kaydedip yeniden başlatır.
4. Başlatıcı dosyaları yeniden doğrular, backend kapalıyken DB checkpointini
   alır ve yeni çekirdeği deneme olarak açar. Backend + yerel DB + ekran sağlık
   onayı birlikte gereklidir.
5. Açılış başarısızsa backend kapandıktan sonraki başlatmada önceki çekirdek ve
   DB kuşağı geri yüklenir. DB, `.bak`, `.wal` ve `.wal.bak` aynı kurtarma
   işlemindedir; her dosyanın varlığı, boyutu ve SHA-256 değeri denetlenir.

Open **user menu → Check for Updates → Install Signed Patch** as a moderator.
Keep JSON and ZIP together. Verify and confirm, save your work, then restart.
The launcher validates again and requires backend, DB and renderer health.
Failure restores the previous core and all four DB generation members only
after registered backend writers have exited.

Sağlık onayı tamamlanmadan iş verisi yazan HTTP istekleri 503 ile, kayıt
onaylanmadan geri döner. Giriş ve salt okuma hazır olma denetimi için kullanılabilir.
Yerel sync transportu ve UI sonrası arka plan işleri bekletilir. Başlatıcı ancak
tam sağlık onayını aynı token/sürüm/çekirdek kimliğiyle atomik kaydettikten sonra
bu denemenin yazmaları serbest bırakılır. Böylece geri dönebilecek bir denemede
kullanıcıya başarılı kayıt veya paylaşılmış sync onayı verilmez.

Before health confirmation, business HTTP mutations return 503 without saving.
Login and reads remain available for readiness. Sync transport and post-UI
background work wait. Writes resume only after the launcher durably confirms
the exact trial token, version and core. A rollback-eligible trial therefore
cannot acknowledge a user save or shared sync operation.

Kabul edilen en yüksek sıra, bekleyen yama ile tek atomik durum yazmasında
kaydedilir. Yerel rollback bu kaydı düşürmez. İş yedeği geri yüklemesi,
eski arşivler dahil, kurulumun `updater/` kontrol dizinini geri yazamaz veya
silemez. Bozuk durum dosyası sessizce varsayılana çevrilmez. Başarısız aynı
paketi tekrar kurmak yerine daha yüksek sıralı onaylı yama veya tam kurulum seçilir.

The highest accepted sequence is committed atomically with pending state and
survives local rollback. Business backup/restore, including old archives,
preserves installed updater control. Corrupt state fails closed. Use a newer
approved sequence or full installation after a failed patch.

## Üretim ve yayın / Build and publication

`resources/app/scripts/signed-manual-patch.js` yalnız temiz ve tam SHA'sı eşleşen
Git kaynak ağacını imzalar. İkinci ve sonraki yamalar önceki imzalı manifesti
gerektirir; geçmiş dosya özetleri kümülatif taşınır. Yalnız belge veya sürüm notu
değişikliği tekrar yama üretmez. Aynı sıra farklı baytlarla değiştirilemez.

The producer requires a clean exact source commit. Each subsequent sequence
requires its signed predecessor and carries cumulative prior hashes, including
reverted files. Documentation-only changes cannot republish runtime. Existing
sequence bytes are immutable.

`buyerlog-signed-manual-patch.yml` yalnız ana dalda, her yayın için açık onay,
tam güncel SHA, taban sürümü, sıra ve TR/EN açıklama ile elle tetiklenir. Tam
regresyon imzalamadan önce çalışır; imza anahtarı yalnız imzalama adımına,
yayın token'ı yalnız yayın adımına verilir. Tam taban paketinin ve önceki
yamanın resmi imzaları denetlenir. Uzak yayın baytları tekrar indirilip
doğrulanır. Actions ZIP artifact deposu kullanılmaz; legacy/TEST/STABLE feed'leri
değiştirilmez. Workflow kodunun eklenmesi veya merge edilmesi yayın izni değildir.

The workflow is manual-only and requires explicit per-publication approval,
exact current-main SHA, base version, sequence and bilingual notes. Full tests
precede signing. Signing and publishing credentials are isolated to their
steps. It verifies the official base and predecessor, publishes immutable
assets and verifies remote bytes without Actions ZIP storage or channel-feed
updates. Adding or merging workflow code does not authorize running it.

## Kabul kanıtının sınırı / Acceptance limits

Yerel Windows kabulü gerçek sabitlenmiş Electron ve tam Buyer Log ile, izole
sentetik kullanıcı/veri ve bellekte üretilen geçici imza anahtarıyla yapılır.
Üretim özel anahtarı kullanılmaz. Bu kabul, canlı GitHub secret yapılandırmasını,
yayın işlemini veya gerçek kurumsal SMB/Excel/Outlook ortamını doğruladığı
anlamına gelmez. TEST/STABLE yayını ayrı kabul ve kullanıcı yetkisi gerektirir.

Local Windows acceptance uses the pinned real Electron runtime and full app,
isolated synthetic data and an ephemeral in-memory signer. It does not certify
live CI secrets, publishing or populated corporate SMB/Excel/Outlook acceptance.
TEST/STABLE publishing remains a separately authorized and accepted operation.
