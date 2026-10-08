'use strict';

/*
 * LCW AI'ın modelleri KENDİSİ grupladığı gerçek bir rapor yapısının anonim
 * (demo değerli) kopyası: "Ana kategori — Kumaş: …" ve "Alt kategori — …"
 * başlıkları, grup başına ayrı galeri, iki sütunlu sarmalayıcılar, KPI,
 * yerleşim notları ve galeri dışında kalan kartlar. Değerler uydurmadır.
 */
const FABRIC_A = 'Kumaş: 1001-Örme,Süprem,150 gsm,30/1,İplik,%100 Pamuk,Sürdürülebilir İçerik Yok,Reaktif,Silikon + Dikiş Kolaylığı Apresi, Enzim';
const FABRIC_B = 'Kumaş: 2002-Jersey,30,Ne Compact Combed 150 gsm,100%Cotton Reactive Print,Silicone, No Sustainable Content,-ReferenceNo:DEMO1';
const FABRIC_C = 'Kumaş: 3003-Two Thread Loop Back,30/1,,20/1,Combed ,Carded Compact 220 gsm,80%Cotton 20%Polyester Reaktive Disperse,Enzyme, Silicone';
const STATUS = [['ok', 'Sipariş Geçildi'], ['warn', 'Siparişe Hazır'], ['risk', 'Pending File']];
let n = 0;
const records = [];
function card(sub, fabric) {
  n += 1;
  const [tone, status] = STATUS[n % 3];
  const key = `KOL-${n}`;
  records.push({ key, fabric: fabric.replace(/^Kumaş: /, ''), sub, status });
  return `<div class="bl-card ${tone}"><img class="bl-model-img" data-bl-image="${key}" alt="DEMO-${n}"><h3>DEMO-${n}-YD</h3><p>R9J · ECRU · S7DEMO${n}</p><p>PLM ID: ${2120000 + n} · Adet: ${1000 * n}</p><span class="bl-badge ${tone}">${status}</span></div>`;
}
const gallery = (sub, fabric, count) => `<div class="bl-gallery">${Array.from({ length: count }, () => card(sub, fabric)).join('')}</div>`;
const pair = (sub, fabric, count) => `<div><h3>Ana kategori — ${fabric}</h3><h4>Alt kategori — ${sub}</h4>${gallery(sub, fabric, count)}</div>`;

const body = [
  '<h1>Demo 2027 · Koleksiyon model kartları</h1>',
  '<p class="bl-lead">Ana kategori: Kumaş · Alt kategori: Ürün tanımı. Her renk kaydı ayrı karttır.</p>',
  '<div class="bl-kpis"><div class="bl-kpi"><span class="bl-kpi-label">Toplam kart</span><span class="bl-kpi-value">16</span></div><div class="bl-kpi ok"><span class="bl-kpi-label">Sipariş geçildi</span><span class="bl-kpi-value">6</span></div></div>',
  `<section class="bl-section"><h3>Ana kategori — ${FABRIC_A}</h3><h4>Alt kategori — T-Shirt · 9 model kartı · tüm modeller bu sayfada</h4>${gallery('T-Shirt', FABRIC_A, 9)}<p class="bl-note">Kaynak: demo.csv. Aynı kumaşın Atlet alt kategorisi sonraki sayfada gösterilir.</p></section>`,
  `<section class="bl-section"><h2>Demo 2027 · Diğer alt kategoriler</h2><p class="bl-lead">Her alt kategorinin model kartları bölünmeden aynı sayfadadır.</p><div class="bl-grid">${pair('Atlet', FABRIC_A, 2)}${pair('T-Shirt', FABRIC_B, 1)}${pair('Şort', FABRIC_C, 3)}</div></section>`,
  '<section class="bl-section"><h3>Ana kategori — Kumaş alanı boş</h3><div class="bl-callout warn">Bu kayıtlarda kumaş değeri bulunmadığından kategori varsayılmamıştır.</div><div class="bl-grid"><div class="bl-card risk"><h3>Alt kategori — Şort</h3><p>DEMO.SHORT · Adet: 10000</p></div></div></section>',
].join('');

// Bağlam verisi (BL Image → satır): gruplama tespiti için.
const attributes = Object.fromEntries(records.map(r => [r.key, { Fabric: r.fabric, 'Product Main Definition': r.sub, Status: r.status, Renk: 'ECRU' }]));

module.exports = { body, attributes, records, FABRIC_A, FABRIC_B, FABRIC_C };
