# Faz 5 · Çalışma zamanı tanılaması / Runtime diagnostics

TR: Normal çalışma sayısal heap/stall izleyicisini açık tutar. Ayrıntılı CPU
profili `BL_STALL_PROFILE=1` ile ayrıca etkinleştirilir; `0` veya tanımsız değer
profil başlatmaz. Heap baskısı, 3.000 ms olay döngüsü stall eşiği ve saat/uyku
ayrımı değişmedi. Ayrıntılı modda örnekleme 5 ms, profil penceresi 60 saniye,
gerçek stall profili eşiği 10.000 ms ve saklama sınırı üç dosyadır. Dosyalar ve
özetler kontrol worker'ında hazırlanır; HTTP thread'ine ham profil gönderilmez.
Normal kapanış hem hesaplama havuzunu hem inspector bağlantısını bekler.

EN: Normal operation retains numeric heap and event-loop stall diagnostics.
Detailed CPU profiling is explicitly enabled with `BL_STALL_PROFILE=1`; `0`
or an unset value does not start it. Heap pressure, the 3,000 ms event-loop
stall threshold and suspend/clock handling are unchanged. Detailed mode retains
5 ms sampling, a 60-second profile window, a 10,000 ms capture threshold and
three profile files. The control worker prepares files and summaries; raw
profiles never cross back to the HTTP thread. Graceful shutdown waits for both
the compute pool and the inspector connection.

TR: [Doğrulandı] Önceki ana-thread profiler'ında gerçek 30k tanı koşusu bir
`Profiler.start` çağrısında 408,691 ms duvar ve 407,656 ms thread CPU süresi
kaydetti (`phase-5-openings-30k-native-trace-2`, tanı eklentili koşu). Kontrolü
worker'a taşımak tek başına 200 ms açılış kabulünü sağlamadı: normal
`phase-5-openings-30k-scout-4` koşusu başarısızdır ve korunmuştur. V8 hedef
isolate işi hâlâ ana thread'i etkileyebilir. Sürekli profilin varsayılan kapalı
olması tanı kapasitesiyle gecikme arasındaki bilinçli ödünleşimdir; sayısal
izleyici ve açıkça istenen profil özelliği korunur. Bu kayıt bir performans
kazanımı veya üç koşuluk kabul sonucu iddiası değildir.

EN: [Verified] An actual 30k diagnostic run of the earlier main-thread profiler
recorded 408.691 ms wall time and 407.656 ms thread CPU for `Profiler.start`
(`phase-5-openings-30k-native-trace-2`, instrumented diagnostic). Moving control
into a worker alone did not pass the 200 ms opening criterion: the normal
`phase-5-openings-30k-scout-4` failure is retained. V8 work in the target isolate
can still affect the main thread. Making continuous profiling opt-in is an
explicit diagnostic-versus-latency tradeoff; numeric monitoring and explicitly
requested profiles remain available. This note does not claim a measured gain
or a three-run acceptance result.

TR: Zamanlama raporunda normal ve tanı modları ayrı değerlendirilir. Başarısız
koşunun server.log, kısmi JSON ve oluşmuş profilleri korunur; yeniden refresh
POST'u gönderilmez. Tanı eklentili koşular normal kabul kohortuna katılmaz.
`phase-5-openings-30k-profiler-control-1` geçici aracının kapanış istisnası
nedeniyle kabul dışıdır; yanındaki qualification JSON bunu açıkça kaydeder.

EN: Timing comparisons distinguish normal and diagnostic modes. Failed runs
retain server.log, partial JSON and any generated profiles; refresh POSTs are
never retried. Instrumented diagnostics are excluded from normal acceptance
cohorts. The temporary shim in `phase-5-openings-30k-profiler-control-1` raised a
shutdown exception and is not acceptance evidence; its companion qualification
JSON records that exclusion.
