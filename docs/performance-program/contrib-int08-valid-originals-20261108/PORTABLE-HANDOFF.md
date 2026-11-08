# INT-08 portable preparation / Taşınabilir hazırlık

12 v2 hazırlık dosyası byte-exact kopyalandı. Orijinal kaynak/pin/dosya/kanıt değiştirilmedi; bu devirde uygulama, test, görsel generator veya benchmark çalıştırılmadı. `preparation/portable-manifest.json` raw SHA-256 değerlerini doğrular.

v2 içindeki `/tmp` cache ve `/workspace` repo/dependency yolları tarihsel environment default'larıdır. Yeni sohbet orijinal v2 dosyalarını değiştirmeden kendi executable kopyasında CLI yollarına dönüştürmeli; yeni izole fixture kökü belirtilmelidir. Kaynak veri demo 30k seed7 arşivinden gelir. Başka sohbetin `/tmp` alanının var olduğu varsayılmaz. 32 görsel / codec-size dağılımı / 180 frame ve iki scroll geçişi / izin-çıktı kontrolleri / disk admission ve eski #916 guard'ları azaltılmaz.

**Ayrı kapsam:** Eski README `#908 sonrası final kabul` şartını kayıtlı tutar. Yeni görev yalnız kabul edilmiş Main `1796193f0a57c7785e7bf9fdb3557e33c550b25e` üzerinde **tanı** içindir. Bu tanı #908 veya INT-08 üretim/final kabulü sayılmaz; eski metin ve ölçümler yeniden etiketlenmez. Önce gerçek sentetik orijinallerle maliyet ölçülür. Üretim veya preview implementasyonu bu devirle yetkilendirilmez.

EN: A byte-identical portable copy of the unexecuted v2 packet. Historical paths are not shared-session requirements; adapt an executable copy with explicit local paths and fresh synthetic fixture roots. Preserve the complete workload, assertions, disk admission, #916 guards and old provenance. The new task is a diagnostic at accepted Main 1796193f, distinct from the historical post-908 final acceptance requirement. No preview implementation, production change, test, image generation or benchmark was run by this handoff.
