# Faz 7 · TR/EN sürüm notları / Release notes

TR: Kullanıcının `public/**` sınırı nedeniyle bu paket uygulamanın pending sürüm notu dosyasına yazılmaz. Aşağıdaki metin ve gerçek post-change PNG'ler inceleme teslimidir; TEST/STABLE yayını değildir. Ekranlar demo verili gerçek Buyer Log'dur; süre kazancının kanıtı benchmark kayıtlarıdır.

EN: The explicit public/** boundary leaves the application's pending notes untouched. These notes and actual post-change PNGs are review artifacts, not a TEST/STABLE publication. Real demo-data screens are smoke evidence; timings come from the benchmark.

- **DS-08 — Kayıt sırasında daha kısa sunucu duraklamaları.** Büyük kontrol noktalarının hazırlanması ortak hesaplama kapasitesinden yararlanır. Ölçülen işlemde duraklama azalırken toplam kayıt süresi ve bellek artmıştır; eski kapasiteyi koruyan geri dönüş yolu kullanılabilir.
  **Reduced server pauses during checkpoints.** Large checkpoints use shared compute capacity. The measured pause decreases with some additional total time and memory; a fallback preserves existing write capacity.
- **INT-04/05 — Yerel model görsellerinde daha az bekleme.** Yerelde hazır görseller için ortak klasör taraması atlanır; ortak görsellerin toplu yayını daha az metadata işlemiyle hazırlanır. Bu sürümde Windows/SMB hızlanması ölçülmemiştir.
  **Less waiting for local model images.** Available local images avoid shared-folder scans, and grouped publication reduces metadata work. Windows/SMB speedup has not been measured.
- **INT-11 — Küçük rapor grupları daha hızlı hazırlanır.** Kısa dosya işlemlerinin büyük aktarımlar arkasında beklemesi azaltılır. Dosya güvenlik ve iptal sınırları korunur.
  **Small report groups prepare faster.** Short file actions spend less time behind bulk imports. Parsing safety and cancellation limits remain.

Gerçek post-change görseller / Actual post-change captures: [TR açık / TR light](assets/phase7-server-tr-light.png), [EN koyu / EN dark](assets/phase7-server-en-dark.png).
