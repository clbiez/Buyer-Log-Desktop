# Faz 7 · Bağımsız inceleme / Independent review

Reviewer: **gpt-6-astra**, ayrı `/root/independent_review` agent/model. Salt okunur; kullanıcı bağımsız ikinci model istedi. / Separate read-only model, explicitly requested by the user.

Baz / Base: `63159fb32ff3d5bdc5f142b4a8f16ca6a3983240`. İncelenen üretim deltaları sonradan şu commitlere ayrıldı / Reviewed production deltas were subsequently split into:

- DS-08: `109292a1`.
- INT-04/05: `384fea2c`; bağımsız bazdaki aynı dosyalar / identical files on the isolated base: `5c256eac`.
- INT-11: `ee18c4c5`; bağımsız bazdaki aynı dosyalar / identical files on the isolated base: `6d8d752b`.

## Bulgu ve kapanışı / Finding and closure

**P1 — DS-08 büyük snapshot kapasitesi.** İlk aday ≥256KiB işleri `96MiB + 8×V8 input` tahminiyle havuza zorunlu gönderiyordu. 32MiB worker tabanı ve RAM'in dörtte biri/en çok 4GiB bütçe nedeniyle bazı daha önce yazılabilir DB'ler `COMPUTE_JOB_TOO_LARGE` alabilirdi. Kuyruk yoğunluğu da kalıcı yazmaya yeni başarısızlık bağımlılığı getiriyordu.

**P1 — DS-08 snapshot capacity.** Mandatory compute admission could reject previously writable databases or add a queue-availability prerequisite to durable writes.

TR: Bulguyu önce RED olarak çoğalttık. Düzeltme; kapasite, kuyruk, timeout, worker, closed ve estimate reddinde veya V8'nin kodlayamadığı JSON uyumlu değerde mevcut `large-json` yolunu korur. Fallback öncesi yerel kodlu girdi referansı bırakılır. Snapshot değiştirme/verify/fsync yolu, WAL rotasyon sırası, revision/konum kontrolü ve lease-release sınırı korunur. Fallback eski MAIN CPU maliyetini koruyabilir; her boyutta veya yükte stall çözüldü denmez.

EN: RED reproduced the issue. Known compute/encoding failures now retain the existing large-json path. Durable replacement, validation, WAL rotation and lease/revision/location boundaries remain intact. Fallback may retain the old main-thread CPU cost; the worker responsiveness gain applies to admitted work.

TR: Reviewer yalnız bu bulgunun dar düzeltme takibinde bağımsız olarak şu komutu çalıştırdı; **11/11 PASS, exit 0**. Gerçek 160MiB pool + 5MiB snapshot kapasite reddi, busy/timeout/worker failure, toJSON fallback, exact byte parity ve WAL/lease/konum/generation sınırları kapsanır. **Raporlanan P1 kapandı.** Bu, ikinci genel çapraz tur değildir.

EN: The same reviewer independently verified the narrow fix: **11 tests PASS, exit 0**. Its reported P1 is closed. This is finding verification within one review, not another general cross-review round.

```bash
node --test tests/phase7-snapshot-compute.test.js tests/phase7-snapshot-durability.test.js
```

TR: INT-04/05/11 kaynak incelemesinde ek raporlanabilir P1/P2 bulmadı. Pack shard→pack kilit sırası, fsync→head→index→manifest sırası ve hata yayılımı; parser tek aktif süreç, sınıf içi FIFO/fairness ve işe özel batch sınırları incelendi. Test ve ölçüm yerine review beyanı kullanılmadı. Gerçek SMB/PLM ve Windows kanıtı yoktur. Merge, TEST ve STABLE yapılmaz.

EN: No additional reportable P1/P2 was found in INT-04/05/11 source review. This does not replace tests or establish real SMB/PLM/Windows behavior. No merge or TEST/STABLE publication.

## Paketleme eşleştirmesi / Packaging correspondence

TR: Yeni genel inceleme turu yoktur. İncelenen sunucu dosyalarının Git blob/sha256 kimlikleri ve eski review head’leri [paketleme sözleşmesinde](phase-7-packaging-contract.json) sabitlenir. Nihai PR SHA eşleştirmesi, eski head’in ancestor kontrolü ve her dalın kendi tam regresyonu [devir kaydında](phase-7-packaging-handoff.md) bulunur.

EN: No new general review. Reviewed production blobs are pinned in the packaging contract; final PR heads, preserved ancestry and per-branch full regression appear in the handoff. The capacity P1 closure evidence remains unchanged.
