# Korunan RED / başarısız kanıtlar

- `red.txt.gz`: gerçek başlangıç sync servisiyle ortak admission testi kırmızı.
  Bütçe bir transport'a sığarken 4 transport başlar (`4 !== 1`). GREEN aynı
  assertion'ı korur. `onWritten` diagnostic'i yorumdaki vaadi ayrıca sınar.
- İlk stream mock smoke denemesinde `ERR_STREAM_PREMATURE_CLOSE` görüldü
  (chat terminal kanıtı). Producer, EOF tüketilmeden body'yi destroy ediyordu.
  Mock şimdi tüketici end/close'unu bekler; gerçek writable backpressure ve
  request/response settle testleri de eklenmiştir.
- `green-attempt-1.txt.gz`: 14/15. Yanlış uzunluk testinin "kısa body" girdisi
  511 byte'tı; devralınan valid PNG fixture'ı en az 512 byte ister. Fixture
  üreteci gevşetilmedi. Deney 512 body / 513 Content-Length olarak düzeltildi;
  beklenen hata ve assertion aynıdır. `green-attempt-2.txt` 18/18.
- `attempt-1-fault-measurement-runner.txt` ve aynı önekli partial/cancel ham
  çıktılar: cancel cohort'unda baseline'a boolean `isCancelled` köprüsü
  geçirilmemişti. Eski servis AbortSignal okumadığı için terminal status oracle'ı
  kırıldı. Her iki kola aynı signal→boolean köprüsü verildi; assertion'lar
  korunarak bütün fault çiftleri yeniden çalıştırıldı. Başarısız stdout boşsa
  boş dosya da stderr ile birlikte korunur.
- `native-tests-environment-failure.txt`: 12 dosyada 87 assertion geçti,
  2 dosya `/home/agent/.buyer-log/write-recovery` varsayılanına erişemedi
  (`ENOENT`). Test dosyaları değiştirilmedi. SERVER/DATA/LOCAL/TEMP/CONFIG/DB
  kökleri izinli sentetik scratch dizinine yönlendirilince 99/99 geçti.
- `attempt-1-measurement-*`: ilk AB/BA/AB turu başarı/çıktı eşdeğerliğini
  sağladı, ancak sonraki öz kontrolde **link olmayan ownership güncellemesi**
  için de final CAS guard gerektiği görüldü. Guard ve regression testi eklendi;
  eski ölçümler silinmedi, nihai kaynakla altı ana ölçüm tekrarlandı. Eski tur
  final medyana katılmaz. `attempt-2-*` fault kanıtları da önceki aday sürümüne
  aittir; final fault dosyaları öneksiz olanlardır.

23 final prototip testi, 29 devralınan helper testi, 10 değiştirilmemiş #899
hazırlık testi ve 99 native assertion yeşildir. i18n yeni eksik/baseline sıfır.
Tam regresyon, üretim entegrasyonu ve bağımsız P1 incelemesi çalıştırılmadı;
kullanıcı bunları ana sohbete ayırdı.

EN: Failed assertions and environment failures are retained. No test, validator,
timeout or fixture guard was weakened. Superseded measurement cohorts are
archived and excluded from the final medians.

Ham Node failure çıktılarındaki boş satır sonu whitespace nedeniyle ilk
`git diff --check` kırıldı. Bu çıktı `diff-check-failure.txt.gz` içinde korundu;
RED ve ilk GREEN failure logları bayt değiştirmeden gzip ile saklandı. Logların
içeriği temizlenerek kanıt değiştirilmedi. Son diff kontrolü ayrı çalıştırıldı.
