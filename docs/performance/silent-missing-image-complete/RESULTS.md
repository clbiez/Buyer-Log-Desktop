# Sessiz eksik görsel tamamlama — kanıt

Bütçe: [BUDGET.md](BUDGET.md) (ölçümden önce yazıldı). Ortam: cloud Linux, 4 vCPU,
Node 22, Playwright Chromium (headless, web kipi). Taban: Main `390bff6` (worktree).
Sentetik veri: `generate-demo-data.js --rows 30000 --seed 7` (ASAS 30.000 satır),
tüm koşular aynı kaynak baytlarını kullandı (`--source-fixture`). Komut:

```
node scripts/silent-image-complete-acceptance.js --mode perf --rows 30000 \
  --source-fixture <src30k> --app-root <main|aday> --out raw/<n>-<A|B>.json
```

## Adım 0 — sunucu yerel planı (kök neden)

`getCollectionImage` her çağrıda `collection-images/index.json`'u okuyup parse
ediyordu; dağıtım planı kimlik başına çağırır → O(kimlik × indeks).
Ölçüm (`model-image-distribution.plan`, gerçek `user-data` deposu):

| İndeks | Kimlik | Önce | Sonra |
| ---: | ---: | ---: | ---: |
| 1.000 | 129 | 172 ms | 6 ms |
| 20.000 | 129 | 2.769 ms | 72 ms |
| 20.000 | 1.000 | 21.359 ms | 81 ms |

Saha notundaki "129 model ~9 dk, 124 önbellek isabeti" için: "Tümünü Yenile"
(`mode:'all'`) yolunda önbellek isabeti GetStyleImages metadata çağrısından
SONRA belirlenir (129 stil, eşzamanlılık 5) — süre PLM API gecikmesindedir
[Muhtemel; saha günlüğü yok]. Sessiz iş `mode:'missing'` kullanır; yerel
isabetler PLM'e hiç gitmez [Doğrulandı, kaynak + fixture].

## L2 — son kaynak (3 geçerli Main/aday koşusu; sıra 1A 4A 6B 9B 10A 11B)

| Metrik | Main ham | Main medyan | Aday ham | Aday medyan |
| --- | --- | ---: | --- | ---: |
| Açılış perdesi hazır | 5520, 6183, 5685 | 5685 ms | 6306, 5461, 5662 | 5662 ms |
| Orders hazır (Devam → satır) | 208, 206, 114 | 206 ms | 170, 125, 177 | 170 ms |
| CP modül açılışı | 9141, 9869, 9324 | 9324 ms | 10748, 9266, 9321 | 9321 ms |
| Kaydırma >50 ms görev | 0, 1, 0 | 0 | 1, 0, 0 | 0 |
| Sessiz pencere (20 sn) >50 ms görev | 1 (87), 0, 1 (77) | — | 0, 0, 1 (54) | — |
| Tablo gövdesi mutasyonu / bildirim çağrısı | 0 / 0 | | 0 / 0 | |
| Sessiz istek (adet / kimlik / başlık) | — | | 1 / 12 / silent | |

Sessiz pencerede 50–90 ms görevler Main'de de görülür (motor yok) → taban
arka plan işi; aday bu sıklığı artırmadı. Oturum boyunca gözlemci 20–23 uzun
görev gördü (açılış), yani gözlemci çalışıyor.

Geçersiz koşular: 2B, 3B, 5A, 7B, 8A — sunucu 30k yenilemesinin
`snapshot-save` adımında mesajsız sonlandı; Main kolunda da görüldüğü ve bu
adım görsel koduna dokunmadığı için koşum ortamı kararsızlığı sayıldı
[Muhtemel]. Önceki kaynakla alınan koşular `raw-superseded/` altındadır
(`isBusy` koruması eklenmeden önce; o seride CP açılışı karışık işaretli ±1 sn
gürültü gösterdi).

## İşlevsel kabul (40 satır, `raw/functional.json`)

Görünür bir Orders hücresinin görseli sunucuda bağlanıp istemci habersiz
bırakıldı: hücre AYNI `<img>` düğümünde yerinde bağlandı, tablo gövdesinde 0
mutasyon, kaydırma korundu, 0 `showToast`/`BLUI.notify` çağrısı, PLM oturumu
yokken diğer 11 kimlik "bulunamadı" belleğine yazılmadı (`upstreamDeferred`).

## Sınırlar

- Motorun aktif uygulama yolu 30k veride ölçülmedi: PLM oturumu olmadığı için
  ilk istekten sonra 30 dk geri çekilmede kalır. Uygulama yolu O(yama +
  görünür hücre); 30k satır için tek seferlik `_id` dizini kurulur [Güçlü Çıkarım].
- Orders 30k veride sınırlı bir pencere çizer (kaydırma alanı 1.475 px).
- **Electron/native yol ölçülemedi → BLOCKED.** Windows/SMB/gerçek CoreNectum ölçülmedi.

**Karar:** Chromium L2 kapıları PASS; Electron kapısı BLOCKED → genel **BLOCKED**.
