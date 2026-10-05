'use strict';

/*
 * AI çıktı şablon kütüphanesi.
 *
 * Kullanıcı şablon seçmez: istek metnine ve çıktı türüne göre otomatik
 * seçilir (chooseTemplate). Şablon, LCW AI'a "hangi bölümler, hangi sırada,
 * hangi bileşenlerle" bilgisini verir; görsel dil her zaman Buyer Log
 * temasıdır (output-theme). Yeni şablon = bu listeye bir kayıt.
 */
const TEMPLATES = Object.freeze({
  executive: {
    key: 'executive',
    label: { tr: 'Yönetici Özeti', en: 'Executive Summary' },
    keywords: /yönetici|yonetici|executive|özet|ozet|summary|brief|sunum|management|üst yönetim|karar/i,
    formats: ['pdf', 'html', 'pptx', 'xlsx'],
    guide: {
      tr: 'Yönetici özeti: 1) tek cümlelik ana mesaj, 2) 3–6 KPI kartı, 3) en önemli 3–5 bulgu, 4) riskler (ton: risk/warn), 5) net aksiyon önerileri (kim/ne/ne zaman). Kısa ve karar odaklı yaz.',
      en: 'Executive summary: 1) one-sentence key message, 2) 3–6 KPI cards, 3) top 3–5 findings, 4) risks (tone: risk/warn), 5) clear actions (who/what/when). Be short and decision-oriented.',
    },
    slides: 'title → kpis → bullets (findings) → chart or table → summary (actions)',
  },
  analysis: {
    key: 'analysis',
    label: { tr: 'Veri Analizi', en: 'Data Analysis' },
    keywords: /analiz|analyse|analyze|analysis|trend|dağılım|dagilim|distribution|kırılım|breakdown|istatistik|statistic|oran|ratio|pivot/i,
    formats: ['pdf', 'html', 'pptx', 'xlsx'],
    guide: {
      tr: 'Veri analizi: kapsam ve yöntem (kaç kayıt, hangi filtre), temel metrikler, kırılım tabloları, dağılım/sıralama grafikleri (yatay bar), aykırı değerler ve yorum. Her rakamın kaynağını belirt.',
      en: 'Data analysis: scope and method (record count, filters), key metrics, breakdown tables, distribution/ranking charts (horizontal bars), outliers and interpretation. State the source of each figure.',
    },
    slides: 'title → kpis → chart → table → bullets (insights) → summary',
  },
  operational: {
    key: 'operational',
    label: { tr: 'Operasyon Raporu', en: 'Operational Report' },
    keywords: /gecikme|delay|backlog|termin|teslim|delivery|sevkiyat|shipping|operasyon|operation|takip|tracking|durum|status|risk|aksiyon|action|sipariş|order/i,
    formats: ['pdf', 'html', 'pptx', 'xlsx'],
    guide: {
      tr: 'Operasyon raporu: durum özeti (KPI), risk/gecikme listesi (tablo; durum rozetleri ok/warn/risk), kök nedenler, sorumlu ve tarihli aksiyon listesi. Kritik kayıtları en üstte sırala.',
      en: 'Operational report: status summary (KPIs), risk/delay list (table with ok/warn/risk badges), root causes, action list with owner and date. Put critical records first.',
    },
    slides: 'title → kpis → table (critical items) → chart → summary (actions)',
  },
  comparison: {
    key: 'comparison',
    label: { tr: 'Karşılaştırma', en: 'Comparison' },
    keywords: /karşılaştır|karsilastir|compare|comparison|versus|\bvs\.?\b|fark|difference|kıyas|kiyas|önceki|previous|geçen sezon|last season/i,
    formats: ['pdf', 'html', 'pptx', 'xlsx'],
    guide: {
      tr: 'Karşılaştırma: neyin neyle kıyaslandığı, yan yana metrik tablosu (fark ve % fark sütunlarıyla), öne çıkan farklar, kazanan/kaybeden alanlar, sonuç ve öneri.',
      en: 'Comparison: what is compared with what, side-by-side metric table (with difference and % difference columns), notable differences, winners/losers, conclusion and recommendation.',
    },
    slides: 'title → comparison → table → chart → summary',
  },
  workbook: {
    key: 'workbook',
    label: { tr: 'Çalışma Kitabı', en: 'Workbook' },
    keywords: /liste|list|tablo|table|excel|xlsx|döküm|dokum|export|aktar|veri seti|dataset/i,
    formats: ['xlsx'],
    guide: {
      tr: 'Çalışma kitabı: her mantıksal tablo ayrı sayfa; sütun tipleri doğru (sayı/yüzde/para/tarih), başlıklar kısa ve anlaşılır; gerekiyorsa toplam/özet sayfası ve basit formüller (SUM, AVERAGE, COUNTIF).',
      en: 'Workbook: each logical table on its own sheet; correct column types (number/percent/currency/date), short clear headers; a totals/summary sheet and simple formulas (SUM, AVERAGE, COUNTIF) when useful.',
    },
    slides: '',
  },
  general: {
    key: 'general',
    label: { tr: 'Genel Rapor', en: 'General Report' },
    keywords: null,
    formats: ['pdf', 'html', 'pptx', 'xlsx'],
    guide: {
      tr: 'Genel rapor: başlık, kısa giriş, mantıklı bölümler, gerektiğinde tablo/KPI/grafik ve sonuç. İsteğe en uygun yapıyı sen seç.',
      en: 'General report: title, short intro, logical sections, tables/KPIs/charts where useful and a conclusion. Choose the structure that best fits the request.',
    },
    slides: 'title → bullets/kpis/table/chart as needed → summary',
  },
});

const ORDER = ['comparison', 'executive', 'operational', 'analysis', 'workbook'];

/* İstek metni + biçim → şablon. Açık seçim (key) varsa o kullanılır. */
function chooseTemplate(format, message, explicit) {
  if (explicit && TEMPLATES[explicit] && TEMPLATES[explicit].formats.includes(format)) return TEMPLATES[explicit];
  const text = String(message || '');
  for (const key of ORDER) {
    const template = TEMPLATES[key];
    if (!template.formats.includes(format)) continue;
    if (template.keywords && template.keywords.test(text)) return template;
  }
  return format === 'xlsx' ? TEMPLATES.workbook : TEMPLATES.general;
}

const templateLabel = (template, lang) => (template ? template.label[lang === 'en' ? 'en' : 'tr'] : '');

module.exports = { TEMPLATES, chooseTemplate, templateLabel };
