# Birleşik main 68cf1d3 · STABLE kapısı nihai doğrulaması (HIZLI MOD)

**Ortam:**
- Aday: main `68cf1d3a323b2f790dc04e21c65d67b92fca809d`, package.json 8.0.22. #1251–#1260 dahil.
  - Sürüm commit'i 8.0.23 (`6d5b545`, #1262) yalnız sürüm ve SBOM değiştirir; uygulama ağacı aynıdır.
- Karşılaştırma kolu: STABLE 8.0.18 kaynağı `12521fcac6e6eaf233cd56a82d6ea5bd931c990f`.
- Linux 6.18, 4 vCPU (Xeon 2.10 GHz), 15.7 GB.
- Çalışma ortamı: Electron 44.3.0 / Node 24.20.0, `ELECTRON_RUN_AS_NODE=1`, `NODE_OPTIONS="--use-openssl-ca --max-old-space-size=3686"`.
  - Tam `npm test` istisnadır: host Node v22.23.5 ile koşar. Node sonucu üretim çalışma zamanını temsil etmez; regresyon kapısıdır.
- Fixture: sentetik 30k, seed 7.
  - Her 4. ASAS satırında yükleme onayı boşaltılır; Windows kapısıyla aynı dönüşümdür.
  - Dosya özetleri: `ham/fixture.json` (SHA-256).
- Kit: `claude/adr-0003-mimari-varsayim` `79b2142` (`kit/`).
- Kapı betikleri: main `e7f31ee` (`.github/electron-gate`, #1261).
- Çekişme kaydı: `contention.js`, PSI ve steal, 5 sn aralık (`ham/contention-*.jsonl.gz`). Her adımın penceresi `run*.out` içinde.

**Kapsam:** Ebeveyn kararıyla STABLE kapısına indirildi (ADR-0001 §14.1).
- Ertelenenler (yayından sonra):
  - 8.0.18 ↔ birleşik ↔ A/A karşılaştırmalı performans (B);
  - 90–120 dk soak (C).
- Durdurulan perf koşusunun kısmi ham verisi `ham/perf-durduruldu/` altında saklı. Ölçüm sonucu değildir.

## Kapı tablosu

| Kapı | Sonuç | Kanıt | Çekişme |
|---|---|---|---|
| Linux tam `npm test` (68cf1d3) | **PASS**: 1567 dosya, 388,5 sn; iki deneme, ikisi de PASS | `ham/test/` | İki denemede de ÇEKİŞMELİ: cpuSome med ~21 %, steal < 1 %. Kendi paralel yükü; doğruluk sonucu çekişmeden bağımsız |
| Gölge eşitliği, shadow5 (68cf1d3, 30k) | **PASS** (ayrıntı tablonun altında) | `ham/shadow/shadow.json` | SAKİN |
| Gölge, 8.0.18 (bilgi) | PASS (ayrıntı tablonun altında) | `ham/shadowbase/` | SAKİN |
| Linux/Electron kapısı, yeni ölçüt (e7f31ee betikleri, 68cf1d3, 30k, `--strict-known`) | **PASS**: tüm kapılar. G08c N/A, G08b-eski ve G08d-eski INFO (tablonun altında) | `ham/gate/` | SAKİN |
| Linux/Electron kapısı, eski ölçüt (68cf1d3 betikleri) | FAIL yalnız G06 (tablonun altında) | `ham/gate-eski-olcut/` | SAKİN |
| Hub / iki sunucu (S-A5), düzeltilmiş kit (68cf1d3, 30k) | **PASS** (tablonun altında) | `ham/hub/hub.json` | SAKİN |
| Windows Buyer Log Tests, run 46133294212 (ref 68cf1d3) | **PASS** (success) | GitHub Actions | runner |
| Windows BuyerLog.exe kapısı, run 46136459321 (iş akışı e7f31ee, ref 68cf1d3, 30k, strict) | **PASS** (success; ebeveyn bildirdi) | GitHub Actions | runner |
| Windows BuyerLog.exe kapısı, run 46133296698 (eski ölçüt) | FAIL yalnız G06, aynı eski ölçüt nedeni | `ham/windows/` | runner |
| B performans / C soak | ERTELENDİ, STABLE kapısı değil (§14.1 tamamlayıcı kanıt) | — | — |

**Gölge eşitliği (68cf1d3):**
- Kapsanan kayıt türleri: Supp. FOB, not, toplu, POST /rows, Del. Type (PATCH + /rows), Kaynağa dön (/rows), geri al / yinele zinciri, IAS parsiyelli Del. Type + Eksik Adet işaretle/kaldır, kıtlık segmentli satır, düzenlenebilir Ex-factory.
- Sonuç: artımlı ↔ yeniden başlatma ↔ sıfırdan tam kurulum eşit. Dokunulan 19 satırda alan alan 0 fark, 24.982 satırda karar demeti 0 fark.
- Çoklu renk: N/A, fixture'da her sipariş tek renk. Repo testleri iki renkli senaryoyu kapsar.

**Gölge, 8.0.18 (bilgi):**
- 8.0.18'de "Kaynağa dön" (`delType:null`) 200 döner ama etkisizdir: override kalır. Özellik #1255 ile geldi; 8.0.18 için N/A sayılır.

**Linux/Electron kapısı, yeni ölçüt (68cf1d3):**
- G05: yol `fullBuild:no-chain`. İkinci kullanıcının yazımı A'nın kullanıcı kapsamlı satır yaması zincirinde yoktur; bu beklenen yoldur.
- G06 / G06b: satır yaması yolu, satırlar tam kurulumla eşit.
- G09 / G10: 0 fark. G13 soak 15 dk: 62/62 kayıt. 503 = 0. G12 heap sınırı 3782 MB.
- G08c N/A (tüm satırlar DTR). G08b-eski ve G08d-eski INFO.

**Linux/Electron kapısı, eski ölçüt:**
- Değerler doğru, G09 / G10 0 fark.
- FAIL nedeni: G06'nın "okuma tam kurulumda" ölçütü #1241 değişmezini kodluyordu; #1260 artımlı yolu bilerek getirdi. #1261 ile düzeltildi.

**Hub / iki sunucu (S-A5):**
- A→B Supp. FOB ×3 ve B→A Retail: alıcıda alımdan sonra 6,4–8,5 sn içinde görünür (30k projeksiyon).
- Yayım 2. denemede, kayıttan 0,46–0,61 sn sonra.
- Eşzamanlı aynı alan yakınsadı, çakışma 0.
- Sub-Manufacturer: N/A (DTR).

## Hub ilk FAIL'i: kök neden (kit kaynaklı, ürün hatası değil)

İlk koşunun ham verisi `ham/hub-eski-kit/`, bisect `ham/hub-bisect/`.

**Belirti [Doğrulandı: runtime]:**
- Alıcının cp/query değeri 60–120 sn boyunca eski kaldı; değer sonra geldi.
- Kalıcı kayıp ve çakışma yok.

**Ayrıştırma (3k, izole, SAKİN):**

| Koşu | Sonuç |
|---|---|
| `c68-nosync` (68cf1d3, alıcıda yinelenen sync-now yok, 120 sn) | Aynı belirti; alıcının yinelemesi neden değil |
| `o8a-nosync` (8a29116, aynı ayar) | Birebir aynı satırlar ve süreler. 8a29116..68cf1d3 arasında gerileme yok; #1254 / #1255 / #1260 aklandı |
| `c68-diag` (sync-now yanıt alanları) | Yayımlayıcının kayıttan hemen sonraki sync-now'u `uploaded=[0,0]`, `pendingUpload=1` döndü. Kaydın Shared Hub delta kaydı (`cp-shared-store.mirrorPatchDetached`) kayıt yanıtından sonra eşzamansız kuyruğa giriyor. Paket bir sonraki turda gitti; alıcı her değeri bir tur geç gördü |
| `c68-fix` (kit: yayım `up>0`, alım `down>0` olana dek yinelenir) | pass. Yayım kayıttan ~0,4–0,45 sn sonra 2. denemede; alıcıda görünme < 1 sn (3k) |

**Ürün notu [Muhtemel, düşük öncelik]:**
- Kullanıcı kayıttan sonra yaklaşık 0,5 sn içinde "Şimdi senkronla"ya basarsa, o kayıt bir sonraki tura kalır (en geç periyot; varsayılan 5 dk).
- Veri kaybı yok. 8a29116'da da aynı.
- Düzeltme önerilmedi.

## Komutlar

```bash
# Linux/Electron nihai adımları (kit 79b2142, kapı e7f31ee)
REPO=… BASE=12521fcac6e6eaf233cd56a82d6ea5bd931c990f CAND=68cf1d3a323b2f790dc04e21c65d67b92fca809d \
EL=<electron 44.3.0>/dist/electron OUT=$HOME/final-68cf1d3 GATE_JS=<e7f31ee>/.github/electron-gate/gate.js \
  kit/final-validation.sh test gate shadow shadowbase hub     # perf/soak/soakbase STABLE sonrası

# Hub bisect (3k)
HUB_SYNC_EVERY=0 HUB_WAIT_MS=120000 ELECTRON_RUN_AS_NODE=1 NODE_OPTIONS="--use-openssl-ca --max-old-space-size=3686" \
  $EL kit/hub.js <APP 68cf1d3 | 8a29116> <src3000-ex> out.json
```

**Dosyalar:**
- `run-1.out`: ilk koşu (test, gate eski ölçüt, shadow, shadowbase, hub eski kit, perf durduruldu).
- `run.out`: devam koşusu (gate yeni ölçüt, hub düzeltilmiş kit, perf durduruldu).
- `tekrarlar.txt`: çekişme kuralıyla tekrarlanan adımlar.
