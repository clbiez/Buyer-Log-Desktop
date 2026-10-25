# Manifest — Faz 2.4, kalan ekranlar

Yerel bağımlı dal: `ui-rebuild/phase-2-remaining`; taban
`ui-rebuild/phase-2-operations` / `555a1b48`. PR açılmadı, CI/merge/yayın yok.

## Değişiklik

Komut paleti, arama yardımı, çift hafta takvimi, Excel içe aktarma/şablonları,
Layout Kontrolü, Overview düzenleme/widget kataloğu ve harita görünümü ortak
bileşen görünümüne taşındı. Sekiz modül CSS'i yalnız yerleşim/veri geometrisi
üretir. Kalan global sınıf görünümleri ortak bileşen kaynağına alındı;
[taşıma dökümü](ui-rebuild/phase-2-remaining/css-migration.json).
Tüm uygulama gövdesi ortak kontrolleri kullanır; JS kancaları korunur.

Haritadaki hedef, rota parçacığı ve araç işaretleri kare; gerçek dünya küresinin
coğrafi kırpması daire olarak kalır. Aralık kontrolleri native değer/ok tuşu
davranışını koruyan kare tutamaçlar kullanır. İçe aktarma dosya seçimi Enter ve
boşluk ile erişilebilir. Hücre ve pencere içindeki sabit yazılar ölçek tokenlarına
bağlandı. Excel/e-posta belge üreticilerindeki sabit biçimlere dokunulmadı.

Çıktı şablonu formu yeniden çizilen içeriği çevreleyen sabit diyalog köküyle ortak
yığına katılır. Biçim değişiminden sonra Tab/Shift+Tab içeride kalır; Escape önce
çocuğu kapatır. Royalty'nin kaydedilmemiş değişiklik onayı ve yol süresi
penceresinin önce açık seçiciyi kapatma davranışı korunur. Excel şablonu,
yerleşim, widget ve sync pencereleri ortak odak yaşam döngüsünü kullanır.

## Gerçek kanıt

[52 PNG ve kayıtları](ui-rebuild/phase-2-remaining/): `screens/` 24,
`states/` 17, `final/` 11. Üç tema; dar ekran ve dört boyut için temsilî içe
aktarma. `final/royalty-light` ve `final/output-layout-light` eski aynı adlı
`states/` görüntülerinin yerini alır. Excel araçlarında `states/` yenidir.

İlk denemede saptanan koyu bildirim sayacı kontrastı, şablon örnek metni
kontrastı, royalty başlık çizgisi ve nested modal klavye hataları düzeltildi.
Son ilgili görüntülerde görünür geometri, örnek metin kontrastı ve belge taşması
bulgusu sıfır. Bu tarama tam WCAG sertifikası değildir; pseudo-element slider
şekli ayrıca görüntüden ve native ok tuşu denemesiyle doğrulandı.

**Ölçek kanıtı düzeltmesi:** `applyUiFontStep` piksel artışı değil 0/1/2/3
indislerini alır (standard/large/xl/compact). İlk G4 dosya adlarında `-1` ve `0`
standard, `1.5` large, `3` compact'tır. Eksik XL ayrı `final/import-dark-xl.png`
ile gerçek `data-ui-scale=xl`, `--ui-font-add:3px` kaydedilerek doğrulandı.
Faz 2.3'teki `-1/0/1/2` denemesi compact'ı kapsamamıştı; o fazın dört boyut
beyanı bu notla düzeltilir. Proje sonu matris doğru indisleri kullanacak ve
uygulanan tema/ölçek metadata'sını saklayacaktır.

[Kontrol dökümü](ui-rebuild/phase-2-remaining/checks.json) ilk başarısızlıkları ve
sonuçları birlikte saklar. Son import/editör/Manifest koşusu 47/47, transit ve
clipboard/export koşusu 49/49, son ortak guard koşusu 6/6. Diğer etkilenen
katman/royalty testleri ayrı kayıtlıdır. Eski CSS dosyası/token beklentileri aynı
anlamı koruyarak canonical kaynağa güncellendi. Global Flow ham renk baseline'ı
6'dan 0'a indirildi; istisna tavanı büyütülmedi.

24 benzersiz gerçek pencere klavye senaryosunun son denemesi geçti. Biçim
sonrası nested form, dosya seçimi ve native slider ayrıca doğrulandı.
i18n: 0 eksik; release note: 68 geçerli kayıt (bu grupta 5 yeni TR/EN+PNG).
Sürüm değişmedi. **Tam npm test çalıştırılmadı; proje sonunda çalıştırılacak.**

[46 export karşılaştırması](ui-rebuild/phase-2-remaining/export-comparison.json):
HTML/TSV bayt eşitliği; 16 XLSX'in tüm `xl/` bölümleri eşit. Kapsam CP,
Siparişler, Nakliye, Koleksiyon ve Ön Maliyet. Veri, biçim ve hücre renkleri
başlangıç referanslarıyla aynı. Excel ZIP zaman damgası eşitlik ölçütü değildir.

BLPerf ölçümü ve başlangıç farkları
[performance-comparison.json](ui-rebuild/phase-2-remaining/performance-comparison.json)
dosyasındadır. Aynı seed/ortam; fixture verilerinden arındırılmış yeni sunucu,
beş tarayıcı bağlamı; başka test veya ekran taraması eşzamanlı çalıştırılmadı.
Medyanlar: açılış 956,7 ms (−%6,2), CP 1092,7 ms (+117,3 ms / +%12),
5000 satır 3132,4 ms (+136,5 ms / +%4,6). Gizli modüller lazy, başlangıç
CP/Sipariş DOM satırı 0; büyük veri her denemede 50 görünür satır. CP ve büyük
tablo yavaşlaması son CSS konsolidasyonu ve final ölçümünde takip edilecek.

## Sonraki temizlik ve sınır

Faz 3: geçici alias katmanı, `design-butunluk.css`, artık kullanılmayan
kurallar/font tanımları ve tekrarlanan adapter'lar kaldırılacak; global kök
kurallar, JS tema başvuruları ve z-index kademeleri tek kaynağa indirilecek.
DESIGN_SYSTEM gerçek sisteme göre yazılacak; tüm envanterin son matrisi,
export/perf karşılaştırması ve tam npm test henüz yapılmadı.

Eski iframe Lisans Atlası, `perf-runtime.js:licensecards` tarafından yüklenmez;
aktif yerel kart/map editörü kullanılır. Engine ve supplier HTML export'u
aktif olduğundan korunur. Eski kabuk/varlıkların kaldırılması ve testlerin
aktif sözleşmeye ayrılması Faz 3 kullanım incelemesinde ele alınacak.

Push/PR Actions tetikleyebileceği için yapılmadı. CI çalışmadı; merge, TEST ve
STABLE yapılmadı. Bu rapor proje tamamlandı beyanı değildir.
