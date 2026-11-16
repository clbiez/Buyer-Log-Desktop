# UI rebuild kanıt arşivi / UI rebuild evidence archive

Bu klasördeki faz kanıtları (≈5.900 dosya, ≈755 MB ekran görüntüsü, export ve
log) çalışma ağacını ve CI checkout'larını büyüttüğü için ana daldan çıkarıldı.
Runtime, testler ve yayın paketi bu dosyaları kullanmıyordu. İçerik Git
geçmişinde değişmeden durur; `docs/ai/ui-rebuild-*.md` raporlarındaki bağlantılar
bu commit'teki dosyaları gösterir.

The phase evidence that lived here was removed from the main tree to keep
checkouts small; nothing in the runtime, tests or release package used it. It is
preserved unchanged in Git history.

```text
git checkout c529e6f -- docs/ai/ui-rebuild        # hepsini geri getir / restore all
git show c529e6f:docs/ai/ui-rebuild/<yol/path>    # tek dosya / single file
```
