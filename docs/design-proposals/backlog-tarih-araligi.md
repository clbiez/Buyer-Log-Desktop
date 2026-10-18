# Backlog tarih aralığı seçenekleri / Backlog date range options

| Seçenek / Option | Kullanım / Use | Durum / Status |
| --- | --- | --- |
| **Kompakt tarih şeridi / Compact date strip** | Tablo ve grafiklerden ayrılmadan iki tutamağı sürükleyin; oklarla aralığı gün, hafta veya ay adımıyla taşıyın. / Drag two handles without leaving the report; shift the window by day, week or month with the arrows. | **Uygulandı / Implemented** |
| **Takvim çekmecesi / Calendar drawer** | İki aylık takvim, tek tıkla hafta satırı veya tam ay seçimi. Belirli günleri görerek seçmek için uygun. / Two calendar months with selectable week rows and whole months; useful when picking specific dates visually. | Alternatif öneri / Alternative proposal |
| **Sipariş yoğunluk rayı / Order density rail** | Aynı kaydırıcının altında dönemlere göre sipariş adedi sütunları; yoğun dönemleri görerek aralık seçimi. / Order-count bars beneath the same slider, helping users choose a window around busy periods. | İleri geliştirme önerisi / Future enhancement proposal |

## Uygulanan kullanım / Implemented interaction

1. **MB tarihi / Exfactory tarihi / Retail depo tarihi** seçin. Her alanın son uygulanan aralığı ayrı tutulur. / Select **MB date / Exfactory date / Retail warehouse date**. Each field retains its own applied range.
2. **Gün / Hafta / Ay** seçimi, kaydırıcının adımını ve okların taşıma birimini belirler. Haftalar pazartesi başlar; ay kaydırması takvim aylarını izler. / **Day / Week / Month** determines slider and arrow steps. Weeks start on Monday; month shifts follow calendar months.
3. Başlangıç ve bitişi sürükleyin veya tarih kutularına yazın. **Bu hafta / Bu ay / Önümüzdeki 30 gün** hazır dönemlerini kullanabilirsiniz. / Drag the start and end handles or type dates. **This week / This month / Next 30 days** presets are available.
4. **Uygula** raporu günceller; **Vazgeç** henüz uygulanmayan seçimleri geri alır. / **Apply** updates the report; **Cancel** discards pending selections.
5. Aktif filtreler şeridin altında görünür ve ayrı ayrı kaldırılabilir. Birden fazla tarih türü seçildiğinde koşullar birlikte uygulanır. / Applied filters appear below the strip and can be removed individually. Multiple date fields are combined with AND.

Başlangıç ve bitiş dahildir; tek tarafı boş bırakılan aralık sınırsızdır. MB, model bütçe tarihidir. Exfactory, kanonik güncel/revize yükleme tarihidir; IAS HANDOVER tarihi değildir. Retail, depo hedef tarihidir. Pivot, detay ve Excel aynı filtreleri kullanır. / Boundaries are inclusive; an empty boundary is unbounded. MB means model budget date. Exfactory uses the canonical current/revised shipment date, separate from IAS HANDOVER. Retail means the warehouse target date. Pivot, detail and Excel use the same filters.

Önerim: günlük kullanım için uygulanan kompakt şerit; sonraki adım olarak şeridin altına sipariş yoğunluğu eklenmesi. / Recommendation: use the implemented compact strip for daily work, then consider adding order density beneath it.
