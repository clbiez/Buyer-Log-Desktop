# 6V · İki gerçek sunucu + ortak Shared Hub klasörü: B bootstrap düzeltmesi ve CP paylaşılan alan yakınsaması

**Ortam:**
- Commit: main 8a29116 ağacı (#1257 dahil).
- Çalışma ortamı: Electron 44.3.0 / Node 24.20, `ELECTRON_RUN_AS_NODE=1`, `NODE_OPTIONS=--use-openssl-ca --max-old-space-size=3686`.
- Linux 6.18, 4 vCPU. Fixture: sentetik 3k, seed 7. İki sunucu aynı container'da.
- Shared Hub, iki sunucunun ortak gördüğü yerel klasör: OneDrive aktarım gecikmesi yok (0 sn varsayımı). `-PC` kopyası ve sırasız teslim bu kit'te yok; onlar simülasyon katmanında sınanır (S-A1/S-A2).

## 1 · B bootstrap hatası (6N): kök neden ve düzeltme

- **[Doğrulandı: source + runtime] Kök neden.** A'nın merkezi IAM dizininde yalnız moderator vardı. B'nin yerel dizini de tek kullanıcılıydı.
  - `central-iam.js refresh()`, yerel yer tutucunun ezilmesine yalnız uzak dizin kesin daha zenginse izin verir (`remote.users > local.users`). Aksi halde `IAM_MIGRATION_CONFLICT` döner ve bootstrap "Kullanıcı verileri Shared Hub'dan alınamadı" der.
  - Bu bir ürün güvencesidir (bağımsız yerel dizin sessizce ezilmez); kit kurulum hatasıdır.
- **Düzeltme (kit):** A, Hub'ı açmadan önce ikinci bir kullanıcı oluşturur. Bu, repo testi `shared-hub-new-device-users` ile aynı kurulumdur.
- **Sonuç:** B bootstrap `ready` (hub, 2 kullanıcı, master, business, collections), 1,0 sn. B girişi OK.

## 2 · CP paylaşılan alanlar (run 1 + tanı koşusu run 2)

| Senaryo | Sonuç |
|---|---|
| A → B Supp. FOB ×3 | Değer B'ye ulaşıyor. Tek bir alıcı `sync-now` çağrısı paketi kaçırdı: değer 60 sn içinde görünmedi, sonraki senkron turlarında göründü. Tanı anlık görüntüsünde B'de 200,37 = A'nın yazımı; ek tur ve yeniden başlatma sonrası da aynı. **Projeksiyon hatası değil**, kit zamanlaması: alıcı yayından hemen sonra tek kez çekiyordu. Düzeltme: alıcı `sync-now` değer görünene kadar yinelenir |
| B → A dates (retailDate) | Yakınsadı: iki tarafta 2027-04-21 |
| A → B Sub-Manufacturer | **N/A.** Fixture'da tüm satırlar DTR; DTR satırında Sub-Manufacturer kaynaktan türer, A'nın kendi sorgusunda da yazım görünmez (kapı G08c ile aynı) |
| Eşzamanlı aynı alan (A 311,11 ↔ B 322,22, aynı kullanıcı `moderator`) | İki taraf 322,22'ye yakınsadı; çakışma kaydı 0 (ek tur ve yeniden başlatma sonrası aynı) |

- **Eşzamanlı satırın yorumu [Doğrulandı: test + runtime].** İki sunucu aynı kullanıcıyla (sahip) yazdı. Aynı sahibin eşzamanlı yazımında politika deterministik LWW ve çakışma kaydı yok: `tests/sync-owner-lww-v20261009.test.js`, "legacy same-owner events retain at/device ties", conflicts 0.
  - Gözlenen davranış bu politikayla tutarlı. Kit'in ilk ölçütü (`noSilentLoss`: kaybeden değer çakışmada olmalı) farklı sahipler için yazılmıştı; aynı sahip için yanlıştı.
  - Yeni ölçüt: iki taraf aynı değere yakınsar ve değer iki yazımdan biridir.
- **Ürün kararı olarak not:** Aynı kullanıcının iki makinede aynı CP alanını eşzamanlı düzenlemesinde kaybeden değer çakışma listesine düşmez. Bu politika değişikliği bu çalışmanın kapsamı dışında; bilgi için.
- **Farklı sahip / farklı kullanıcı** eşzamanlı senaryosu bu kit'te yok. Simülasyon katmanında `sync-simulation` ("simulator distinguishes real concurrent same-field writes"): çakışma 1, her cihaz kendi değerini tutar.

Düzeltilmiş ölçütle doğrulama koşusu nihai doğrulamaya alındı: `final-validation.sh hub` adımı.

Dosyalar: `ham/hub-run1-8a29116.json`, `ham/hub-run2-tani-8a29116.json` (tanı: mağaza, sorgu ve çakışma anlık görüntüleri; mağaza okuması kit yolu nedeniyle boş döndü, sorgu ve çakışma değerleri geçerli).
