# Buyer Log — zorunlu performans kabulü

Bu sözleşme her güncelleştirme ve yeni modül için geçerlidir. Codex, Claude,
Cloud, yerel ajan, Copilot, Cursor, Gemini veya başka bir geliştirme aracı aynı
kabulü kullanır. Üst sözleşme [CLAUDE.md §3.2](../CLAUDE.md)'dir.

Amaç, kullanıcı hedefini en az gerekli CPU, bellek, I/O ve ağ işiyle karşılamak;
mevcut akışları yavaşlatmamaktır. Evrensel “maksimum hız” iddiası yerine ölçülmüş
bütçe ve tekrarlanabilir kanıt gerekir. Sadece testlerin geçmesi, daha az kod veya
tek hızlı mikro benchmark performans kabulü değildir.

## 0. Kademe seçimi (önce bunu belirle)

| Kademe | Ne zaman | Gerekli kanıt |
| --- | --- | --- |
| **N/A** (varsayılan) | Runtime maliyetini etkilemeyen değişiklik: doküman, talimat, test, sürüm notu, yalnız metin/çeviri. | Değişen dosyalar ve tek satır gerekçe (§4). |
| **L1 · tek ölçüm** (varsayılan runtime kademesi) | Sıcak yol dışında, yerel etkili runtime değişikliği (tek ekran/diyalog/eylem, küçük veri). | Etkilenen senaryoda aynı veri/ortamla Main ve aday **birer koşu**; birincil metrik (etkileşim→yanıt veya uçtan uca süre) ve gerekiyorsa istek sayısı. §1–§3 ayrıntıları uygulanmaz. |
| **L2 · tam A/B** | **Sıcak yol** (başlangıç, modül açılışı, büyük tablo render/filtre/kaydırma, worker/compute), **büyük veri** (30k fixture yolu) veya **sync/polling/ağ/updater/launcher/Electron native** değişikliği. | Bu dokümanın §1–§3'ü tam uygulanır: önceden bütçe, ≥3 dönüşümlü Main/aday çifti, medyan + ham örnekler, etkilenen kapılar. |

- **Yükseltme:** L1 ölçümünde gerileme görülür veya fark gürültüden ayırt
  edilemezse iş L2'ye çıkar. Kademeyi düşürmek için gerekçe yazılır; sıcak yol
  değişikliği L1 ile kapatılamaz.
- **Bilinen risk:** L1 tek koşu olduğu için küçük (gürültü düzeyinde) gerilemeleri
  kaçırabilir. Bu, düşük maliyet için bilinçli kabul edilmiş ödünleşimdir; sıcak
  yollar L2'de kalır ve TEST yayınındaki tam regresyon/performans kapıları sürer.

## 1. Değişiklikten önce (L2)

1. Kullanıcının istediği davranışı, etkilenen dosya/çağrı zincirini ve mevcut
   sorunu doğrula. Salt optimizasyon için gerçek darboğaz ölçümü gerekir;
   özellik/hata düzeltmesinde hedef zaten açıksa ayrı optimizasyon işi icat etme.
2. Güncel Main SHA'sını, senaryoyu, sentetik veri boyutu/hash'ini ve ortamı kaydet.
   Normal ve büyük/yoğun kullanım örneği seç; büyük veri yolunu değiştiriyorsan
   yalnız 20 satırlık görsel fixture ile kabul verme. Mevcut 30k fixture uygunsa
   onu kullan; ilgisiz her değişiklik için yeni genel benchmark açma.
3. İlgili metrikleri, birimlerini ve sayısal bütçelerini **uygulamadan önce** yaz.
   Mevcut sınır/kapı daha sıkıysa onu koru. Yeni modülde mevcut akışların
   gerilememe bütçesine ek olarak aktif kullanımın süre, tepe bellek/bayt,
   eşzamanlı iş ve istek bütçelerini tanımla. Özelliğin hiç bulunmadığı Main'de
   yeni işin süresini sıfırla karşılaştırma; karşılığı olan mevcut akışları ve
   yeni iş için belirlenen bütçeyi ayrı değerlendir.
4. Ortak altyapıyı kullan; ihtiyacı kanıtlanmayan yeni worker/havuz/cache/timer,
   spekülatif prefetch veya geniş refactor ekleme. Donanım, concurrency, queue,
   timeout, retry veya memory limitini artırarak kabulü geçirme.

## 2. Asgari kabul kapıları (L2)

Yalnız gerçekten etkilenen satırlar ölçülür; ilgisiz satır için dosya/çağrı
zincirine dayanan N/A gerekçesi yazılır. Mevcut başarısız eski bir kapı açıkça
kayıtlı kalır; bu görev onun düzeldiğini iddia etmez ve onu kötüleştiremez.

| Etki | Ölçüm ve zorunlu kabul |
| --- | --- |
| Başlangıç / modül ekleme | Gerçek kullanılabilir ekran ve ilk niyet→sonuç süresi; ilk kullanım ve tekrar kullanım ayrı. Perdeyi erken kaldırmak tek başına kazanç değildir. Modül görünmeden ağır bağımlılık/parse/render/ağ/polling başlatılmaz; küçük kayıt/menü kabuğu dışında mevcut başlangıç işi büyütülmez. |
| UI / tablo / hesap | Etkileşim→görünür yanıt, en uzun ve toplam main-thread bloklanması, render/DOM işi. Yeni etkileşimde ilk geri bildirim hedefi ≤200 ms; uzun işlem gerekiyorsa gerçek ilerleme ve iptal çalışır. İşlemin toplam süresi ayrıca bütçelenir; spinner işi bitmiş göstermez. Yeni veya büyüyen >50 ms bloklayan görev bölünür/mevcut worker yoluna alınır; eski ihlaller rapordan çıkarılmaz. |
| Sunucu / worker / dosya | Uçtan uca süre; queue/admission, CPU, disk/bayt ve iptal dahil. Yalnız worker süresinin azalması yeterli değildir. Mevcut output/karar/hash, sıralama, IAM ve dayanıklılık eşdeğer kalır. |
| Bellek / cache / görseller | İş boyunca tepe RSS/heap veya ilgili gerçek bayt rezervasyonu; bunlar aynı metrik diye sunulmaz. Mevcut akışta tekrarlanabilir tepe artışı yok; yeni iş açık bayt/öğe sınırına uyar. Büyük veri bütünü gereksiz kopyalanmaz. En az 5 aç/kapat veya başlat/iptal döngüsünde retained kaynaklar ölçülür; sürekli büyüme, kalan permit/listener/stream kabul edilmez. |
| Ağ / polling / sync | Aynı senaryoda istek/sorgu/SSE sayısı, bayt, eşzamanlılık ve iptal sonrası kalan iş. Aynı bağlam için yeni mükerrer poller/SSE/indirme yok. Gizli/kapalı modül yeni gereksiz trafik üretmez; görünürlük ve owner/erişim izolasyonu korunur. Yeni özelliğin gerekli aktif trafiği ayrı sayısal bütçeye uyar. |
| Yeni modül yaşam döngüsü | Lazy yükleme, sınırlı ilk görünür render, ihtiyaca göre hesap; büyük tabloda tüm satır DOM'u/kopyası gerekçesiz oluşturulmaz. İlk/tekrar açılış, düzenleme, kopyala/yapıştır/export, kapat/yeniden aç ve iptal/cleanup doğrulanır. Veri ve dirty-edit korumaları aynıdır. |
| Electron / native sekme | Ürünün hedef Electron sürümü ve gerçek workspace/preload/native sekme yolu kullanılır. Chromium web kabulü yardımcı kanıttır; Electron kabulünün yerine geçmez. Windows/SMB/kurumsal upstream ölçülmediyse sınır açık yazılır. |

## 3. Gerilememe ve ölçüm yöntemi (L2; L1 yalnız yükseltme kuralına tabidir)

- Süre/CPU/bellek gibi düşük olması iyi olan mevcut akış metriklerinin varsayılan
  bütçesi taban değerdir; çıktı sayısı/throughput gibi metriklerde yön tersidir.
  İstek sayısı, sahiplik, iş paylaşımı ve çıktı doğruluğu ayrıca kontrol edilir.
  Bir metriği iyileştirip etkilenen başka metriği kötüleştirmek otomatik PASS değildir.
- En az **3 dönüşümlü Main/aday çifti** aynı makine, runtime/sürüm, veri, izin,
  cache durumu ve concurrency ile çalışır. Soğuk ve sıcak sonuçlar karıştırılmaz.
  Medyan ve bütün ham örnekler yazılır; en hızlı tek koşu seçilmez. p95 iddiası
  için tanımlı örnekleme yöntemi ve senaryo başına en az 20 gözlem gerekir;
  3 koşudan güvenilir p95 çıkarıldığı iddia edilmez. Kritik kuyruk/tail yolu
  değişiyorsa yeterli tail örneği ayrıca toplanır.
- Ölçülen medyan/tail bütçeyi aşarsa otomatik tolerans uygulama. Küçük farkın
  gürültü olduğu düşünülüyorsa aynı tabanın kontrollü A/A tekrarlarıyla gürültü
  aralığını kaydet ve yalnız ilgili senaryoyu yeniden doğrula. Gürültü içinde
  kalma gerekçesini ve aralığı yaz. **Tekrarlanabilir gerileme kabul edilmez**;
  +%5/+%10 gibi genel bir “izinli yavaşlama” yoktur. Belirsizlik çözülmezse BLOCKED.
- Salt performans iyileştirmesinde hedef kazanç ölçüm gürültüsünü aşmalıdır.
  Kazanç kanıtlanmıyorsa aday optimizasyonu geri al/SKIPPED raporla; fazladan
  karmaşıklığı rastgele kalıcılaştırma. Yeni özellikte bütçe içinde doğrulanmış
  yeni yetenek yeterlidir; uydurma genel hızlanma yüzdesi gerekmiyor.
- Aynı makinede ağır ölçüm ve tam testler
  `/tmp/buyerlog-performance-measurement.lock` ile seri çalışır; farklı makinelerin
  sayıları tek A/B serisi sayılmaz. Yerel/cloud sonuçları kendi ortamını kanıtlar.
- Son kaynak SHA'sı ölçülür. Main entegrasyonu veya sonradan değişen kaynak ilgili
  yolu etkiliyorsa kabul tekrarlanır. Yalnız doküman/kanıt eklenmişse kaynak
  eşitliğini kaydet; gereksiz tekrar yapma. Ham log, komut ve veri hash'i korunur;
  gerçek iş verisi/credential kaydedilmez.

## 4. Teslim ve karar

PR açıklaması [ortak şablondaki](../.github/pull_request_template.md) performans
bölümünü içerir. Ayrıntılı kanıt `docs/performance/<işe-özel-dizin>/` altında veya
kalıcı CI artifact'inde saklanır; kısa işte PR'daki yeniden çalıştırılabilir komut
ve ham sonuç yeterlidir. Başka PR'ın/eski SHA'nın yeşil sonucu kopyalanmaz.

PR'da kademe (N/A / L1 / L2) ve karar birlikte yazılır.

- **PASS:** İlgili kapılar, veri/doğruluk eşdeğerliği ve önceden yazılmış bütçeler
  son kaynakta geçer; kalan platform sınırları açık yazılır.
- **FAIL:** Ölçülmüş gerileme, limit/cleanup/doğruluk ihlali vardır. Dar düzeltme
  yap; yeniden doğrulamadan merge/yayın yapma.
- **BLOCKED:** Gerekli ölçüm, gerçek runtime veya yeterli kanıt yoktur. Eksik kapı
  ve somut engeli raporla; sadece yeşil unit test/CI ile kapatma.
- **N/A:** Ürün runtime maliyetini etkilemeyen doküman/talimat/test değişikliğidir;
  değişen dosyalar ve neden açıklanır. CSS, bağımlılık, launcher/build/paket veya
  sunucu değişikliğine otomatik N/A verilmez; gerçek etki incelenir.

Kapsam içindeki tercihleri kaynak ve ölçümle çöz; rutin soru sorarak işi bırakma.
Performans ödünleşimine mevcut oturumda açık kullanıcı kabulü varsa aynı somut
metrik ve sınırla kaydet; bu genel bir muafiyet veya yeni eşik yükseltme yetkisi
değildir. Kabul yoksa çöz/geri al veya kanıtlı açık PR bırak. Tarihsel istisnalar
başka değişikliğe taşınmaz; ertelenen işler tamamlanmış sayılmaz.

Mevcut hedefli test, gerektiğinde standart tam regresyon, i18n, sürüm notu/gerçek
PNG ve son SHA CI kuralları ayrıca devam eder. Talimat/PR şablonu ölçüm motoru
değildir; hızlı CI performans ölçümünün yerine geçmez. Branch protection gerçekten
etkin değilse otomatik merge engeli varmış gibi raporlama. TEST/STABLE ayrı
yetkilendirmedir; bu sözleşme kendi başına yayın başlatmaz.
