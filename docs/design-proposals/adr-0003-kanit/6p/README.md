# §6P ham kanıt — 503 GC yeniden ölçüm (PR #1249) ve Electron yeniden ölçümleri (2026-11-27)

Bu klasördeki dosyalar repo dışı ölçüm betikleri ve ham çıktılardır, ürün kodu değildir. Tüm veri
sentetiktir: 30k fixture, seed 7, CP 24.982 satır.

- Ortam: Linux sandbox, 4 vCPU, 15 GB RAM.
- Çalışma ortamları:
  - Node 22.23.5.
  - Electron 44.3.0 Linux x64 (gömülü Node 24.20.0). Sunucu `ELECTRON_RUN_AS_NODE=1` ile, ölçüm betiğiyle aynı ikiliden (`process.execPath`) başlatılır.
- **Üretim temsilî çalışma ortamı Electron'dur.** Node 22 sonuçları mutlak değer olarak üretimi temsil etmez.

## Commit'ler

| Ad | SHA | Not |
|---|---|---|
| main (taban) | `38ef0516bd2874b141f73bf9c98d23cb635a7b0a` | ölçüm anındaki main |
| PR #1249 head | `782d48e9a0e9007a18b0ce1b3c42ca03f0e80c3a` | `38ef051` + GC yeniden ölçüm (3 dosya), dal `claude/compute-503-gc-recheck` |
| birleşik | `e379c92fb114e15c13e6ecc653ec1eba547bb7f0` | #1236 `211863f6` + PR `782d48e` merge; dal `claude/cp503-olcum` (PR yok) |
| pre-#1243 | `3dfc951ce903f7c67c70a61b4caecf48ea809ad7` | #1243 squash commit'i `27dbaf0`'ın ebeveyni |
| kit | `a1357ca` | `../kit/` |

Birleşik dalı yeniden oluşturma:

```bash
git worktree add -b cp503-yeniden <yol> 211863f6
git -C <yol> merge --no-edit 782d48e   # e379c92 ile aynı ağaç
```

## Hazırlık

```bash
# her commit için ayrı worktree + node_modules bağlantısı
git worktree add --detach <wt> <SHA>
ln -s <repo>/resources/app/node_modules <wt>/resources/app/node_modules

# fixture
node <wt>/resources/app/scripts/generate-demo-data.js "$SRC" --rows 30000 --seed 7

# Electron (repo dışı klasör)
npm install electron@44.3.0
E=<klasör>/node_modules/electron/dist/electron

KIT=<repo>/docs/design-proposals/adr-0003-kanit/kit
B=<bu klasör>/betikler
```

**Kit'ten farklar.** `betikler/` altındaki kopyalar kullanılır.
- `hook-mem.js` ve `hook-t0.js` ek olarak `gcRecheckSkipped` (`skip`) kaydeder; `hook-t0.js` `gc` alanını da kaydeder.
- `analyze7.js` `gcSkip` ve `jobs` sütunlarını ekler.
- Diğer betikler yenidir: `analyze4.js`, `analyze-long.js`, `analyze-fresh.js`, `analyze-note.js`, `analyze-simple.js`, `run-4arm*.sh`, `probe-gc.js`.
- `run-*.sh` dosyaları bu oturumun mutlak yollarını içerir; yolları kendi kurulumunuza göre değiştirin.

## Veri kümeleri (`ham/`)

| Klasör | Çalışma ortamı · NODE_OPTIONS | Commit(ler) | Tasarım | Yeniden üretme |
|---|---|---|---|---|
| `l2-3686` | Node 22.23.5 · `--use-openssl-ca --max-old-space-size=3686` | pre `38ef051`, main `782d48e` | `run-l2.sh`: 5 kol × 3 blok (mainoff / maingc / mainoffAA / preoff / pregc), 6 kayıt / koşu. `pre*` = `AB_INTENT=0` (eski istemci gövdesi), yani main−pre taban karşılaştırması değildir | `NODE_OPTIONS="--use-openssl-ca --max-old-space-size=3686" KIT=$B SRC=.. OUT=.. PRE=<38ef051>/resources/app MAIN=<782d48e>/resources/app $KIT/run-l2.sh` (`run-l2.sh` kit'ten; kanca ve analiz `$B`'den) |
| `l2-8192` | Node 22.23.5 · `…=8192` | aynı | aynı | aynı, `=8192` |
| `parity-3686` | Node 22.23.5 · 3686 | base `38ef051`, aday `782d48e` | bayrak kapalı, ikisi de `AB_INTENT=1`; sıra B P P B B P | `betikler/run-step2.sh` ilk bölüm; özet `analyze-simple.js` |
| `long-3686-gc0` / `-gc1` | Node 22.23.5 · 3686 | `782d48e` | 200 kayıt (100 Supp. FOB + 100 not), aralık 5 sn; 43,6 / 41,2 dk | `betikler/run-all.sh` ikinci döngü; `analyze-long.js` |
| `electron-3686` | Electron 44.3.0 · 3686 | `782d48e` | off on on off, 6 kayıt / koşu | `betikler/run-step2.sh` Electron bölümü; `analyze-simple.js`. `commit.txt`'te Electron sürümü boş yazıldı; sürüm 44.3.0 |
| `arm4-electron-3686` | Electron 44.3.0 · 3686 | `e379c92` | `ab8.js` aynı t0; kollar none / cp / gc / both / noneAA; 3 blok; seq / par / ordersOnly | `NODE_OPTIONS=".. 3686" KIT=$B SRC=.. OUT=.. APP=<e379c92>/resources/app $B/run-4arm-electron.sh` (`ab8.js` kit'ten; `$B`'ye kopyalayın veya yolu düzeltin) |
| `electron-long-3686-gc0` / `-gc1` | Electron 44.3.0 · 3686 | `782d48e` | 120 kayıt (60 + 60), aralık 5 sn; 19,3 / 19,7 dk | `betikler/run-electron.sh` ikinci bölüm |
| `fresh-electron-3686` | Electron 44.3.0 · 3686 | `782d48e` | `fresh2.js`; U2 Del. Type PATCH; off gc gc off; 4 deneme / koşu | `betikler/run-electron.sh` son bölüm; `analyze-fresh.js` |
| `note-electron-3686` | Electron 44.3.0 · 3686 | pre `3dfc951` (`AB_INTENT=0`), main `38ef051` (`AB_INTENT=1`) | `ab3.js`; pre / main / mainAA; P M A, A M P, P M A | `betikler/run-note.sh`; `analyze-note.js` |
| `arm4-3686-node22-partial` | Node 22.23.5 · 3686 | `e379c92` | 2/15 koşu sonrası durduruldu (birincil kol Electron'a taşındı). **Kullanılmadı** | — |
| `testler/` | Node 22.23.5 · 8192 (sandbox) | `782d48e` | tam `npm test`, bayrak kapalı / açık | `npm test`; `BUYER_LOG_COMPUTE_GC_RECHECK=1 npm test` |
| `prob/` | Node 22.23.5 ve Electron 44.3.0 | `782d48e` | işçi heap sınırı ↔ heap bayrağı; GC kancası | `prob/probe-gc.txt` içindeki komutlar |

Her koşu klasöründeki dosyalar:
- `r<i>-<kol>.json`: istemci ölçümü.
- `.hook`: sunucu kancası; 1 sn bellek, işçi oluşturma/çıkış, iş sonuçları.
- `.log`: koşu çıktısı.
- `ozet.txt`: analiz çıktısı.
- `commit.txt`: SHA ve NODE_OPTIONS.

Sonuçlar ve kararlar: ADR-0003 §6P.
