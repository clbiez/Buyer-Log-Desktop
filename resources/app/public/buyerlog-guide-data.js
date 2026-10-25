/* Buyer Log guide: curated from current source; synthetic examples contain no business records. */
(function(root){'use strict';const data={
  "version": 1,
  "modules": [
    {
      "id": "general",
      "label": {
        "tr": "Genel kullanım",
        "en": "Getting started"
      },
      "area": null
    },
    {
      "id": "views",
      "label": {
        "tr": "Görünümler ve sütunlar",
        "en": "Views and columns"
      },
      "area": "cp"
    },
    {
      "id": "clipboard",
      "label": {
        "tr": "Kopyalama ve yapıştırma",
        "en": "Copy and paste"
      },
      "area": "koleksiyon"
    },
    {
      "id": "cp",
      "label": {
        "tr": "CP Tracker",
        "en": "CP Tracker"
      },
      "area": "cp"
    },
    {
      "id": "orders",
      "label": {
        "tr": "Siparişler",
        "en": "Orders"
      },
      "area": "orders"
    },
    {
      "id": "koleksiyon",
      "label": {
        "tr": "Koleksiyon",
        "en": "Collection"
      },
      "area": "koleksiyon"
    },
    {
      "id": "quotations",
      "label": {
        "tr": "Fiyat Masası",
        "en": "Pricing Desk"
      },
      "area": "quotations"
    },
    {
      "id": "pricinghistory",
      "label": {
        "tr": "Fiyat Masası › Geçmiş",
        "en": "Pricing Desk › History"
      },
      "area": "pricinghistory"
    },
    {
      "id": "priceanalysis",
      "label": {
        "tr": "Fiyat & Üretici Analizi",
        "en": "Price & Supplier Analysis"
      },
      "area": "priceanalysis"
    },
    {
      "id": "backlog",
      "label": {
        "tr": "Backlog",
        "en": "Backlog"
      },
      "area": "backlog"
    },
    {
      "id": "shipping",
      "label": {
        "tr": "Nakliye Kıyaslama",
        "en": "Shipping Comparison"
      },
      "area": "shipping"
    },
    {
      "id": "lfl",
      "label": {
        "tr": "LFL Analizi",
        "en": "LFL Analysis"
      },
      "area": "lfl"
    },
    {
      "id": "opencosting",
      "label": {
        "tr": "Ön Maliyet",
        "en": "Open Costing"
      },
      "area": "opencosting"
    },
    {
      "id": "overview",
      "label": {
        "tr": "Overview, OAB ve Intake",
        "en": "Overview, OAB and Intake"
      },
      "area": "overview"
    },
    {
      "id": "automations",
      "label": {
        "tr": "Otomasyonlar",
        "en": "Automations"
      },
      "area": "automations"
    },
    {
      "id": "source",
      "label": {
        "tr": "Veri Yönetimi",
        "en": "Data Management"
      },
      "area": "source"
    }
  ],
  "lessons": [
    {
      "id": "tools",
      "module": "general",
      "visual": "menu",
      "selector": "#cpToolsBtn",
      "title": {
        "tr": "Araçlar: önce kapsam, sonra işlem",
        "en": "Tools: select a scope first"
      },
      "summary": {
        "tr": "Araçlar menüsü bulunduğunuz ekrana göre değişir. Seçim isteyen işlemler, satır işaretlenene kadar soluk görünür.",
        "en": "Tools vary by screen. Actions that need a selection remain dimmed until you check rows."
      },
      "path": {
        "tr": "CP / Siparişler / Koleksiyon → Araçlar",
        "en": "CP / Orders / Collection → Tools"
      },
      "steps": {
        "tr": [
          "Çalışacağınız modülü açın.",
          "İşlem seçim gerektiriyorsa satır checkboxlarını işaretleyin.",
          "Araçlar menüsünden ilgili işlevi seçin."
        ],
        "en": [
          "Open the relevant module.",
          "Check row boxes if the action requires selected records.",
          "Choose the operation in Tools."
        ]
      },
      "note": {
        "tr": "Soluk düğme bir yükleme hatası olmayabilir; seçim ve yetkinizi kontrol edin.",
        "en": "A dimmed button may require a selection or permission."
      },
      "example": "Araçlar / Tools",
      "evidence": "public/app-main.js",
      "area": null,
      "areas": [
        "cp",
        "orders",
        "koleksiyon"
      ],
      "level": "basic"
    },
    {
      "id": "search",
      "module": "general",
      "visual": "search",
      "selector": "#cpSearch",
      "title": {
        "tr": "Aramada hangi alanlar taranır?",
        "en": "Which fields can you search?"
      },
      "summary": {
        "tr": "CP ve Siparişler araması PLM ID, model, üretici, lisans, renk ve sipariş kodu gibi alanları tarar. Arama kutusunun yanındaki i düğmesi kullanım örneklerini açar.",
        "en": "CP and Orders search includes PLM ID, model, manufacturer, license, colour and order code. The i button next to search opens examples."
      },
      "path": {
        "tr": "CP / Siparişler → Arama → i",
        "en": "CP / Orders → Search → i"
      },
      "steps": {
        "tr": [
          "Arama kutusuna bir model veya sipariş kodu yazın.",
          "Aramanın etkilediği satırları inceleyin.",
          "Arama kuralları için i düğmesini açın."
        ],
        "en": [
          "Enter a model or order code.",
          "Review the matching rows.",
          "Open i for search rules."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "PLM ID · Model · Order Code",
      "evidence": "public/table-search-help.js",
      "area": null,
      "areas": [
        "cp",
        "orders"
      ],
      "level": "basic"
    },
    {
      "id": "filters",
      "module": "general",
      "visual": "filter",
      "selector": "#cpActiveFilters",
      "title": {
        "tr": "Filtreler birlikte çalışır",
        "en": "Filters work together"
      },
      "summary": {
        "tr": "Arama, boyut filtreleri ve sütun filtreleri aynı anda sonucu daraltabilir. Aktif tablo filtreleri şeridi hangi filtrelerin açık olduğunu gösterir.",
        "en": "Search, dimension filters and column filters can narrow results together. The active table filters bar shows applied filters."
      },
      "path": {
        "tr": "CP / Siparişler / Koleksiyon → Tablo Filtreleri",
        "en": "CP / Orders / Collection → Table Filters"
      },
      "steps": {
        "tr": [
          "Sütun başlığındaki filtre düğmesini açın.",
          "İstediğiniz değerleri seçip Uygula ile onaylayın.",
          "Eksik satır görürseniz aktif filtreleri ve aramayı kontrol edin."
        ],
        "en": [
          "Open the filter in a column heading.",
          "Select values and confirm with Apply.",
          "Check active filters and search if expected rows are missing."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Season: W7 · Status: In production",
      "evidence": "public/app-main.js",
      "area": null,
      "areas": [
        "cp",
        "orders",
        "koleksiyon"
      ],
      "level": "basic"
    },
    {
      "id": "profiles",
      "module": "general",
      "visual": "menu",
      "selector": "#cpMoreBtn",
      "title": {
        "tr": "Görünüm ve filtre profilleri",
        "en": "View and filter profiles"
      },
      "summary": {
        "tr": "Sık kullandığınız sütun düzenlerini ve filtreleri adlandırarak kaydedebilirsiniz. Görünüm profili ile filtre profili ayrı seçimlerdir.",
        "en": "Save frequently used column layouts and filters by name. View profiles and filter profiles are separate choices."
      },
      "path": {
        "tr": "Tablo → ⋯ → Görünüm / Filtre",
        "en": "Table → ⋯ → View / Filter"
      },
      "steps": {
        "tr": [
          "Sütunları veya filtreleri ihtiyacınıza göre düzenleyin.",
          "İlgili Görünüm ya da Filtre menüsünden farklı kaydedin.",
          "Sonraki kullanımda kayıtlı profili seçin."
        ],
        "en": [
          "Arrange columns or filters.",
          "Use Save As in the corresponding View or Filter menu.",
          "Select the saved profile next time."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Görünüm / View · Filtre / Filter",
      "evidence": "public/app-main.js",
      "area": null,
      "areas": [
        "cp",
        "orders",
        "koleksiyon"
      ],
      "level": "basic"
    },
    {
      "id": "theme",
      "module": "general",
      "visual": "menu",
      "selector": "#railThemeBtn",
      "title": {
        "tr": "Dil, tema ve ekran yoğunluğu",
        "en": "Language, theme and interface size"
      },
      "summary": {
        "tr": "Sol alt bölümdeki kontrollerle dili, temayı ve arayüz ölçeğini çalışma düzeninize göre değiştirebilirsiniz.",
        "en": "Use the bottom of the left rail to change language, theme and interface size."
      },
      "path": {
        "tr": "Sol menü → alt bölüm",
        "en": "Left rail → bottom controls"
      },
      "steps": {
        "tr": [
          "Dil düğmesinden TR / EN seçimini değiştirin.",
          "Tema kontrolünden istediğiniz görünümü seçin.",
          "Arayüz ölçeğini ekranınıza göre ayarlayın."
        ],
        "en": [
          "Change TR / EN using the language control.",
          "Choose your theme.",
          "Adjust interface size for your display."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "TR / EN · Theme · Interface",
      "evidence": "public/app-main.js",
      "area": null,
      "areas": [],
      "level": "basic"
    },
    {
      "id": "guide",
      "module": "general",
      "visual": "menu",
      "selector": "#buyerLogGuideBtn",
      "title": {
        "tr": "Rehber her zaman elinizin altında",
        "en": "Keep the guide within reach"
      },
      "summary": {
        "tr": "Tüm kullanım ipuçları bu rehberde modül bazında bulunur. Başlık, özellik adı veya düğme adıyla arayabilirsiniz.",
        "en": "All how-to tips live in this guide, grouped by module. Search by topic, feature or button name."
      },
      "path": {
        "tr": "Üst çubuk → Kullanım Rehberi / F1",
        "en": "Top bar → User Guide / F1"
      },
      "steps": {
        "tr": [
          "Rehber düğmesini veya F1 tuşunu kullanın.",
          "Bir modül seçin ya da arama yapın.",
          "Adımları okuyup Ekrana Git ile ilgili modülü açın."
        ],
        "en": [
          "Open the guide button or press F1.",
          "Choose a module or search.",
          "Read the steps and use Go to Screen."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "F1 → Kullanım Rehberi / User Guide",
      "evidence": "public/buyerlog-guide.js",
      "area": null,
      "areas": [],
      "level": "basic"
    },
    {
      "id": "focus",
      "module": "views",
      "visual": "view",
      "selector": "#cpTableViewActions [data-bl-view-trigger]",
      "title": {
        "tr": "Focus: günlük işinize odaklanın",
        "en": "Focus: concentrate on daily work"
      },
      "summary": {
        "tr": "Focus / Odak, tabloda seçili bir sütun kümesini gösterir. CP, Siparişler ve Koleksiyon kendi sütun seçimlerini ayrı tutar.",
        "en": "Focus displays a selected set of columns. CP, Orders and Collection keep separate column choices."
      },
      "path": {
        "tr": "CP / Siparişler / Koleksiyon → Görünüm → Odak",
        "en": "CP / Orders / Collection → View → Focus"
      },
      "steps": {
        "tr": [
          "Odak düğmesine basın.",
          "Düğmeye çift tıklayarak görünecek sütunları seçin.",
          "Uygula ile seçiminizi kaydedin."
        ],
        "en": [
          "Select Focus.",
          "Double-click Focus to choose its columns.",
          "Save with Apply."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Focus / Odak",
      "evidence": "public/app-main.js",
      "area": "cp",
      "areas": [
        "cp",
        "orders",
        "koleksiyon"
      ],
      "level": "basic"
    },
    {
      "id": "extended",
      "module": "views",
      "visual": "view",
      "selector": "#cpTableViewActions [data-bl-view-trigger]",
      "title": {
        "tr": "Extended: daha fazla operasyonel ayrıntı",
        "en": "Extended: more operational detail"
      },
      "summary": {
        "tr": "Genişletilmiş görünüm Focus çevresindeki operasyonel sütunları da gösterir. Çift tıklayarak kendi sütun kümenizi oluşturabilirsiniz.",
        "en": "Extended adds operational columns around Focus. Double-click it to choose your own set."
      },
      "path": {
        "tr": "Tablo → Görünüm → Genişletilmiş",
        "en": "Table → View → Extended"
      },
      "steps": {
        "tr": [
          "Genişletilmiş düğmesine basın.",
          "Çift tıklayıp ihtiyaç duyduğunuz sütunları işaretleyin.",
          "Uygula ile kaydedin; ayar tabloya özeldir."
        ],
        "en": [
          "Select Extended.",
          "Double-click and check the columns you need.",
          "Apply; the setting belongs to that table."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Extended / Genişletilmiş",
      "evidence": "public/app-main.js",
      "area": "cp",
      "areas": [
        "cp",
        "orders",
        "koleksiyon"
      ],
      "level": "basic"
    },
    {
      "id": "all",
      "module": "views",
      "visual": "view",
      "selector": "#cpTableViewActions [data-bl-view-trigger]",
      "title": {
        "tr": "All: eksik sütunu bulun",
        "en": "All: find a missing column"
      },
      "summary": {
        "tr": "Tümü görünümü tablonun tüm sütunlarını gösterir. Odak görünümünde bulamadığınız bir alanı burada kontrol edebilirsiniz.",
        "en": "All shows all columns of the table. Use it to locate a field missing from Focus."
      },
      "path": {
        "tr": "Tablo → Görünüm → Tümü",
        "en": "Table → View → All"
      },
      "steps": {
        "tr": [
          "Tümü düğmesini seçin.",
          "Aradığınız sütunu yatay kaydırarak bulun.",
          "Günlük kullanım için yeniden Odak veya Genişletilmiş seçin."
        ],
        "en": [
          "Select All.",
          "Scroll horizontally to find the column.",
          "Return to Focus or Extended for daily work."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Focus → Extended → All",
      "evidence": "public/app-main.js",
      "area": "cp",
      "areas": [
        "cp",
        "orders",
        "koleksiyon"
      ],
      "level": "basic"
    },
    {
      "id": "partial",
      "module": "views",
      "visual": "partial",
      "selector": "[data-partial-view-toggle=\"cp\"]",
      "title": {
        "tr": "Partial View: durumları ayrı satırlarda görün",
        "en": "Partial View: split status rows"
      },
      "summary": {
        "tr": "CP ve Siparişler’de Partial View lojistik durum etiketlerini ayrı satırlarda gösterir. Focus / Extended / All sütun seçiminiz korunur.",
        "en": "In CP and Orders, Partial View shows logistics status labels on separate rows. Your column preset stays the same."
      },
      "path": {
        "tr": "CP / Siparişler → Görünüm → Partial View",
        "en": "CP / Orders → View → Partial View"
      },
      "steps": {
        "tr": [
          "Birden fazla lojistik durumu olan kaydı bulun.",
          "Partial View düğmesini açın.",
          "Kapatmak için aynı düğmeye yeniden basın."
        ],
        "en": [
          "Find a record with multiple logistics statuses.",
          "Enable Partial View.",
          "Press it again to return."
        ]
      },
      "note": {
        "tr": "Bu bir sunum değişikliğidir; yeni sipariş kaydı oluşturmaz.",
        "en": "This changes presentation; it does not create new orders."
      },
      "example": "Order → In transit / Customs",
      "evidence": "public/app-main.js",
      "area": "cp",
      "areas": [
        "cp",
        "orders"
      ],
      "level": "basic"
    },
    {
      "id": "columns",
      "module": "views",
      "visual": "column",
      "selector": "#cpTableViewActions [data-bl-view-trigger]",
      "title": {
        "tr": "Alanlar: sütunları gösterin, sıralayın, adlandırın",
        "en": "Fields: show, order and name columns"
      },
      "summary": {
        "tr": "Alanlar çekmecesi ana başlıkları ve altındaki sütunları tek yerde yönetir: hangi sütunun Odak, Genişletilmiş veya Tümü görünümünde yer alacağını tikleyin, sürükleyerek sıralayın, adını ve formülünü düzenleyin, yeni sütun ekleyin. Odak veya Genişletilmiş düğmesine çift tıklamak da aynı çekmeceyi açar.",
        "en": "The Fields drawer manages headings and their columns in one place: tick which views (Focus, Extended, All) a column appears in, drag to reorder, edit its name and formula and add new columns. Double-clicking Focus or Extended opens the same drawer."
      },
      "path": {
        "tr": "Tablo → Görünüm → Alanlar",
        "en": "Table → View → Fields"
      },
      "steps": {
        "tr": [
          "Alanlar düğmesine basın veya Odak / Genişletilmiş düğmesine çift tıklayın.",
          "Bir ana başlığı açın ve sütunların görünüm tiklerini seçin.",
          "Sütunu sürükleyerek başlık içinde sıralayın; kalem ile adını, fx ile formülünü düzenleyin."
        ],
        "en": [
          "Press Fields or double-click Focus / Extended.",
          "Open a heading and tick the views for each column.",
          "Drag a column to reorder it within its heading; use the pencil for its name and fx for its formula."
        ]
      },
      "note": {
        "tr": "Başlıktaki Odak / Tümü / Gizli düğmesi görünüm tanımlarını değiştirmeden başlığı geçici olarak açar veya kapatır.",
        "en": "The Focus / All / Hidden button on a heading opens or closes it without changing the view definitions."
      },
      "example": "Marka Detayları · Buyer ☑ Odak ☑ Tümü",
      "evidence": "public/app-main.js",
      "area": "cp",
      "areas": [
        "cp",
        "orders",
        "koleksiyon"
      ],
      "level": "basic"
    },
    {
      "id": "resize",
      "module": "views",
      "visual": "column",
      "selector": "#cpTable",
      "title": {
        "tr": "Sütun genişliği ve gizleme",
        "en": "Resize and hide columns"
      },
      "summary": {
        "tr": "Tablo başlıklarının kenarları sütun genişliğini ayarlamak içindir. Başlığa sağ tıklayarak sütun görünürlüğünü yönetebilirsiniz.",
        "en": "Drag column-heading edges to resize. Right-click a heading to manage visibility."
      },
      "path": {
        "tr": "Tablo → sütun başlığı",
        "en": "Table → column heading"
      },
      "steps": {
        "tr": [
          "Başlığın sağ kenarına gelin.",
          "Kenarı sürükleyerek genişliği ayarlayın.",
          "Görünürlük için başlığa sağ tıklayın."
        ],
        "en": [
          "Move to the heading edge.",
          "Drag to resize the column.",
          "Right-click the heading to manage visibility."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Model ┃ ← genişlik / width →",
      "evidence": "public/app-main.js",
      "area": "cp",
      "areas": [
        "cp",
        "orders",
        "koleksiyon"
      ],
      "level": "basic"
    },
    {
      "id": "database-column",
      "module": "views",
      "visual": "column",
      "selector": "#cpMoreBtn",
      "title": {
        "tr": "Add Column: kaynaktan alan ekleyin",
        "en": "Add Column: add a source field"
      },
      "summary": {
        "tr": "CP ve Siparişler’de Sütun Ekle, ASAS veya IAS bağlantısından bir kaynak sütunu seçtirir. Tanım iki tabloyla paylaşılır ve yönetim yetkisi gerektirebilir.",
        "en": "In CP and Orders, Add Column selects a source field from an ASAS or IAS connection. The definition is shared by both tables and may require management permission."
      },
      "path": {
        "tr": "CP / Siparişler → ⋯ → Sütun Ekle",
        "en": "CP / Orders → ⋯ → Add Column"
      },
      "steps": {
        "tr": [
          "TR / EN sütun başlığını yazın.",
          "Veri bağlantısını seçip tablo veya sütun adıyla arayın.",
          "Kaynak sütunu seçip Sütunu Kaydet’e basın."
        ],
        "en": [
          "Enter TR / EN headings.",
          "Choose a connection and search table or column names.",
          "Select the field and Save Column."
        ]
      },
      "note": {
        "tr": "Koleksiyon’daki Sütun Ekle ise boş bir serbest metin sütunu oluşturur.",
        "en": "Add Column in Collection creates an empty free-text column."
      },
      "example": "ASAS / IAS → Source field → CP + Orders",
      "evidence": "public/app-main.js",
      "area": "cp",
      "areas": [
        "cp",
        "orders"
      ],
      "level": "basic"
    },
    {
      "id": "calculated",
      "module": "views",
      "visual": "formula",
      "selector": "#cpMoreBtn",
      "title": {
        "tr": "Add Calculated Column: kişisel hesaplama",
        "en": "Add Calculated Column: personal calculations"
      },
      "summary": {
        "tr": "CP, Siparişler ve Nakliye Kıyaslama’da hesaplanan sütunlar mevcut satırın değerlerinden sonuç üretir. Gün farkı, yüzde, birleştirme ve koşullu metin için hazır seçenekler bulunur.",
        "en": "In CP, Orders and Shipping Comparison, calculated columns derive results from the current row. Recipes include date differences, percentages, joins and conditional labels."
      },
      "path": {
        "tr": "CP / Siparişler → ⋯ → Hesaplanan Sütun Ekle; Nakliye → Sütunlar → Hesaplanan Sütun",
        "en": "CP / Orders → ⋯ → Add Calculated Column; Shipping → Columns → Calculated Column"
      },
      "steps": {
        "tr": [
          "Hesaplama türünü seçin.",
          "Kaynak alanları seçip önizlemeyi inceleyin.",
          "TR / EN başlığı ve biçimi belirleyip kaydedin."
        ],
        "en": [
          "Choose the calculation type.",
          "Select source fields and review the preview.",
          "Set TR / EN headings and format, then save."
        ]
      },
      "note": {
        "tr": "Kişisel hesaplanan sütun kaynak veriyi değiştirmez.",
        "en": "Personal calculated columns do not change source data."
      },
      "example": "[Retail Date] - [Ex-factory]",
      "evidence": "public/formula-columns.js",
      "area": "cp",
      "areas": [
        "cp",
        "orders",
        "shipping"
      ],
      "level": "basic"
    },
    {
      "id": "formula-rules",
      "module": "views",
      "visual": "formula",
      "selector": "#cpMoreBtn",
      "title": {
        "tr": "Formül yazarken temel kurallar",
        "en": "Formula basics"
      },
      "summary": {
        "tr": "Sütun adları [köşeli parantez] içinde, metinler çift tırnak içinde yazılır. Formül yalnız aynı satırı hesaplar; Excel hücre adresleri kullanılmaz.",
        "en": "Put column names in [brackets] and text in double quotes. A formula works only with the same row, without Excel cell addresses."
      },
      "path": {
        "tr": "Hesaplanan Sütun → Gelişmiş → Sözlük",
        "en": "Calculated Column → Advanced → Dictionary"
      },
      "steps": {
        "tr": [
          "Başta = kullanmadan formülü yazın.",
          "Ondalık için nokta, argümanlar için virgül veya noktalı virgül kullanın.",
          "Sözlükte desteklenen işlevleri ve önizlemeyi kontrol edin."
        ],
        "en": [
          "Write the formula without a leading =.",
          "Use a dot for decimals and comma or semicolon between arguments.",
          "Check supported functions in the dictionary and review the preview."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "IF([Status]=\"Late\", \"Check\", \"OK\")",
      "evidence": "public/formula-columns.js",
      "area": "cp",
      "areas": [
        "cp",
        "orders",
        "shipping"
      ],
      "level": "basic"
    },
    {
      "id": "formula-blanks",
      "module": "views",
      "visual": "formula",
      "selector": "#cpMoreBtn",
      "title": {
        "tr": "Boş hücre ve sıfıra bölme",
        "en": "Blank cells and division by zero"
      },
      "summary": {
        "tr": "Boş hücre otomatik olarak sıfır sayılmaz. Boşlar için ISBLANK / COALESCE, hesaplama hataları için IFERROR kullanabilirsiniz.",
        "en": "Blanks are not automatically zero. Use ISBLANK / COALESCE for blanks and IFERROR for calculation errors."
      },
      "path": {
        "tr": "Hesaplanan Sütun → Gelişmiş",
        "en": "Calculated Column → Advanced"
      },
      "steps": {
        "tr": [
          "Boş değerlerin nasıl ele alınacağını belirleyin.",
          "Gerekiyorsa COALESCE ile varsayılan verin.",
          "Bölme hatasını IFERROR ile yakalayıp önizlemeyi kontrol edin."
        ],
        "en": [
          "Decide how to handle missing values.",
          "Use COALESCE for a fallback if needed.",
          "Catch division errors with IFERROR and check the preview."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "IFERROR([A] / [B], 0)",
      "evidence": "public/formula-columns.js",
      "area": "cp",
      "areas": [
        "cp",
        "orders",
        "shipping"
      ],
      "level": "basic"
    },
    {
      "id": "formula-ai",
      "module": "views",
      "visual": "formula",
      "selector": "#cpMoreBtn",
      "title": {
        "tr": "AI ile formül önerisi alın",
        "en": "Get a formula suggestion with AI"
      },
      "summary": {
        "tr": "Hesaplanan Sütun penceresindeki AI ile yaz sekmesi, isteğinizi formüle dönüştürme ve cevabı Buyer Log içinde denetleme akışı sunar.",
        "en": "Write with AI in the calculated-column dialog helps turn a request into a formula and validate the answer in Buyer Log."
      },
      "path": {
        "tr": "Hesaplanan Sütun → AI ile yaz",
        "en": "Calculated Column → Write with AI"
      },
      "steps": {
        "tr": [
          "Hangi satır alanlarıyla ne hesaplamak istediğinizi yazın.",
          "Ekrandaki yönlendirmeyi izleyip formül cevabını içeri alın.",
          "Denetim ve önizleme sonucunu kontrol edip kaydedin."
        ],
        "en": [
          "Describe the calculation using row fields.",
          "Follow the dialog instructions to obtain and import a formula.",
          "Check validation and preview before saving."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "AI → Formula → Preview",
      "evidence": "public/formula-columns.js",
      "area": "cp",
      "areas": [
        "cp",
        "orders",
        "shipping"
      ],
      "level": "basic"
    },
    {
      "id": "copy-rows",
      "module": "clipboard",
      "visual": "grid",
      "selector": "#kolCopySelectedBtn",
      "title": {
        "tr": "Satır kopyası ile hücre kopyası farklıdır",
        "en": "Row copy and cell copy are different"
      },
      "summary": {
        "tr": "Checkboxlarla seçilen modeller satır kopyasının kapsamını belirler. Koleksiyon’da hücre alanı seçimi ise seçili hücre bloğunu kopyalamak içindir.",
        "en": "Checked models define the row-copy scope. In Collection, a selected cell range is used for copying a cell block."
      },
      "path": {
        "tr": "Koleksiyon → checkbox / hücre alanı → Kopyala",
        "en": "Collection → row boxes / cell range → Copy"
      },
      "steps": {
        "tr": [
          "Tam model satırları için checkboxları işaretleyin.",
          "Satır Kopyala düğmesini kullanın.",
          "Yalnız hücreler için alanı seçip Ctrl+C kullanın."
        ],
        "en": [
          "Check boxes for complete model rows.",
          "Use the row Copy button.",
          "For cells only, select a range and press Ctrl+C."
        ]
      },
      "note": {
        "tr": "Checkbox seçimi varsa Ctrl+C satır seçimine öncelik verebilir; yalnız hücre alanı için satır seçimlerini temizleyin.",
        "en": "Ctrl+C may prioritise checked rows; clear row boxes when you want only a cell range."
      },
      "example": "☑ Rows → Copy / Range → Ctrl+C",
      "evidence": "public/collection-spreadsheet.js",
      "area": "koleksiyon",
      "areas": [
        "koleksiyon"
      ],
      "level": "basic"
    },
    {
      "id": "copy-format",
      "module": "clipboard",
      "visual": "grid",
      "selector": "#kolCopySelectedBtn",
      "title": {
        "tr": "Excel’e başlıklarıyla kopyalama",
        "en": "Copy to Excel with headings"
      },
      "summary": {
        "tr": "Satır kopyası başlıkları ve biçimleri taşır. Görsel mevcutsa aynı kayıt satırındaki hücreye eklenir; eksik görsel kopyalamayı durdurmaz.",
        "en": "Row copy carries headings and formatting. Available images remain in the same record row; missing images do not stop the copy."
      },
      "path": {
        "tr": "Koleksiyon → Kopyala → Excel",
        "en": "Collection → Copy → Excel"
      },
      "steps": {
        "tr": [
          "İstediğiniz model satırlarını işaretleyin.",
          "Kopyala düğmesine basın.",
          "Excel’de başlangıç hücresine yapıştırın; satır ve başlıkları kontrol edin."
        ],
        "en": [
          "Check the required model rows.",
          "Press Copy.",
          "Paste at the starting cell in Excel and check rows and headings."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Model | Status | FOB → Excel",
      "evidence": "public/app-main.js",
      "area": "koleksiyon",
      "areas": [
        "koleksiyon"
      ],
      "level": "basic"
    },
    {
      "id": "paste",
      "module": "clipboard",
      "visual": "grid",
      "selector": "#kolSpreadsheetPasteBtn",
      "title": {
        "tr": "Excel bloğunu aktif hücreden yapıştırın",
        "en": "Paste an Excel block from the active cell"
      },
      "summary": {
        "tr": "Koleksiyon’da tab ile ayrılmış Excel verisi aktif hücreden başlayarak görünür sütunlara dağıtılır. Düzenlenemeyen alanlar yazmaya açılmaz.",
        "en": "In Collection, tab-separated Excel data is placed into visible columns starting at the active cell. Read-only fields stay protected."
      },
      "path": {
        "tr": "Koleksiyon → başlangıç hücresi → Ctrl+V",
        "en": "Collection → starting cell → Ctrl+V"
      },
      "steps": {
        "tr": [
          "Excel’de yalnız gerekli veri bloğunu kopyalayın.",
          "Koleksiyon’da doğru başlangıç hücresini ve sütun sırasını seçin.",
          "Ctrl+V sonrası aktarım önizlemesini kontrol edip onaylayın."
        ],
        "en": [
          "Copy the required data block in Excel.",
          "Choose the correct starting cell and column order in Collection.",
          "After Ctrl+V, review and confirm the paste preview."
        ]
      },
      "note": {
        "tr": "Bir hücre editöründeki düz metin yapıştırma ile çok sütunlu Excel bloğu farklı işlenir.",
        "en": "Plain text in a cell editor is handled differently from a multi-column Excel block."
      },
      "example": "Excel 2×3 → Active cell → 2×3",
      "evidence": "public/collection-spreadsheet.js",
      "area": "koleksiyon",
      "areas": [
        "koleksiyon"
      ],
      "level": "basic"
    },
    {
      "id": "cell-selection",
      "module": "clipboard",
      "visual": "grid",
      "selector": "#kolTable",
      "title": {
        "tr": "Hücre alanı seçimi ve klavye",
        "en": "Cell ranges and keyboard navigation"
      },
      "summary": {
        "tr": "Koleksiyon tablosunda Shift ile alan genişletebilir, Ctrl ile ayrı hücreler seçebilirsiniz. Durum çubuğu sayısal seçim için toplam ve ortalamayı gösterir.",
        "en": "In Collection, use Shift to extend a range and Ctrl for separate cells. The status bar shows sum and average for numeric selections."
      },
      "path": {
        "tr": "Koleksiyon → hücre alanı",
        "en": "Collection → cell range"
      },
      "steps": {
        "tr": [
          "Bir başlangıç hücresi seçin.",
          "Shift ile bitiş hücresini seçin veya Ctrl ile ayrı hücreler ekleyin.",
          "Durum çubuğunda alan, adet, toplam ve ortalamayı inceleyin."
        ],
        "en": [
          "Select a starting cell.",
          "Use Shift for the end cell or Ctrl to add separate cells.",
          "Review range, count, sum and average in the status bar."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Range 2×3 · Count · Sum · Average",
      "evidence": "public/collection-spreadsheet.js",
      "area": "koleksiyon",
      "areas": [
        "koleksiyon"
      ],
      "level": "basic"
    },
    {
      "id": "undo",
      "module": "clipboard",
      "visual": "grid",
      "selector": "#kolUndoBtn",
      "title": {
        "tr": "Koleksiyon’da geri al ve ileri al",
        "en": "Undo and redo in Collection"
      },
      "summary": {
        "tr": "Koleksiyon’daki düzenlemeler için Geri ve İleri düğmeleri bulunur. Düğmenin etkinliği mevcut işlem geçmişine bağlıdır.",
        "en": "Collection has Undo and Redo controls. Availability depends on the current edit history."
      },
      "path": {
        "tr": "Koleksiyon → Geri / İleri",
        "en": "Collection → Undo / Redo"
      },
      "steps": {
        "tr": [
          "Değişiklikten sonra Geri düğmesini veya Ctrl+Z kullanın.",
          "Geri alınan işlemi İleri veya Ctrl+Y ile yeniden uygulayın.",
          "Hücre editörünün kendi metin geçmişiyle tablo geçmişini karıştırmayın."
        ],
        "en": [
          "Use Undo or Ctrl+Z after an edit.",
          "Use Redo or Ctrl+Y to reapply it.",
          "Distinguish a text editor’s history from table history."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Ctrl+Z ← Edit → Ctrl+Y",
      "evidence": "public/app-main.js",
      "area": "koleksiyon",
      "areas": [
        "koleksiyon"
      ],
      "level": "basic"
    },
    {
      "id": "cp-dates",
      "module": "cp",
      "visual": "table",
      "selector": "#cpTable",
      "title": {
        "tr": "CP Tracker: üretim ve termin takibi",
        "en": "CP Tracker: production and due dates"
      },
      "summary": {
        "tr": "CP, model ve siparişlerin üretim / teslim tarihlerini birlikte incelemenizi sağlar. Kaynak alanları ile düzenlenebilir alanları ayırt ederek çalışın.",
        "en": "CP brings model and order production and delivery dates together. Distinguish source fields from editable fields."
      },
      "path": {
        "tr": "CP Tracker → tarih sütunları",
        "en": "CP Tracker → date columns"
      },
      "steps": {
        "tr": [
          "Model veya sipariş koduyla kaydı bulun.",
          "Ex-factory ve Retail Date gibi termin alanlarını inceleyin.",
          "Yalnız düzenleme yetkiniz olan alanlarda değişiklik yapın."
        ],
        "en": [
          "Find the record by model or order code.",
          "Review due-date fields such as Ex-factory and Retail Date.",
          "Edit only fields you are authorised to change."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Ex-factory → Retail Date",
      "evidence": "public/app-main.js",
      "area": "cp",
      "areas": [
        "cp"
      ],
      "level": "module"
    },
    {
      "id": "cp-capacity",
      "module": "cp",
      "visual": "menu",
      "selector": "#cpCapacityRequestBtn",
      "title": {
        "tr": "Capacity Request Excel",
        "en": "Capacity Request Excel"
      },
      "summary": {
        "tr": "Capacity Request seçime dayalı bir dışa aktarımdır. İstediğiniz kayıtları seçerek talep formatında Excel oluşturabilirsiniz.",
        "en": "Capacity Request is a selection-based export. Check records to create an Excel file in the request format."
      },
      "path": {
        "tr": "CP Tracker → Araçlar → Capacity Request Excel Oluştur",
        "en": "CP Tracker → Tools → Create Capacity Request Excel"
      },
      "steps": {
        "tr": [
          "CP’de gerekli satırları işaretleyin.",
          "Araçlar menüsündeki Capacity Request işlemini seçin.",
          "Oluşan Excel’de kayıt kapsamını kontrol edin."
        ],
        "en": [
          "Check the required CP rows.",
          "Select Capacity Request in Tools.",
          "Check the record scope in the resulting Excel file."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "☑ Selected → Capacity Request.xlsx",
      "evidence": "public/app-main.js",
      "area": "cp",
      "areas": [
        "cp"
      ],
      "level": "module"
    },
    {
      "id": "cp-import",
      "module": "cp",
      "visual": "column",
      "selector": "#cpExcelImportBtn",
      "title": {
        "tr": "Kendi Excel’inizi alanlara eşleyin",
        "en": "Map your own Excel columns"
      },
      "summary": {
        "tr": "Kullanıcı Excelini İçeri Aktar, dosyanızdaki sütunları CP alanlarıyla eşleyerek aktarım hazırlamanızı sağlar.",
        "en": "Import Your Excel helps map workbook columns onto CP fields before import."
      },
      "path": {
        "tr": "CP Tracker → Araçlar → Kullanıcı Excelini İçeri Aktar",
        "en": "CP Tracker → Tools → Import Your Excel"
      },
      "steps": {
        "tr": [
          "Excel dosyanızı seçin.",
          "Dosya başlıklarını hedef CP alanlarına eşleyin.",
          "Aktarım önizlemesini ve eşleşmeleri kontrol edip onaylayın."
        ],
        "en": [
          "Select the workbook.",
          "Map its headings onto target CP fields.",
          "Review matches and the import preview, then confirm."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Your Excel → Field mapping → Preview",
      "evidence": "public/index.html",
      "area": "cp",
      "areas": [
        "cp"
      ],
      "level": "module"
    },
    {
      "id": "plm-cp",
      "module": "cp",
      "visual": "menu",
      "selector": "#cpPlmSyncBtn",
      "title": {
        "tr": "CP’de PLM ve ASAS senkronizasyonu",
        "en": "PLM and ASAS sync in CP"
      },
      "summary": {
        "tr": "PLM SYNC menüsü PLM, ASAS ve Operasyon Merkezi yollarını sunar. CP / Siparişler görsel ve model bağlantısı akışı Koleksiyon’daki alan güncellemesinden farklıdır.",
        "en": "PLM SYNC offers PLM, ASAS and Operations Center actions. CP / Orders image and model-link sync differs from Collection field updates."
      },
      "path": {
        "tr": "CP Tracker → PLM SYNC",
        "en": "CP Tracker → PLM SYNC"
      },
      "steps": {
        "tr": [
          "İlgili kayıtları seçin.",
          "PLM SYNC menüsünü açıp doğru kaynağı seçin.",
          "İşlem penceresinde kapsamı ve sonuçları kontrol edin."
        ],
        "en": [
          "Select relevant records.",
          "Open PLM SYNC and choose the correct source.",
          "Review scope and results in the operation dialog."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "PLM / ASAS / Operations Center",
      "evidence": "public/app-main.js",
      "area": "cp",
      "areas": [
        "cp"
      ],
      "level": "module"
    },
    {
      "id": "orders",
      "module": "orders",
      "visual": "table",
      "selector": "#ordersTable",
      "title": {
        "tr": "Siparişler ekranını daraltın",
        "en": "Narrow the Orders screen"
      },
      "summary": {
        "tr": "Siparişler’de arama, sütun filtreleri ve Partial View birlikte kullanılabilir. Büyük kapsamı bir sipariş koduyla daraltarak ayrıntıları okuyabilirsiniz.",
        "en": "Orders combines search, column filters and Partial View. Narrow a large scope by order code to inspect detail."
      },
      "path": {
        "tr": "Siparişler → Arama / Görünüm",
        "en": "Orders → Search / View"
      },
      "steps": {
        "tr": [
          "Sipariş kodunu arayın.",
          "Gerekirse sütun filtresiyle kapsamı daraltın.",
          "Parçalı durumları okumak için Partial View açın."
        ],
        "en": [
          "Search an order code.",
          "Narrow the scope with a column filter if needed.",
          "Enable Partial View to read split statuses."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Order Code → Status → Partial View",
      "evidence": "public/app-main.js",
      "area": "orders",
      "areas": [
        "orders"
      ],
      "level": "module"
    },
    {
      "id": "orders-endeksmatik",
      "module": "orders",
      "visual": "formula",
      "selector": "#ordersEndeksmatikBtn",
      "title": {
        "tr": "Sipariş için Endeksmatik",
        "en": "Endeksmatik for an order"
      },
      "summary": {
        "tr": "Siparişler Araçlar menüsündeki Endeksmatik işlemi, seçili siparişin bir yıl sonraki fiyatını hesaplama akışını açar.",
        "en": "Endeksmatik in Orders Tools opens the workflow for estimating the selected order’s price one year later."
      },
      "path": {
        "tr": "Siparişler → Araçlar → Endeksmatik",
        "en": "Orders → Tools → Endeksmatik"
      },
      "steps": {
        "tr": [
          "Bir sipariş seçin.",
          "Araçlar menüsünden Endeksmatik açın.",
          "Hesapta kullanılan seti ve sonucu inceleyin."
        ],
        "en": [
          "Select an order.",
          "Open Endeksmatik from Tools.",
          "Review the set and calculation result."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Selected order → +1 year price",
      "evidence": "public/app-main.js",
      "area": "orders",
      "areas": [
        "orders"
      ],
      "level": "module"
    },
    {
      "id": "new-model",
      "module": "koleksiyon",
      "visual": "table",
      "selector": "#kolPlmSyncBtn",
      "title": {
        "tr": "Aynı modeli farklı Model Bütçe Ayına ekleme",
        "en": "Add the same model for another Model Budget Month"
      },
      "summary": {
        "tr": "PLM aktarımında mevcut model bulunursa Yeni olarak ekle / Add as a New ikinci, bağımsız bir Koleksiyon kaydı oluşturur. Bu seçim farklı Model Bütçe dönemleri için kullanılır.",
        "en": "When PLM import finds an existing model, Add as a New creates a second independent Collection record. Use this for different Model Budget periods."
      },
      "path": {
        "tr": "Koleksiyon → PLM SYNC → model aktarımı → mevcut model kararı",
        "en": "Collection → PLM SYNC → model import → existing-model decision"
      },
      "steps": {
        "tr": [
          "PLM model aktarımında kapsamı hazırlayın.",
          "Mevcut model kararında Yeni olarak ekle seçeneğini değerlendirin.",
          "Yeni kaydın Model Bütçe Ayını kontrol edin; güncelleme seçimiyle karıştırmayın."
        ],
        "en": [
          "Prepare the PLM model import scope.",
          "Review Add as a New in the existing-model decision.",
          "Check the new record’s Model Budget Month; distinguish it from Update."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Same model → Different Model Budget Month",
      "evidence": "public/app-main.js",
      "area": "koleksiyon",
      "areas": [
        "koleksiyon"
      ],
      "level": "module"
    },
    {
      "id": "variants",
      "module": "koleksiyon",
      "visual": "partial",
      "selector": "#kolAllVariantsToggle",
      "title": {
        "tr": "Ana renk ve alt renk görünümü",
        "en": "Main colours and colour variants"
      },
      "summary": {
        "tr": "Ana model oku o grubun alt renklerini açar. Görünüm düğmelerinin sağındaki simge tüm alt renkleri topluca gösterir veya gizler.",
        "en": "The main-model arrow expands that group’s variants. The icon to the right of View controls shows or hides all variants."
      },
      "path": {
        "tr": "Koleksiyon → model oku / toplu alt renk simgesi",
        "en": "Collection → model arrow / all variants icon"
      },
      "steps": {
        "tr": [
          "Model başındaki oku açın.",
          "İlgili alt renk satırlarını inceleyin.",
          "Tüm gruplar için görünüm yanındaki toplu simgeyi kullanın."
        ],
        "en": [
          "Expand the model arrow.",
          "Review its colour variants.",
          "Use the all-variants icon for every group."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Model ▾ → Main colour / Variant",
      "evidence": "public/app-main.js",
      "area": "koleksiyon",
      "areas": [
        "koleksiyon"
      ],
      "level": "module"
    },
    {
      "id": "custom-column",
      "module": "koleksiyon",
      "visual": "column",
      "selector": "#kolMoreBtn",
      "title": {
        "tr": "Koleksiyon’a serbest metin sütunu",
        "en": "Add a free-text Collection column"
      },
      "summary": {
        "tr": "Koleksiyon’daki Sütun Ekle boş bir özel sütun oluşturur. TR ve EN başlıkları vererek kendi takip alanınızı ekleyebilirsiniz.",
        "en": "Add Column in Collection creates an empty custom field. Give it TR and EN headings for your own tracking."
      },
      "path": {
        "tr": "Koleksiyon → ⋯ → Sütun Ekle",
        "en": "Collection → ⋯ → Add Column"
      },
      "steps": {
        "tr": [
          "Sütun Ekle’yi açın.",
          "Benzersiz TR / EN başlıklarını yazın.",
          "Yeni sütuna takip metinlerinizi girin."
        ],
        "en": [
          "Open Add Column.",
          "Enter unique TR / EN headings.",
          "Enter your tracking text in the new field."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Sample follow-up · Personal notes",
      "evidence": "public/app-main.js",
      "area": "koleksiyon",
      "areas": [
        "koleksiyon"
      ],
      "level": "module"
    },
    {
      "id": "pricing-send",
      "module": "koleksiyon",
      "visual": "menu",
      "selector": "#kolSendPricingBtn",
      "title": {
        "tr": "Modelleri fiyatlamaya gönderin",
        "en": "Send models to pricing"
      },
      "summary": {
        "tr": "Seçili modelleri Araçlar → Fiyatlamaya Gönder ile fiyat çalışma akışına taşıyabilirsiniz. Üretici ve e-posta kapsamını işlem penceresinde belirlersiniz.",
        "en": "Use Tools → Send to Pricing for selected models. Set manufacturer and email scope in the operation dialog."
      },
      "path": {
        "tr": "Koleksiyon → Araçlar → Fiyatlamaya Gönder",
        "en": "Collection → Tools → Send to Pricing"
      },
      "steps": {
        "tr": [
          "Fiyat istenecek modelleri işaretleyin.",
          "Fiyatlamaya Gönder’i açın.",
          "Üretici, içerik ve ekleri kontrol edip işlemi onaylayın."
        ],
        "en": [
          "Check models needing prices.",
          "Open Send to Pricing.",
          "Review manufacturers, content and attachments before confirming."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "☑ Models → Suppliers → Quotation",
      "evidence": "public/app-main.js",
      "area": "koleksiyon",
      "areas": [
        "koleksiyon"
      ],
      "level": "module"
    },
    {
      "id": "shipping-send",
      "module": "koleksiyon",
      "visual": "menu",
      "selector": "#kolSendShippingBtn",
      "title": {
        "tr": "Nakliye kıyaslamasına model aktarın",
        "en": "Send models to Shipping Comparison"
      },
      "summary": {
        "tr": "Koleksiyon’daki seçili modelleri Araçlar menüsünden Nakliye Kıyaslama’ya gönderebilirsiniz.",
        "en": "Send selected Collection models to Shipping Comparison from Tools."
      },
      "path": {
        "tr": "Koleksiyon → Araçlar → Nakliye Kıyaslamaya Gönder",
        "en": "Collection → Tools → Send to Shipping Comparison"
      },
      "steps": {
        "tr": [
          "Karşılaştıracağınız modelleri seçin.",
          "Nakliye Kıyaslamaya Gönder’i kullanın.",
          "Hedef ekranda fiyat ve taşıma girdilerini inceleyin."
        ],
        "en": [
          "Select models to compare.",
          "Use Send to Shipping Comparison.",
          "Review price and freight inputs in the target screen."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Collection → Shipping Comparison",
      "evidence": "public/app-main.js",
      "area": "koleksiyon",
      "areas": [
        "koleksiyon"
      ],
      "level": "module"
    },
    {
      "id": "status-manage",
      "module": "koleksiyon",
      "visual": "menu",
      "selector": "#kolManageStatusesBtn",
      "title": {
        "tr": "Status etiketleri ve renkleri",
        "en": "Status labels and colours"
      },
      "summary": {
        "tr": "Araçlar → Statusları Yönet, Koleksiyon durumlarını ve renklerini düzenler. Etiket seçimini ve renk karşılığını aynı yerden yönetirsiniz.",
        "en": "Tools → Manage Statuses edits Collection status labels and colours in one place."
      },
      "path": {
        "tr": "Koleksiyon → Araçlar → Statusları Yönet",
        "en": "Collection → Tools → Manage Statuses"
      },
      "steps": {
        "tr": [
          "Statusları Yönet’i açın.",
          "Etiket ve renk tanımlarını kontrol edin.",
          "Yetkiniz varsa düzenlemeyi kaydedin."
        ],
        "en": [
          "Open Manage Statuses.",
          "Review labels and colour definitions.",
          "Save edits if authorised."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Status label → Colour",
      "evidence": "public/app-main.js",
      "area": "koleksiyon",
      "areas": [
        "koleksiyon"
      ],
      "level": "module"
    },
    {
      "id": "model-files",
      "module": "koleksiyon",
      "visual": "menu",
      "selector": "#kolModelFilesBtn",
      "title": {
        "tr": "Model dosyaları",
        "en": "Model files"
      },
      "summary": {
        "tr": "Koleksiyon Araçlar menüsündeki Dosyalar / TPs, model dosyalarının yönetildiği alandır.",
        "en": "Files / TPs in Collection Tools is the model-file management entry."
      },
      "path": {
        "tr": "Koleksiyon → Araçlar → Dosyalar / TPs",
        "en": "Collection → Tools → Files / TPs"
      },
      "steps": {
        "tr": [
          "İlgili model kapsamını belirleyin.",
          "Dosyalar / TPs işlemini açın.",
          "Doğru modele bağlı dosyaları inceleyin ve yetkili işlemleri kullanın."
        ],
        "en": [
          "Choose the model scope.",
          "Open Files / TPs.",
          "Review model-linked files and use permitted actions."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Model → TPs / Files",
      "evidence": "public/app-main.js",
      "area": "koleksiyon",
      "areas": [
        "koleksiyon"
      ],
      "level": "module"
    },
    {
      "id": "endeksmatik-sets",
      "module": "koleksiyon",
      "visual": "menu",
      "selector": "#kolEndeksmatikSetsBtn",
      "title": {
        "tr": "Endeksmatik ülke / bölge setleri",
        "en": "Endeksmatik country / region sets"
      },
      "summary": {
        "tr": "Araçlar’daki Endeksmatik Setleri yüklenmiş dosyaları yönetir ve varsayılan seti seçtirir. Yeni dosya için Endeksmatik Güncelle kullanılır.",
        "en": "Endeksmatik Sets manages uploaded files and the default set. Update Endeksmatik loads a new workbook."
      },
      "path": {
        "tr": "Koleksiyon → Araçlar → Endeksmatik Setleri",
        "en": "Collection → Tools → Endeksmatik Sets"
      },
      "steps": {
        "tr": [
          "Setler listesini açın.",
          "Ülke / bölge ve dosya bilgilerini kontrol edin.",
          "İlgili varsayılanı seçin; yeni dosya için Güncelle’yi kullanın."
        ],
        "en": [
          "Open the sets list.",
          "Review country / region and workbook details.",
          "Choose a default; use Update for a new workbook."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Country / Region → Default set",
      "evidence": "public/app-main.js",
      "area": "koleksiyon",
      "areas": [
        "koleksiyon"
      ],
      "level": "module"
    },
    {
      "id": "collection-export",
      "module": "koleksiyon",
      "visual": "grid",
      "selector": "#kolExportImgBtn",
      "title": {
        "tr": "Model görselleriyle Excel oluşturun",
        "en": "Export Excel with model images"
      },
      "summary": {
        "tr": "Koleksiyon’un Excel’e Aktar işlemi model görsellerini de içeren bir dosya üretir. Filtre ve görünüm kapsamını dışa aktarmadan önce kontrol edin.",
        "en": "Collection Export to Excel includes model images. Review filters and view scope before exporting."
      },
      "path": {
        "tr": "Koleksiyon → Excel’e Aktar",
        "en": "Collection → Export to Excel"
      },
      "steps": {
        "tr": [
          "İstenen filtre ve görünümü hazırlayın.",
          "Excel’e Aktar düğmesine basın.",
          "Dosyada model, renk ve görsel eşleşmelerini kontrol edin."
        ],
        "en": [
          "Prepare the required filters and view.",
          "Press Export to Excel.",
          "Check model, colour and image matches in the file."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Model + Image → Excel",
      "evidence": "public/app-main.js",
      "area": "koleksiyon",
      "areas": [
        "koleksiyon"
      ],
      "level": "module"
    },
    {
      "id": "recycle",
      "module": "koleksiyon",
      "visual": "menu",
      "selector": "#kolRecycleBinBtn",
      "title": {
        "tr": "Silinen modelleri geri bulun",
        "en": "Recover deleted models"
      },
      "summary": {
        "tr": "Koleksiyon’da silinen modeller Geri Dönüşüm Kutusu’nda 30 gün saklanır. Drop / İptal Et ile silme farklı işlemlerdir.",
        "en": "Deleted Collection models are kept in the Recycle Bin for 30 days. Drop and Delete are different operations."
      },
      "path": {
        "tr": "Koleksiyon → Geri Dönüşüm Kutusu",
        "en": "Collection → Recycle Bin"
      },
      "steps": {
        "tr": [
          "Geri Dönüşüm Kutusu’nu açın.",
          "Model adını ve silinme bilgisini inceleyin.",
          "Gerekli modeli geri yükleme akışını kullanın."
        ],
        "en": [
          "Open the Recycle Bin.",
          "Review model name and deletion details.",
          "Use the recovery action for the required model."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Delete → Recycle Bin → Restore",
      "evidence": "public/app-main.js",
      "area": "koleksiyon",
      "areas": [
        "koleksiyon"
      ],
      "level": "module"
    },
    {
      "id": "duplicate",
      "module": "koleksiyon",
      "visual": "table",
      "selector": "#kolDuplicateBtn",
      "title": {
        "tr": "Model çoğaltma",
        "en": "Duplicate a model"
      },
      "summary": {
        "tr": "Çoğalt, seçili satırların kopyalarını Koleksiyon’a ekler. Yeni kayıtların ay ve model alanlarını tekrar gözden geçirin.",
        "en": "Duplicate adds copies of selected rows to Collection. Review the month and model fields of the new records."
      },
      "path": {
        "tr": "Koleksiyon → satır seçimi → Çoğalt",
        "en": "Collection → row selection → Duplicate"
      },
      "steps": {
        "tr": [
          "Çoğaltılacak satırları işaretleyin.",
          "Çoğalt düğmesine basın.",
          "Yeni kayıtların bilgilerini ihtiyaca göre düzenleyin."
        ],
        "en": [
          "Check rows to duplicate.",
          "Press Duplicate.",
          "Adjust the new records as needed."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "☑ Model → Duplicate → New record",
      "evidence": "public/app-main.js",
      "area": "koleksiyon",
      "areas": [
        "koleksiyon"
      ],
      "level": "module"
    },
    {
      "id": "quotation",
      "module": "quotations",
      "visual": "table",
      "selector": "[data-quote-approve]",
      "title": {
        "tr": "Teklif matrisinde karşılaştırın ve onaylayın",
        "en": "Compare and approve in the quotation matrix"
      },
      "summary": {
        "tr": "Fiyat Masası › Masa, talebi model görselleriyle model × üretici matrisi olarak gösterir. En iyi teklif, hedef farkı ve olağan dışı fiyat uyarısı hücrededir; onay ilgili üretici ve fiyat için çalışır.",
        "en": "Pricing Desk › Desk shows a request as a model × manufacturer matrix with model images. Best offer, target difference and outlier warnings are in the cell; approval applies to that manufacturer and price."
      },
      "path": {
        "tr": "Fiyat Masası → Masa → teklif matrisi",
        "en": "Pricing Desk → Desk → quotation matrix"
      },
      "steps": {
        "tr": [
          "Soldaki listeden fiyat talebini seçin.",
          "Matris hücresine fiyatı yazın veya Excel’den yapıştırın, Ctrl+Z son girişi geri alır.",
          "Doğru teklifi ✓ ile onaylayın ya da hedefin altındaki teklifleri toplu onaylayın."
        ],
        "en": [
          "Select the pricing request on the left.",
          "Type a price in the matrix cell or paste from Excel, Ctrl+Z undoes the last entry.",
          "Approve the right offer with ✓ or bulk-approve offers below target."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Supplier A $8.20 / Supplier B $8.05",
      "evidence": "public/quotations.js",
      "area": "quotations",
      "areas": [
        "quotations"
      ],
      "level": "module"
    },
    {
      "id": "quotation-notes",
      "module": "quotations",
      "visual": "menu",
      "selector": "[data-quotation-note]",
      "title": {
        "tr": "Quotation notu ve düzenleme yetkisi",
        "en": "Quotation notes and editing access"
      },
      "summary": {
        "tr": "Fiyat çalışmasına not ekleyebilir ve yetkili olduğunuz çalışmada düzenleme erişimini yönetebilirsiniz.",
        "en": "Add notes to a price study and manage editing access when authorised."
      },
      "path": {
        "tr": "Fiyat Masası → Masa → Quotation Notu / Düzenleme Yetkisi",
        "en": "Pricing Desk → Desk → Quotation Note / Editing Permission"
      },
      "steps": {
        "tr": [
          "Çalışmayı açın.",
          "Quotation Notu alanına bağlamı yazın.",
          "Gerekirse Düzenleme Yetkisi alanından erişimi kontrol edin."
        ],
        "en": [
          "Open the study.",
          "Record context in Quotation Note.",
          "Review Editing Permission if needed."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Quotation → Note · Editing Permission",
      "evidence": "public/quotations.js",
      "area": "quotations",
      "areas": [
        "quotations"
      ],
      "level": "module"
    },
    {
      "id": "quotation-reminder",
      "module": "quotations",
      "visual": "menu",
      "selector": "[data-q-send-reminder]",
      "title": {
        "tr": "Fiyatı beklenen üreticilere hatırlatma",
        "en": "Remind suppliers awaiting prices"
      },
      "summary": {
        "tr": "Hatırlatma Gönder, fiyat beklenen üreticiler olduğunda kullanılabilir. İşlem öncesinde alıcı ve içerik kapsamını kontrol edin.",
        "en": "Send Reminder is available when manufacturers are awaiting prices. Review recipients and content before sending."
      },
      "path": {
        "tr": "Fiyat Masası → Masa → Hatırlatma Gönder",
        "en": "Pricing Desk → Desk → Send Reminder"
      },
      "steps": {
        "tr": [
          "Bekleyen fiyatları ilgili çalışmada inceleyin.",
          "Hatırlatma Gönder akışını açın.",
          "Alıcıları ve mesajı kontrol ederek onaylayın."
        ],
        "en": [
          "Review outstanding prices in the study.",
          "Open Send Reminder.",
          "Review recipients and the message before confirming."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Awaiting quote → Reminder",
      "evidence": "public/quotations.js",
      "area": "quotations",
      "areas": [
        "quotations"
      ],
      "level": "module"
    },
    {
      "id": "price-history",
      "module": "pricinghistory",
      "visual": "table",
      "selector": "[data-ph-columns]",
      "title": {
        "tr": "Fiyat geçmişinden benchmark",
        "en": "Benchmarks from price history"
      },
      "summary": {
        "tr": "Fiyat Masası › Geçmiş, her model için teklif trendini (Fiyat Defteri olayları: tarih, kişi, tur) ve kayıt tablosunu gösterir. Benchmark Olarak Uygula ayrı bir işlemdir.",
        "en": "Pricing Desk › History shows each model’s offer trend (Price Ledger events: date, person, round) and the record table. Apply as Benchmark is a separate action."
      },
      "path": {
        "tr": "Fiyat Masası → Geçmiş → model",
        "en": "Pricing Desk → History → model"
      },
      "steps": {
        "tr": [
          "İlgili fiyat kaydını seçin.",
          "Geçmiş ortalama ve en iyi fiyat karşılaştırmasını okuyun.",
          "Gerekliyse Benchmark Olarak Uygula akışını kontrol edin."
        ],
        "en": [
          "Select a price record.",
          "Review historical average and best-price comparisons.",
          "Review Apply as Benchmark if needed."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Selected price → Average / Best",
      "evidence": "public/quotations.js",
      "area": "pricinghistory",
      "areas": [
        "pricinghistory"
      ],
      "level": "module"
    },
    {
      "id": "pricing-desk-rounds",
      "module": "quotations",
      "visual": "view",
      "selector": "[data-pd-round]",
      "title": {
        "tr": "Pazarlık turlarını izleyin",
        "en": "Track negotiation rounds"
      },
      "summary": {
        "tr": "Yeni Tur, mevcut fiyatların üstüne yazmadan yeni bir pazarlık turu açar. Turlar sekmesi her üreticinin tur tur fiyatını ve kazancı gösterir.",
        "en": "New Round opens a negotiation round without overwriting current prices. The Rounds tab shows every manufacturer’s price per round and the gain."
      },
      "path": {
        "tr": "Fiyat Masası → Turlar",
        "en": "Pricing Desk → Rounds"
      },
      "steps": {
        "tr": [
          "Masada talebi açın ve Yeni Tur ile karşı teklif notunu yazın.",
          "Yeni fiyatları matrise girin; önceki tur fiyatı üstü çizili kalır.",
          "Turlar sekmesinde ilk tur → güncel fiyat kazancını okuyun."
        ],
        "en": [
          "Open the request on the Desk and write the counter-offer note with New Round.",
          "Enter new prices in the matrix; the previous round price stays struck through.",
          "Read the first-round → current gain on the Rounds tab."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Round 1 $9.40 → Round 3 $8.90",
      "evidence": "public/pricing-desk.js",
      "area": "quotations",
      "areas": [
        "quotations"
      ],
      "level": "module"
    },
    {
      "id": "pricing-desk-analysis",
      "module": "quotations",
      "visual": "table",
      "selector": "[data-pd-tab=\"analysis\"]",
      "title": {
        "tr": "Klasman bazında kim ne fiyat veriyor",
        "en": "Who quotes what, by classification"
      },
      "summary": {
        "tr": "Analiz sekmesi klasman, MAG, MMYG veya buyer × üretici ısı matrisini, üretici karnesini ve buyer karşılaştırmasını gösterir. Yetkiniz varsa Buyer kapsamından bir veya birden çok buyer seçilebilir.",
        "en": "The Analysis tab shows a classification, MAG, MMYG or buyer × manufacturer heat matrix, a supplier scorecard and a buyer comparison. With permission you can select one or more buyers from Buyer scope."
      },
      "path": {
        "tr": "Fiyat Masası → Analiz",
        "en": "Pricing Desk → Analysis"
      },
      "steps": {
        "tr": [
          "Üst çubuktaki Buyer kapsamından kendinizi veya yetkili olduğunuz buyer’ları seçin.",
          "Gruplama ve filtreleri (sezon, MAG, üretici) ayarlayın.",
          "Hücreye tıklayarak o grup × üreticinin model ve tekliflerini görselleriyle açın."
        ],
        "en": [
          "Choose yourself or the buyers you are authorised for in Buyer scope on the top bar.",
          "Set grouping and filters (season, MAG, manufacturer).",
          "Click a cell to open that group × manufacturer’s models and offers with images."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Kazak × Supplier B −4.2%",
      "evidence": "public/pricing-desk.js",
      "area": "quotations",
      "areas": [
        "quotations"
      ],
      "level": "module"
    },
    {
      "id": "collection-price-view",
      "module": "koleksiyon",
      "visual": "view",
      "selector": "#kolPriceViewActions",
      "title": {
        "tr": "Koleksiyon’da Kompakt fiyat görünümü",
        "en": "Compact price view in Collection"
      },
      "summary": {
        "tr": "Kompakt görünüm teklif, onay, hedef farkı ve FOB’u tek Teklif & Onay şeridinde, landed değerlerini Landed Özeti’nde toplar. Detay ayrı sütunları, Maliyet royalty/hologram ve landed sütunlarını gösterir. Çift tık Fiyat Çekmecesi’ni açar.",
        "en": "Compact view combines quotes, approval, target difference and FOB into one Quotes & Approval strip and landed values into Landed Summary. Detail shows the separate columns; Cost shows royalty/hologram and landed columns. Double-click opens the Price Drawer."
      },
      "path": {
        "tr": "Koleksiyon → FİYAT: Kompakt · Detay · Maliyet",
        "en": "Collection → PRICE: Compact · Detail · Cost"
      },
      "steps": {
        "tr": [
          "Görünüm çubuğundaki FİYAT grubundan Kompakt, Detay veya Maliyet’i seçin.",
          "Teklif & Onay hücresine çift tıklayarak Fiyat Çekmecesi’nde teklifleri, onayı ve maliyet şelalesini görün.",
          "Veri Sağlığı çipleriyle eksik kuralı, kuru, hedefi veya bekleyen teklifi olan modelleri süzün."
        ],
        "en": [
          "Choose Compact, Detail or Cost in the PRICE group of the view bar.",
          "Double-click a Quotes & Approval cell to see offers, approval and the cost waterfall in the Price Drawer.",
          "Use Data Health chips to filter models missing a rule, FX, target or awaiting quotations."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "$8.90 −3.3% ✓ Supplier B",
      "evidence": "public/collection-price-drawer.js",
      "area": "koleksiyon",
      "areas": [
        "koleksiyon"
      ],
      "level": "module"
    },
    {
      "id": "price-analysis",
      "module": "priceanalysis",
      "visual": "table",
      "selector": "#priceSupplierAnalysis",
      "title": {
        "tr": "Fiyat ve üretici analizinde kapsam",
        "en": "Set the scope of supplier analysis"
      },
      "summary": {
        "tr": "Fiyat & Üretici Analizi ekranında Season ve Compare seçimleri karşılaştırmanın bağlamını belirler. Önce kapsamı, sonra sonucu değerlendirin.",
        "en": "Season and Compare define the context of Price & Supplier Analysis. Set the scope before interpreting results."
      },
      "path": {
        "tr": "Fiyat & Üretici Analizi → Season / Compare",
        "en": "Price & Supplier Analysis → Season / Compare"
      },
      "steps": {
        "tr": [
          "İncelenecek sezonu seçin.",
          "Karşılaştırma sezonunu belirleyin.",
          "Tablodaki üretici ve fiyat farklarını seçili kapsamla birlikte okuyun."
        ],
        "en": [
          "Select the season.",
          "Choose the comparison season.",
          "Read supplier and price differences in that scope."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Season W7 ↔ Compare W6",
      "evidence": "public/app-main.js",
      "area": "priceanalysis",
      "areas": [
        "priceanalysis"
      ],
      "level": "module"
    },
    {
      "id": "backlog",
      "module": "backlog",
      "visual": "table",
      "selector": "#view-backlog",
      "title": {
        "tr": "Backlog: gruplar ve alt detay",
        "en": "Backlog: groups and detail"
      },
      "summary": {
        "tr": "Backlog gruplu bir sipariş görünümüdür. Filtrelenmiş toplamları değerlendirirken alt detaydan ilgili kayıtları kontrol edin.",
        "en": "Backlog is a grouped order view. Check underlying records in detail when evaluating filtered totals."
      },
      "path": {
        "tr": "Backlog → grup / alt detay",
        "en": "Backlog → group / detail"
      },
      "steps": {
        "tr": [
          "Gerekli filtre kapsamını seçin.",
          "Grupları açarak kırılımları okuyun.",
          "İlgili toplamın alt detayındaki kayıtları inceleyin."
        ],
        "en": [
          "Select the filter scope.",
          "Expand groups to inspect breakdowns.",
          "Review records behind the relevant total."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Group → Subtotal → Records",
      "evidence": "public/app-main.js",
      "area": "backlog",
      "areas": [
        "backlog"
      ],
      "level": "module"
    },
    {
      "id": "backlog-export-columns",
      "module": "backlog",
      "visual": "column",
      "selector": "#backlogExcelOptionsBtn",
      "title": {
        "tr": "Backlog Excel sütunlarını seçin",
        "en": "Choose Backlog Excel columns"
      },
      "summary": {
        "tr": "Backlog dışa aktarımında Excel sütun seçimi kayıtlı kapsamla yönetilir. Hesaplanan sütun ekleme yalnız CP, Siparişler ve Nakliye Kıyaslama’da desteklenir.",
        "en": "Backlog export uses a saved Excel column selection. Adding calculated columns is supported only in CP, Orders and Shipping Comparison."
      },
      "path": {
        "tr": "Backlog → Excel dışa aktarım sütun ayarları",
        "en": "Backlog → Excel export column settings"
      },
      "steps": {
        "tr": [
          "Backlog ekranında dışa aktarım kapsamını belirleyin.",
          "Excel sütun ayarlarından gerekli alanları seçin.",
          "Dosyada başlık ve satır kapsamını kontrol edin."
        ],
        "en": [
          "Set the export scope in Backlog.",
          "Select the required Excel export fields.",
          "Check headings and record scope in the file."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Backlog → Excel column selection",
      "evidence": "public/app-main.js",
      "area": "backlog",
      "areas": [
        "backlog"
      ],
      "level": "module"
    },
    {
      "id": "shipping",
      "module": "shipping",
      "visual": "table",
      "selector": "#view-shipping",
      "title": {
        "tr": "Nakliye seçeneklerini kıyaslayın",
        "en": "Compare freight options"
      },
      "summary": {
        "tr": "Nakliye Kıyaslama modellerin taşıma ve maliyet seçeneklerini değerlendirmek içindir. Kur ve navlun girdileri sonucu etkiler.",
        "en": "Shipping Comparison evaluates transport and cost options for models. Exchange rates and freight inputs affect results."
      },
      "path": {
        "tr": "Nakliye Kıyaslama → model tablosu",
        "en": "Shipping Comparison → model table"
      },
      "steps": {
        "tr": [
          "Koleksiyon’dan gerekli modelleri aktarın.",
          "Kur ve navlun girdilerini kontrol edin.",
          "Alternatiflerin maliyet sonuçlarını karşılaştırın."
        ],
        "en": [
          "Send the relevant models from Collection.",
          "Check exchange rates and freight inputs.",
          "Compare cost results for the alternatives."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Freight + FX → Cost comparison",
      "evidence": "public/app-main.js",
      "area": "shipping",
      "areas": [
        "shipping"
      ],
      "level": "module"
    },
    {
      "id": "lfl",
      "module": "lfl",
      "visual": "table",
      "selector": "#view-lfl",
      "title": {
        "tr": "LFL: bağımsız senaryolar",
        "en": "LFL: independent scenarios"
      },
      "summary": {
        "tr": "LFL analizi, farklı dönem ve ürün / üretici kapsamlarını karşılaştırmak için bağımsız senaryolar sunar.",
        "en": "LFL provides independent scenarios for comparing periods and product or manufacturer scopes."
      },
      "path": {
        "tr": "LFL Analizi → Multi-dimensional Comparison",
        "en": "LFL Analysis → Multi-dimensional Comparison"
      },
      "steps": {
        "tr": [
          "Karşılaştırılacak senaryoların kapsamını belirleyin.",
          "İlgili tabloda Columns ile ihtiyaç duyduğunuz alanları seçin.",
          "Ürün ve üretici karşılaştırmalarını birlikte değerlendirin."
        ],
        "en": [
          "Set the scope of the scenarios.",
          "Use Columns in the relevant table to choose fields.",
          "Review product and manufacturer comparisons together."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Scenario A ↔ Scenario B",
      "evidence": "public/lfl.js",
      "area": "lfl",
      "areas": [
        "lfl"
      ],
      "level": "module"
    },
    {
      "id": "lfl-trial",
      "module": "koleksiyon",
      "visual": "menu",
      "selector": "#kolLflTrialBtn",
      "title": {
        "tr": "Seçili modellerle LFL Trial",
        "en": "LFL Trial with selected models"
      },
      "summary": {
        "tr": "Koleksiyon’daki seçili modelleri LFL Trial simülasyonuna göndererek karşılaştırma çalışmasına dahil edebilirsiniz.",
        "en": "Send selected Collection models to an LFL Trial simulation for comparison."
      },
      "path": {
        "tr": "Koleksiyon → Araçlar → LFL Trial",
        "en": "Collection → Tools → LFL Trial"
      },
      "steps": {
        "tr": [
          "Simülasyona dahil edeceğiniz modelleri işaretleyin.",
          "Araçlar → LFL Trial seçin.",
          "Hedef ekranda senaryo kapsamını kontrol edin."
        ],
        "en": [
          "Check models for the simulation.",
          "Select Tools → LFL Trial.",
          "Review scenario scope in the target screen."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "☑ Collection models → LFL Trial",
      "evidence": "public/app-main.js",
      "area": "koleksiyon",
      "areas": [
        "koleksiyon"
      ],
      "level": "module"
    },
    {
      "id": "open-costing",
      "module": "koleksiyon",
      "visual": "formula",
      "selector": "#kolCreateOcBtn",
      "title": {
        "tr": "Ön Maliyet oluşturma",
        "en": "Create an open costing"
      },
      "summary": {
        "tr": "Koleksiyon’daki Maliyet Oluştur, seçili modellerden Ön Maliyet çalışması açar. Hesabın girdilerini model bazında kontrol edin.",
        "en": "Create OC in Collection opens an Open Costing study from selected models. Check calculation inputs for each model."
      },
      "path": {
        "tr": "Koleksiyon → Araçlar → Maliyet Oluştur",
        "en": "Collection → Tools → Create OC"
      },
      "steps": {
        "tr": [
          "İlgili modelleri seçin.",
          "Maliyet Oluştur akışını açın.",
          "Ön Maliyet ekranında malzeme, işlem ve kur girdilerini inceleyin."
        ],
        "en": [
          "Select relevant models.",
          "Open Create OC.",
          "Review material, process and exchange-rate inputs in Open Costing."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Materials + Operations + FX → OC",
      "evidence": "public/index.html",
      "area": "koleksiyon",
      "areas": [
        "koleksiyon"
      ],
      "level": "module"
    },
    {
      "id": "fx",
      "module": "opencosting",
      "visual": "formula",
      "selector": "#ocFxBtn",
      "title": {
        "tr": "Kur verisini kontrol edin",
        "en": "Check exchange-rate data"
      },
      "summary": {
        "tr": "Ön Maliyet hesaplarını yorumlamadan önce kur verisinin kaynağını ve güncelliğini kontrol edin. Kur güncelleme işlemi yetkiye bağlıdır.",
        "en": "Check exchange-rate source and freshness before interpreting Open Costing results. Updating rates requires permission."
      },
      "path": {
        "tr": "Ön Maliyet → kur işlemleri",
        "en": "Open Costing → exchange-rate actions"
      },
      "steps": {
        "tr": [
          "Kur ekranını açın.",
          "Kaynak ve son güncelleme bilgisini inceleyin.",
          "Yetkiniz varsa geçerli dosya veya kaynakla güncelleyin."
        ],
        "en": [
          "Open exchange-rate actions.",
          "Review source and last-update details.",
          "Update from a valid file or source if authorised."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "FX source → Freshness → Calculation",
      "evidence": "public/app-main.js",
      "area": "opencosting",
      "areas": [
        "opencosting"
      ],
      "level": "module"
    },
    {
      "id": "map",
      "module": "overview",
      "visual": "map",
      "selector": "#globalFlowMapWidget",
      "title": {
        "tr": "Global Flow Map: görünüm ve ölçü",
        "en": "Global Flow Map: view and measure"
      },
      "summary": {
        "tr": "Global Flow Map üretim ve sevkiyat akışını gösterir. Source, görünüm ve Measure seçimiyle inceleme biçimini değiştirebilirsiniz.",
        "en": "Global Flow Map displays production and shipment flows. Source, view and Measure change how you inspect them."
      },
      "path": {
        "tr": "Overview → Global Flow Map",
        "en": "Overview → Global Flow Map"
      },
      "steps": {
        "tr": [
          "Veri kaynağını ve ölçüyü seçin.",
          "2D / 3D veya Earth görünümünü kullanın.",
          "Rota ve semboller üzerinden ayrıntıları inceleyin."
        ],
        "en": [
          "Select the data source and measure.",
          "Use 2D / 3D or Earth view.",
          "Inspect routes and symbols for details."
        ]
      },
      "note": {
        "tr": "Rotalar operasyonel yaklaşımdır; canlı GPS konumu değildir.",
        "en": "Routes are operational approximations, not live GPS positions."
      },
      "example": "Source → Measure → Route detail",
      "evidence": "public/index.html",
      "area": "overview",
      "areas": [
        "overview"
      ],
      "level": "module"
    },
    {
      "id": "map-overdue",
      "module": "overview",
      "visual": "map",
      "selector": "#globalFlowMapWidget",
      "title": {
        "tr": "Yolda geciken sevkiyatı fark edin",
        "en": "Spot overdue shipments in transit"
      },
      "summary": {
        "tr": "Ortalama yol süresi dolmuş ve henüz varış durumuna geçmemiş sevkiyatların sembol çerçevesi sarı gösterilir.",
        "en": "Shipments past average transit time and still without an arrival status have a yellow symbol border."
      },
      "path": {
        "tr": "Overview → Global Flow Map → sembol",
        "en": "Overview → Global Flow Map → symbol"
      },
      "steps": {
        "tr": [
          "Haritadaki sembol çerçevelerini inceleyin.",
          "Sarı çerçeveli sevkiyatın ayrıntısını açın.",
          "Durum ve tarihleri kontrol ederek takip planlayın."
        ],
        "en": [
          "Inspect symbol borders.",
          "Open an item with a yellow border.",
          "Review status and dates to plan follow-up."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "In transit + Transit time exceeded",
      "evidence": "public/overview-global-flow.js",
      "area": "overview",
      "areas": [
        "overview"
      ],
      "level": "module"
    },
    {
      "id": "overview-layout",
      "module": "overview",
      "visual": "menu",
      "selector": "#ovLayoutEditBtn",
      "title": {
        "tr": "Overview sayfalarınızı düzenleyin",
        "en": "Arrange Overview pages"
      },
      "summary": {
        "tr": "Overview’un Edit alanı, kartların ve sayfaların yerleşimini kişisel çalışma düzeninize göre ayarlamak içindir.",
        "en": "Overview Edit lets you arrange pages and cards for your workspace."
      },
      "path": {
        "tr": "Overview → Edit",
        "en": "Overview → Edit"
      },
      "steps": {
        "tr": [
          "Overview’da Edit kontrolünü açın.",
          "İhtiyacınız olan kart ve sayfa düzenini seçin.",
          "Düzenlemeyi bitirip normal görünüme dönün."
        ],
        "en": [
          "Open Edit in Overview.",
          "Choose the card and page arrangement you need.",
          "Finish editing and return to normal view."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Page 1 / Page 2 → Edit",
      "evidence": "public/overview-layout.js",
      "area": "overview",
      "areas": [
        "overview"
      ],
      "level": "module"
    },
    {
      "id": "oab",
      "module": "overview",
      "visual": "table",
      "selector": "#oabGetBtn",
      "title": {
        "tr": "OAB: önce kapsamı seçin",
        "en": "OAB: choose the scope first"
      },
      "summary": {
        "tr": "Overview’daki OAB kartı Season, MAG ve Buyer Group seçimleriyle veri alır. Pivot ve Ham Veri görünümleri farklı inceleme biçimleri sunar.",
        "en": "The OAB card in Overview loads data using Season, MAG and Buyer Group. Pivot and Raw Data offer different views."
      },
      "path": {
        "tr": "Overview → OAB → Get OAB",
        "en": "Overview → OAB → Get OAB"
      },
      "steps": {
        "tr": [
          "Season, MAG ve Buyer Group kapsamını seçin.",
          "Get OAB ile veriyi alın.",
          "Pivot veya Ham Veri görünümünde inceleyin."
        ],
        "en": [
          "Select Season, MAG and Buyer Group.",
          "Load data with Get OAB.",
          "Review Pivot or Raw Data."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Season · MAG · Buyer Group → Get OAB",
      "evidence": "public/oab.js",
      "area": "overview",
      "areas": [
        "overview"
      ],
      "level": "module"
    },
    {
      "id": "oab-detail",
      "module": "overview",
      "visual": "table",
      "selector": "#oabSection",
      "title": {
        "tr": "OAB alt detayını yan panelde inceleyin",
        "en": "Inspect OAB detail in the side panel"
      },
      "summary": {
        "tr": "OAB alt detayında Özet Alanlar, Tüm Alanlar, arama, görseller ve Excel aktarımı bulunur.",
        "en": "OAB detail provides Key Fields, All Fields, search, images and Excel export."
      },
      "path": {
        "tr": "Overview → OAB → alt detay",
        "en": "Overview → OAB → drill-down"
      },
      "steps": {
        "tr": [
          "İlgili ölçünün alt detayını açın.",
          "Özet Alanlar / Tüm Alanlar ve aramayla kapsamı inceleyin.",
          "Gerekirse Görselleri Göster veya Excel’e Aktar kullanın."
        ],
        "en": [
          "Open detail for the relevant measure.",
          "Use Key Fields / All Fields and search.",
          "Use Show Images or Export Excel if needed."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Summary → Detail drawer → All Fields",
      "evidence": "public/oab.js",
      "area": "overview",
      "areas": [
        "overview"
      ],
      "level": "module"
    },
    {
      "id": "intake",
      "module": "overview",
      "visual": "filter",
      "selector": "#intakeFieldsBtn",
      "title": {
        "tr": "Intake: sıfır bütçeleri gizleyin",
        "en": "Intake: hide zero-budget rows"
      },
      "summary": {
        "tr": "Intake ayarlarında Güncel Alım Bütçe = 0 olanları listeleme seçeneği vardır. Dönem Tanım değerleri ay sırasıyla değerlendirilir.",
        "en": "Intake settings include Hide rows where Current Purchase Budget is 0. Period labels are ordered by month."
      },
      "path": {
        "tr": "Overview → Intake → Ayarlar",
        "en": "Overview → Intake → Settings"
      },
      "steps": {
        "tr": [
          "Intake Ayarları’nı açın.",
          "Sıfır güncel bütçeleri gizleme seçeneğini kontrol edin.",
          "Pivot kapsamını kaydedip ay bazında sonucu okuyun."
        ],
        "en": [
          "Open Intake Settings.",
          "Review the hide-zero-current-budget option.",
          "Save the pivot scope and read results by month."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Current Purchase Budget ≠ 0",
      "evidence": "public/intake.js",
      "area": "overview",
      "areas": [
        "overview"
      ],
      "level": "module"
    },
    {
      "id": "automation",
      "module": "automations",
      "visual": "menu",
      "selector": "[data-auto-preview]",
      "title": {
        "tr": "Otomasyonu çalıştırmadan önce deneyin",
        "en": "Try an automation before running it"
      },
      "summary": {
        "tr": "Otomasyonlar’da kaynak ve koşullar işlem kapsamını belirler. Dene (hiçbir şey göndermez) ile önizleme, Çalıştır ile gerçek işlem yapılır.",
        "en": "Source and conditions set the automation scope. Try it (sends nothing) previews; Run performs the actual operation."
      },
      "path": {
        "tr": "Otomasyonlar → düzenleyici → Dene",
        "en": "Automations → editor → Try it"
      },
      "steps": {
        "tr": [
          "Kaynak ve filtre koşullarını belirleyin.",
          "Dene ile kapsamı ve sonucu kontrol edin.",
          "Kaydedin; gerçek işlem gerektiğinde Çalıştır’ı kullanın."
        ],
        "en": [
          "Set the source and filter conditions.",
          "Use Try it to check scope and results.",
          "Save; use Run when you intend the actual operation."
        ]
      },
      "note": {
        "tr": "Çalıştır gerçek işlem yapabilir; önizleme ile aynı değildir.",
        "en": "Run may perform real actions; it is different from preview."
      },
      "example": "Source → Conditions → Preview → Run",
      "evidence": "public/automations.js",
      "area": "automations",
      "areas": [
        "automations"
      ],
      "level": "module"
    },
    {
      "id": "automation-chain",
      "module": "automations",
      "visual": "table",
      "selector": "[data-auto-source]",
      "title": {
        "tr": "İkinci veri kaynağıyla eşleştirme",
        "en": "Match a second data source"
      },
      "summary": {
        "tr": "Otomasyonların gelişmiş ayarları ikinci kaynak bağlamaya ve eşleşme biçimini seçmeye izin verir.",
        "en": "Advanced automation settings let you chain a second source and choose matching behaviour."
      },
      "path": {
        "tr": "Otomasyonlar → Gelişmiş ayarlar → İkinci kaynak",
        "en": "Automations → Advanced settings → Second source"
      },
      "steps": {
        "tr": [
          "Ana veri kaynağını seçin.",
          "İkinci kaynağı ve eşleşme biçimini belirleyin.",
          "Koşulları iki kaynağın alanlarıyla kurup Dene ile kontrol edin."
        ],
        "en": [
          "Select the primary source.",
          "Choose a second source and matching behaviour.",
          "Build conditions with both sources and check with Try it."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Primary source ↔ Order Code ↔ Second source",
      "evidence": "public/automations.js",
      "area": "automations",
      "areas": [
        "automations"
      ],
      "level": "module"
    },
    {
      "id": "data-management",
      "module": "source",
      "visual": "column",
      "selector": "#view-source",
      "title": {
        "tr": "Veri Yönetimi ve kaynak kapsamı",
        "en": "Data Management and source scope"
      },
      "summary": {
        "tr": "Veri Yönetimi veri bağlantıları, kaynaklar ve ortak veri kapsamı için kurulum alanıdır. Kaynak kapsamı ile kişisel tablo filtresi farklıdır.",
        "en": "Data Management configures connections, sources and shared data scope. Source scope differs from personal table filters."
      },
      "path": {
        "tr": "Veri Yönetimi → kaynak ayarları",
        "en": "Data Management → source settings"
      },
      "steps": {
        "tr": [
          "İlgili kaynak bağlantısını açın.",
          "Veri kaynağı, eşleme ve kapsam ayarlarını kontrol edin.",
          "Yetkiniz olan değişiklikleri kaydedip yenileme sonucunu inceleyin."
        ],
        "en": [
          "Open the relevant source connection.",
          "Review source, mapping and scope settings.",
          "Save permitted changes and review refresh results."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Connection → Mapping → Source scope",
      "evidence": "public/app-main.js",
      "area": "source",
      "areas": [
        "source"
      ],
      "level": "module"
    },
    {
      "id": "refresh",
      "module": "general",
      "visual": "menu",
      "selector": "#cpRefreshBtn",
      "title": {
        "tr": "Yenileme ve ilk açılış aynı şey değildir",
        "en": "Refresh and startup are different"
      },
      "summary": {
        "tr": "İlk açılış yerel veriyi ekrana hazırlar. Yenile ise veri kaynaklarını günceller; veri hacmi ve kapsam işlem süresini etkiler.",
        "en": "Startup prepares local data for the screen. Refresh updates data sources; volume and scope affect its duration."
      },
      "path": {
        "tr": "Üst çubuk / tablo → Yenile",
        "en": "Top bar / table → Refresh"
      },
      "steps": {
        "tr": [
          "Yeni kaynak verisi gerektiğinde Yenile kullanın.",
          "İşlem sırasında düğmedeki ilerlemeyi takip edin.",
          "Tamamlanınca kaynak durumunu ve tabloyu kontrol edin."
        ],
        "en": [
          "Use Refresh when new source data is needed.",
          "Watch the refresh control while it runs.",
          "Check source status and the table on completion."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Local startup / Source refresh",
      "evidence": "public/app-main.js",
      "area": "cp",
      "areas": [
        "cp",
        "orders",
        "source"
      ],
      "level": "basic"
    },
    {
      "id": "preset-share",
      "module": "general",
      "visual": "menu",
      "selector": "#currentUserBtn",
      "title": {
        "tr": "Ön ayar paylaşımı",
        "en": "Share presets"
      },
      "summary": {
        "tr": "Kullanıcı menüsündeki Ön Ayar Paylaşımı, kayıtlı kişisel ayarları paylaşma akışını açar.",
        "en": "Preset Sharing in the user menu opens sharing for saved personal settings."
      },
      "path": {
        "tr": "Sağ üst kullanıcı menüsü → Ön Ayar Paylaşımı",
        "en": "Top-right user menu → Preset Sharing"
      },
      "steps": {
        "tr": [
          "Kullanıcı menüsünü açın.",
          "Ön Ayar Paylaşımı’nı seçin.",
          "Paylaşılacak ayar ve hedef kullanıcıları kontrol edin."
        ],
        "en": [
          "Open the user menu.",
          "Choose Preset Sharing.",
          "Review the settings and target users."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Personal preset → Share",
      "evidence": "public/user-access-ui.js",
      "area": null,
      "areas": [],
      "level": "basic"
    },
    {
      "id": "reset-view",
      "module": "general",
      "visual": "menu",
      "selector": "#currentUserBtn",
      "title": {
        "tr": "Kişisel görünümü sıfırlama",
        "en": "Reset your personal view"
      },
      "summary": {
        "tr": "Görünümümü Sıfırla, bulunduğunuz modülün kişisel filtre, sütun ve görünüm ayarlarını sıfırlama onayı ister.",
        "en": "Reset My View asks to reset personal filters, columns and view settings in the current module."
      },
      "path": {
        "tr": "Kullanıcı menüsü → Görünümümü Sıfırla",
        "en": "User menu → Reset My View"
      },
      "steps": {
        "tr": [
          "Önce doğru modülde olduğunuzu kontrol edin.",
          "Görünümümü Sıfırla’yı açın.",
          "Onay metnindeki kapsamı okuyup karar verin."
        ],
        "en": [
          "Check that you are in the correct module.",
          "Open Reset My View.",
          "Read the scope in the confirmation before deciding."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Current module → Personal view reset",
      "evidence": "public/user-access-ui.js",
      "area": null,
      "areas": [],
      "level": "basic"
    },
    {
      "id": "backup",
      "module": "general",
      "visual": "menu",
      "selector": "#currentUserBtn",
      "title": {
        "tr": "Backup ayarlarına erişim",
        "en": "Access Backup settings"
      },
      "summary": {
        "tr": "Sağ üst kullanıcı menüsündeki Backup, yedekleme ayarlarını açar. Geri yükleme işleminin kapsamını uygulamadan önce okuyun.",
        "en": "Backup in the top-right user menu opens backup settings. Read the scope before applying a restore."
      },
      "path": {
        "tr": "Kullanıcı menüsü → Backup",
        "en": "User menu → Backup"
      },
      "steps": {
        "tr": [
          "Kullanıcı menüsünden Backup açın.",
          "Mevcut yedek ve ayar bilgilerini inceleyin.",
          "Geri yükleme gerekiyorsa ilgili onay ve kapsamı kontrol edin."
        ],
        "en": [
          "Open Backup from the user menu.",
          "Review backup information and settings.",
          "For a restore, review the confirmation and scope."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Backup → Settings / Restore",
      "evidence": "public/user-access-ui.js",
      "area": null,
      "areas": [],
      "level": "basic"
    },
    {
      "id": "update",
      "module": "general",
      "visual": "menu",
      "selector": "#currentUserBtn",
      "title": {
        "tr": "Uygulama güncellemesi",
        "en": "App updates"
      },
      "summary": {
        "tr": "Kullanıcı menüsündeki Uygulama Güncellemesi sürüm kontrolünü açar. Moderatörlerde bu seçenek Güncelleme Testi olarak görünür.",
        "en": "App Update in the user menu opens version checks. Moderators see Update Test."
      },
      "path": {
        "tr": "Kullanıcı menüsü → Uygulama Güncellemesi",
        "en": "User menu → App Update"
      },
      "steps": {
        "tr": [
          "Kullanıcı menüsünü açın.",
          "Uygulama Güncellemesi’ni seçin.",
          "Sürüm ve işlem açıklamasını kontrol ederek ilerleyin."
        ],
        "en": [
          "Open the user menu.",
          "Choose App Update.",
          "Review version and operation details before continuing."
        ]
      },
      "note": {
        "tr": "",
        "en": ""
      },
      "example": "Current version → Available update",
      "evidence": "public/user-access-ui.js",
      "area": null,
      "areas": [],
      "level": "basic"
    }
  ]
};if(typeof module==='object'&&module.exports)module.exports=data;else root.BLGuideData=data;})(typeof window!=='undefined'?window:globalThis);
