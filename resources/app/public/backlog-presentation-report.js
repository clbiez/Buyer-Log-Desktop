/* Buyer Log — BACKLOG SUNUM RAPORU (HTML / PDF)
 *
 * Saf modül: DOM yok, fetch yok. Backlog V3 rapor modelinin (BLBacklogV3Report)
 * normalleştirilmiş satırlarından animasyonlu, tek dosyalık bir HTML raporu üretir.
 * Sayılar yalnız modelin summarize / groupBy / timeline / dataQuality
 * fonksiyonlarından gelir; ekrandaki Backlog ve Excel Backlog V3 ile ayrışmaz.
 *
 * Çıktı JS olmadan da tamdır: dinlenme hali son haldir, animasyonlar yalnız
 * başlangıç karesini tanımlar ve baskıda/azaltılmış harekette kapanır. Bu yüzden
 * aynı HTML hem uygulama içi izole iframe'de, hem indirilebilir dosya olarak,
 * hem de masaüstünün JS kapalı PDF penceresinde (buyerlog:render-pdf) çalışır.
 *
 * Harita noktaları: Natural Earth 50m kara verisi (kamu malı; world-atlas 2.0.2,
 * ISC) 1,55° ızgarada örneklenmiştir. Rotalar operasyonel yaklaşımdır.
 */
(function attachBacklogPresentationReport(root, factory) {
  const isNode = typeof module === 'object' && module.exports && typeof require === 'function';
  let v3 = root && root.BLBacklogV3Report;
  if (isNode) v3 = require('./backlog-v3-report.js');
  const api = factory(() => v3 || (root && root.BLBacklogV3Report));
  if (isNode) module.exports = api;
  if (root) root.BLBacklogPresentationReport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBacklogPresentationReport(V3) {
  'use strict';

  const LAND = Object.freeze({ cols:232, rows:86, lat0:78, enc:'13.2.7.1.b.4.8.w.l.2.1a.1.7.3.1c|13.1.1.3.2.2.2.3.4.1.4.2.e.p.1e.4.i.e.e.6.n|10.5.e.1.o.n.1c.3.f.1.2.f.1.1.e.1.2.1.p|z.4.1.4.1.3.2.4.1.1.2.2.1.3.1.2.e.l.1c.2.8.3.1.1.3.v.8.3.m|1.6e.1|b.f.3.2.1.6.3.9.2.3.1.2.3.2.4.6.8.1.1.h.r.a.a.1.7.3.2.3.1.1o.2.5.1|2.3h.f.2.2.2.f.1.1w|6.3a.e.1.3.1.i.2.1x|3.2.4.1i.3.8.8.8.b.6.g.7.2.6.2.1.1.2i|6.1.4.1b.c.2.1.1.9.6.w.7.2.2t.1|9.1b.8.1.1.4.e.5.u.8.3.2f.2.2.1.6.4|8.1.1.a.3.w.b.5.g.1.w.8.2.2.3.29.4.3.2.1.6|d.1.1.2.a.t.9.7.2.1.19.2.1.4.3.25.c.2.b|e.1.1.1.b.1.1.q.1.1.9.9.10.3.6.2.1.3.3.23.c.4.b|b.1.i.v.5.b.10.2.6.4.5.22.c.4.c|8.1.l.1.1.v.2.e.v.2.2.2.6.2c.a.3.d|x.u.2.f.u.2.1.4.2.2h.9.1.e|x.19.1.1.x.3.1.2i.1.1.n|z.1.1.z.3.1.2.2.z.2j.q|10.12.4.3.x.2k.q|11.14.12.l.1.1.3.7.2.1j.2.1.o|10.10.2.1.14.9.2.9.5.6.3.1j.3.1.o|10.y.14.8.5.2.2.7.8.5.2.1i.4.3.m|10.y.14.8.6.2.3.5.3.2.4.5.3.1d.w|10.w.16.6.2.1.2.1.4.1.2.2.2.f.2.17.2.3.8.1.p|11.v.16.6.a.1.3.2.1.e.4.15.5.2.7.1.p|11.u.19.3.3.1.1.3.2.1.4.1.3.f.1.18.3.2.6.2.p|12.t.19.1.2.8.8.2.4.1.1.1i.4.2.2.5.q|14.p.1a.c.g.1j.8.2.s|15.n.1a.g.3.2.7.1k.6.1.v|15.1.1.k.1b.i.1.1t.12|16.1.1.b.3.1.4.1.19.12.2.19.12|16.2.1.8.a.1.17.v.1.9.2.18.12|19.8.a.1.17.v.2.8.5.14.13|18.1.2.6.1h.x.1.9.2.2.6.x.14|1c.5.9.2.16.x.2.d.7.u.2.1.12|1c.5.5.2.5.1.13.z.1.d.7.b.3.a.1b|f.1.w.6.4.2.1a.y.2.b.a.8.5.8.2.2.18|1d.a.7.1.1.2.3.1.w.z.2.9.b.7.7.7.a.1.11|1g.7.1a.10.3.6.d.6.8.1.1.6.9.1.11|1k.6.17.11.2.5.f.4.b.7.7.1.12|1m.4.17.12.1.2.i.4.b.7.9.1.10|1o.2.7.1.z.13.k.3.f.4.7.1.2.1.z|1p.1.5.6.2.2.u.16.g.2.c.1.3.2.a.2.z|1q.1.1.2.1.a.u.16.g.1.d.1.g.1.z|1u.c.u.14.j.2.b.1.f.2.y|1u.f.t.7.2.s.y.1.9.1.14|1u.h.13.p.v.1.2.2.6.3.14|1u.h.13.o.x.1.1.2.5.4.14|1t.j.12.m.10.2.4.7.3.1.z|1s.l.11.l.11.3.3.6.6.1.x|1s.j.1.3.z.l.12.2.4.4.2.1.2.1.4.1.2.1.r|1s.r.w.j.14.2.6.1.2.2.2.1.4.7.n|1s.s.w.h.16.1.9.1.a.6.3.1.i|1s.t.v.h.17.2.1.1.e.1.2.6.l|1t.t.v.g.1a.3.f.4.1.1.6.1.e|1u.r.w.h.1f.1.2.1.e.2.6.1.c|1u.q.x.h.2i|1v.o.x.i.1m.4.3.1.o|1v.o.x.i.5.1.1d.1.1.4.4.2.n|1w.n.x.i.3.3.1c.8.3.3.m|1y.l.x.g.4.4.1b.b.1.3.m|1z.j.y.f.6.3.1a.g.m|1z.j.z.d.6.3.19.k.k|1z.i.10.e.5.3.16.n.b.1.8|1z.g.12.e.5.3.16.o.j|1z.e.15.c.7.1.17.p.i|1y.f.15.b.1g.q.h|1y.f.15.b.1h.p.h|1y.e.17.9.1i.p.h|1y.d.19.7.1j.p.h|1y.c.1a.6.1l.5.6.c.i|1y.8.1.2.1b.1.1q.2.a.1.1.8.j|1x.a.3j.7.f.1.3|1x.a.3j.6.k|1x.7.48.2.2|1w.8.49.1.2|1w.6.3s.1.f.2.4|1x.5.47.3.4|1x.4.47.2.6|1w.5.4f|1v.6.4f|1w.4.4g|1v.4.6.2.49|1w.1.2.1.2j.1.1w|1y.4.4e' });
  const VIEW = Object.freeze({ lon0:-20, lon1:135, lat0:64, lat1:-14, k:6 });
  const DEST = Object.freeze({ lon:28.97, lat:41.01 });
  /* Ülke → üretim merkezi koordinatı. names: katlanmış (aksansız, küçük harf) yazımlar. */
  const COUNTRIES = Object.freeze([
    { k:'TR', tr:'Türkiye', en:'Türkiye', lon:29.06, lat:40.19, mode:'road', names:['turkiye','turkey','tr','tur'] },
    { k:'BD', tr:'Bangladeş', en:'Bangladesh', lon:90.4, lat:23.8, mode:'sea', names:['banglades','bangladesh','bd','ban'] },
    { k:'CN', tr:'Çin', en:'China', lon:121.5, lat:31.2, mode:'sea', names:['cin','china','cn','chn','prc'] },
    { k:'IN', tr:'Hindistan', en:'India', lon:80.27, lat:13.08, mode:'sea', names:['hindistan','india','in','ind'] },
    { k:'PK', tr:'Pakistan', en:'Pakistan', lon:67.0, lat:24.86, mode:'sea', names:['pakistan','pk','pak'] },
    { k:'EG', tr:'Mısır', en:'Egypt', lon:29.92, lat:31.2, mode:'sea', names:['misir','egypt','eg','egy'] },
    { k:'UZ', tr:'Özbekistan', en:'Uzbekistan', lon:69.24, lat:41.3, mode:'road', names:['ozbekistan','uzbekistan','uz','uzb'] },
    { k:'VN', tr:'Vietnam', en:'Vietnam', lon:106.7, lat:10.8, mode:'sea', names:['vietnam','viet nam','vn','vnm'] },
    { k:'KH', tr:'Kamboçya', en:'Cambodia', lon:104.9, lat:11.56, mode:'sea', names:['kambocya','cambodia','kh','khm'] },
    { k:'LK', tr:'Sri Lanka', en:'Sri Lanka', lon:79.86, lat:6.93, mode:'sea', names:['sri lanka','srilanka','lk','lka'] },
    { k:'MA', tr:'Fas', en:'Morocco', lon:-7.6, lat:33.57, mode:'sea', names:['fas','morocco','maroc','ma','mar'] },
    { k:'TN', tr:'Tunus', en:'Tunisia', lon:10.18, lat:36.8, mode:'sea', names:['tunus','tunisia','tn','tun'] },
    { k:'ID', tr:'Endonezya', en:'Indonesia', lon:106.8, lat:-6.2, mode:'sea', names:['endonezya','indonesia','id','idn'] },
    { k:'MM', tr:'Myanmar', en:'Myanmar', lon:96.15, lat:16.84, mode:'sea', names:['myanmar','burma','mm','mmr'] },
    { k:'ET', tr:'Etiyopya', en:'Ethiopia', lon:38.74, lat:9.03, mode:'sea', names:['etiyopya','ethiopia','et','eth'] },
    { k:'GE', tr:'Gürcistan', en:'Georgia', lon:44.8, lat:41.7, mode:'road', names:['gurcistan','georgia','ge','geo'] },
    { k:'PT', tr:'Portekiz', en:'Portugal', lon:-8.6, lat:41.15, mode:'road', names:['portekiz','portugal','pt','prt'] },
    { k:'IT', tr:'İtalya', en:'Italy', lon:9.19, lat:45.46, mode:'road', names:['italya','italy','it','ita'] },
    { k:'JO', tr:'Ürdün', en:'Jordan', lon:35.9, lat:31.95, mode:'road', names:['urdun','jordan','jo','jor'] },
    { k:'BG', tr:'Bulgaristan', en:'Bulgaria', lon:23.3, lat:42.7, mode:'road', names:['bulgaristan','bulgaria','bg','bgr'] },
    { k:'RO', tr:'Romanya', en:'Romania', lon:26.1, lat:44.43, mode:'road', names:['romanya','romania','ro','rou'] },
    { k:'TM', tr:'Türkmenistan', en:'Turkmenistan', lon:58.38, lat:37.95, mode:'road', names:['turkmenistan','tm','tkm'] },
    { k:'KR', tr:'Güney Kore', en:'South Korea', lon:126.98, lat:37.57, mode:'sea', names:['guney kore','south korea','korea','kr','kor'] },
    { k:'TH', tr:'Tayland', en:'Thailand', lon:100.5, lat:13.75, mode:'sea', names:['tayland','thailand','th','tha'] },
    { k:'MY', tr:'Malezya', en:'Malaysia', lon:101.7, lat:3.14, mode:'sea', names:['malezya','malaysia','my','mys'] },
  ]);
  /* Asya'dan deniz yolu: Bab-el-Mendep → Süveyş → Ege → İstanbul. */
  const SUEZ_PATH = Object.freeze([[43.4, 12.6], [38.6, 20.5], [32.55, 29.9], [32.3, 31.3], [27.2, 36.1], [26.2, 39.4], [26.4, 40.1], [28.7, 40.97]]);
  /* Asya deniz yolu ara noktaları (doğudan batıya); çıkışa en yakın noktadan başlanır. */
  const ASIA_SEA = Object.freeze([[121, 25], [114, 15], [106.5, 5], [103.8, 1.3], [97, 5.5], [88, 14.5], [81, 5.6], [72, 8], [60, 11.6], [50, 12.5]]);
  const MED_PATH = Object.freeze([[25.5, 35.6], [26.2, 39.4], [26.4, 40.1], [28.7, 40.97]]);

  const fold = value => String(value == null ? '' : value).toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const NAME_INDEX = new Map();
  COUNTRIES.forEach(c => c.names.forEach(n => NAME_INDEX.set(n, c)));
  function countryOf(name) { return NAME_INDEX.get(fold(name)) || null; }

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  const round = n => Math.round(Number(n) || 0);
  function num(value, lang) { return round(value).toLocaleString(lang === 'en' ? 'en-US' : 'tr-TR'); }
  function share(part, total, lang) { if (!total) return '–'; const v = (part / total * 100); return lang === 'en' ? v.toFixed(1) + '%' : '%' + v.toFixed(1).replace('.', ','); }
  function compact(value, lang) {
    const v = Number(value) || 0;
    if (Math.abs(v) >= 1e6) return (v / 1e6).toLocaleString(lang === 'en' ? 'en-US' : 'tr-TR', { maximumFractionDigits:2 }) + (lang === 'en' ? 'M' : ' Mn');
    if (Math.abs(v) >= 1e4) return Math.round(v / 1e3).toLocaleString(lang === 'en' ? 'en-US' : 'tr-TR') + (lang === 'en' ? 'K' : ' B');
    return num(v, lang);
  }
  const DAY = 86400000;
  const ord = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY) : null; };
  const isoOf = o => new Date(o * DAY).toISOString().slice(0, 10);
  function todayIso(now) { const d = now instanceof Date ? now : new Date(now || Date.now()); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10); }
  function dayLabel(iso, lang) { const [y, m, d] = iso.split('-'); const months = lang === 'en' ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] : ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara']; return Number(d) + ' ' + months[Number(m) - 1]; }

  function stages() { return V3().STAGES; }
  function stageColor(key) { const s = stages().find(x => x.key === key); return '#' + (s ? s.color : '98A2B3'); }

  /* Zaman çubuğu yalnız V3'ün normalize edilmiş takvim günlerini kullanır.
     Hafta Pazartesi başlar; aradaki boş dönemler de seçilebilir. */
  function validDay(value) {
    const n = ord(value);
    return n != null && isoOf(n) === value ? n : null;
  }
  function timeDomain(items, field, unit) {
    const key = ['inStore', 'retail', 'exFactory'].includes(field) ? field : 'inStore';
    const mode = ['week', 'month', 'date'].includes(unit) ? unit : 'week';
    let min = Infinity, max = -Infinity, missing = 0;
    (items || []).forEach(it => {
      const n = validDay(it[key]);
      if (n == null) { missing++; return; }
      min = Math.min(min, n); max = Math.max(max, n);
    });
    if (!Number.isFinite(min)) return { field:key, unit:mode, min:'', max:'', count:0, missing };
    const startOf = n => mode === 'week' ? n - ((new Date(n * DAY).getUTCDay() + 6) % 7)
      : mode === 'month' ? ord(isoOf(n).slice(0, 7) + '-01') : n;
    min = startOf(min); max = startOf(max);
    const first = isoOf(min), last = isoOf(max);
    const count = mode === 'month' ? (+last.slice(0, 4) - +first.slice(0, 4)) * 12 + (+last.slice(5, 7) - +first.slice(5, 7)) + 1
      : (max - min) / (mode === 'week' ? 7 : 1) + 1;
    return { field:key, unit:mode, min:first, max:last, count, missing };
  }
  function timeBounds(domain, lo, hi) {
    if (!domain || !domain.count) return null;
    const clamp = n => Math.max(0, Math.min(domain.count - 1, Math.floor(Number(n) || 0)));
    const a = clamp(lo), b = Math.max(a, clamp(hi)), base = ord(domain.min);
    const at = i => domain.unit === 'month'
      ? Math.floor(Date.UTC(+domain.min.slice(0, 4), +domain.min.slice(5, 7) - 1 + i, 1) / DAY)
      : base + i * (domain.unit === 'week' ? 7 : 1);
    return { start:isoOf(at(a)), end:isoOf(at(b + 1) - 1) };
  }
  function filterTimeRange(items, selection) {
    const list = Array.isArray(items) ? items : [], s = selection || {};
    if (s.all) return list.slice();
    if (!['inStore', 'retail', 'exFactory'].includes(s.field)) return [];
    const start = validDay(s.start), end = validDay(s.end);
    if (start == null || end == null || start > end) return [];
    return list.filter(it => { const n = validDay(it[s.field]); return n != null && n >= start && n <= end; });
  }

  /* 30 günlük projeksiyon: bugünden itibaren günlük ve kümülatif adet. */
  const PRELOAD = new Set(['SHORTAGE', 'PRODUCTION', 'LOADING']);
  const ARRIVED = new Set(['IN_WAREHOUSE', 'AWAITING_RETAIL_TRANSFER']);
  function projection(items, today, days) {
    const t0 = ord(today), n = days || 30;
    const series = [
      { key:'exFactory', test:it => PRELOAD.has(it.stage) },
      { key:'antrepo', test:it => !ARRIVED.has(it.stage) },
      { key:'retail', test:() => true },
      { key:'inStore', test:() => true },
    ];
    const out = series.map(s => ({ key:s.key, daily:new Array(n).fill(0), cumulative:new Array(n).fill(0), total:0 }));
    (items || []).forEach(it => series.forEach((s, si) => {
      if (!s.test(it)) return;
      const o = ord(it[s.key]); if (o == null) return;
      const d = o - t0; if (d < 0 || d >= n) return;
      out[si].daily[d] += it.qty;
    }));
    out.forEach(s => { let c = 0; s.daily = s.daily.map(round); s.cumulative = s.daily.map(v => (c += v)); s.total = c; });
    return { start:today, days:n, series:out, dates:Array.from({ length:n }, (_, i) => isoOf(t0 + i)) };
  }

  function countries(items) {
    const map = new Map(), unknown = { name:'', qty:0, lines:0 };
    (items || []).forEach(it => {
      const c = countryOf(it.country);
      if (!c) { unknown.qty += it.qty; unknown.lines += 1; return; }
      if (!map.has(c.k)) map.set(c.k, { country:c, items:[], modes:new Map() });
      const g = map.get(c.k); g.items.push(it);
      const mode = /ucak|air|hava/.test(fold(it.deliveryType)) ? 'air' : /tir|truck|kara|road/.test(fold(it.deliveryType)) ? 'road' : '';
      if (mode) g.modes.set(mode, (g.modes.get(mode) || 0) + it.qty);
    });
    const list = [...map.values()].map(g => {
      const s = V3().summarize(g.items);
      const transit = s.stages.IN_TRANSIT + s.stages.CUSTOMS + s.stages.LOADING;
      const air = g.modes.get('air') || 0, road = g.modes.get('road') || 0;
      const mode = air > s.qty / 2 ? 'air' : road > s.qty / 2 ? 'road' : g.country.mode;
      return { ...g.country, qty:s.qty, lines:s.lines, transit, loadedPct:s.loadedPct, overdueQty:s.overdueQty, mode };
    }).sort((a, b) => b.qty - a.qty);
    return { list, unknown };
  }

  /* --------------------------------------------------------- SVG yardımcıları */
  const px = lon => (lon - VIEW.lon0) * VIEW.k, py = lat => (VIEW.lat0 - lat) * VIEW.k;
  const MAP_W = (VIEW.lon1 - VIEW.lon0) * VIEW.k, MAP_H = (VIEW.lat0 - VIEW.lat1) * VIEW.k;
  function landPath() {
    const step = 360 / LAND.cols, size = Math.max(1.2, step * VIEW.k * 0.56), off = size / 2;
    let d = '';
    LAND.enc.split('|').forEach((row, r) => {
      let c = 0, on = false;
      row.split('.').forEach(token => {
        const k = parseInt(token, 36);
        if (on) for (let j = 0; j < k; j++) {
          const lon = -180 + (c + j + 0.5) * step, lat = LAND.lat0 - (r + 0.5) * step;
          if (lon < VIEW.lon0 - 2 || lon > VIEW.lon1 + 2 || lat > VIEW.lat0 + 2 || lat < VIEW.lat1 - 2) continue;
          d += `M${(px(lon) - off).toFixed(1)} ${(py(lat) - off).toFixed(1)}h${size.toFixed(1)}v${size.toFixed(1)}h-${size.toFixed(1)}z`;
        }
        c += k; on = !on;
      });
    });
    return d;
  }
  function routePath(c) {
    const pts = [[c.lon, c.lat]];
    if (c.mode === 'sea' && c.lon > 45) {
      let start = 0, best = Infinity;
      ASIA_SEA.forEach((p, i) => { const d = Math.hypot(p[0] - c.lon, p[1] - c.lat); if (d < best) { best = d; start = i; } });
      pts.push(...ASIA_SEA.slice(start), ...SUEZ_PATH);
    }
    else if (c.mode === 'sea') { if (c.lon < 11) pts.push(...(c.lon < -5 ? [[-6.2, 35.9]] : []), [11.6, 37.6], [20.5, 35.4]); pts.push(...MED_PATH); }
    else pts.push([DEST.lon, DEST.lat]);
    if (c.mode === 'air') { const a = pts[0], mx = (a[0] + DEST.lon) / 2, my = Math.max(a[1], DEST.lat) + Math.abs(a[0] - DEST.lon) * 0.18; return `M${px(a[0]).toFixed(1)} ${py(a[1]).toFixed(1)}Q${px(mx).toFixed(1)} ${py(my).toFixed(1)} ${px(DEST.lon).toFixed(1)} ${py(DEST.lat).toFixed(1)}`; }
    return 'M' + pts.map(p => px(p[0]).toFixed(1) + ' ' + py(p[1]).toFixed(1)).join('L');
  }
  function donut(parts, size, width) {
    const r = (size - width) / 2, c = 2 * Math.PI * r, total = parts.reduce((t, p) => t + p.value, 0) || 1;
    let offset = 0;
    const segs = parts.filter(p => p.value > 0).map((p, i) => {
      const len = p.value / total * c, gap = parts.length > 1 ? 2 : 0;
      const el = `<circle class="arc" style="--i:${i}" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${p.color}" stroke-width="${width}" stroke-dasharray="${Math.max(0, len - gap).toFixed(2)} ${(c - len + gap).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"><title>${esc(p.title)}</title></circle>`;
      offset += len; return el;
    }).join('');
    return `<svg viewBox="0 0 ${size} ${size}" class="donut" role="img"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${width}"/>${segs}</svg>`;
  }

  /* -------------------------------------------------------------- raporu kur */
  function build(items, options) {
    const opts = options || {}, lang = opts.lang === 'en' ? 'en' : 'tr', L = (tr, en) => lang === 'en' ? en : tr;
    const today = opts.today || todayIso(opts.now);
    const list = Array.isArray(items) ? items : [];
    const s = V3().summarize(list);
    const st = s.stages;
    const STG = stages().filter(x => x.key !== 'UNKNOWN' || st.UNKNOWN > 0);
    const label = key => V3().stageLabel(key, lang);
    const transitQty = st.IN_TRANSIT + st.CUSTOMS;
    const warehouseQty = st.IN_WAREHOUSE + st.AWAITING_RETAIL_TRANSFER;
    const geo = countries(list);
    const proj = projection(list, today, 30);
    const quality = V3().dataQuality(list);
    const title = opts.title || L('Backlog sunum raporu', 'Backlog presentation report');
    const created = opts.createdLabel || today;
    const countN = (value, cls) => `<span class="${cls || ''}" data-count="${round(value)}">${esc(num(value, lang))}</span>`;

    /* 1 · Kahraman */
    const ringParts = STG.map(x => ({ value:st[x.key], color:'#' + x.color, title:`${label(x.key)} · ${num(st[x.key], lang)}` }));
    const hero = `<section class="sec hero" id="ozet">
      <div class="heroMain">
        <div class="eyebrow">${esc(L('Backlog · sunum raporu', 'Backlog · presentation report'))} · ${esc(created)}</div>
        <h1>${esc(L('Backlog nabzı', 'Backlog pulse'))}</h1>
        <div class="big">${countN(s.qty, 'num')}<small>${esc(L('adet açık backlog', 'units in open backlog'))}</small></div>
        <div class="chips"><span>${esc(num(s.orders, lang))} ${esc(L('sipariş', 'orders'))}</span><span>${esc(num(s.lines, lang))} ${esc(L('satır', 'lines'))}</span><span>${esc(num(geo.list.length, lang))} ${esc(L('ülke', 'countries'))}</span>${opts.scope ? `<span>${esc(opts.scope)}</span>` : ''}</div>
        <div class="kpis">
          ${kpi(L('Yüklendi', 'Loaded'), share(s.loadedQty, s.qty, lang), num(s.loadedQty, lang) + ' ' + L('adet', 'units'), 'good')}
          ${kpi(L('Ex-F geçti · yüklenmedi', 'Ex-F passed · not loaded'), num(s.overdueQty, lang), num(s.overdueLines, lang) + ' ' + L('satır', 'lines'), s.overdueQty ? 'bad' : '')}
          ${kpi(L('Yolda + gümrük', 'In transit + customs'), num(transitQty, lang), share(transitQty, s.qty, lang), '')}
          ${kpi(L('Riskli adet', 'At-risk qty'), num(s.riskQty, lang), L('Transit gecikmiş', 'Transit overdue') + ' ' + num(s.transitOverdueQty, lang), s.riskQty ? 'warn' : '')}
        </div>
      </div>
      <div class="heroRing">${donut(ringParts, 260, 26)}<div class="ringCenter"><b>${esc(share(s.loadedQty, s.qty, lang))}</b><span>${esc(L('yüklendi', 'loaded'))}</span></div>
        <ul class="legend">${STG.map(x => `<li><i style="background:#${x.color}"></i>${esc(label(x.key))}<b>${esc(share(st[x.key], s.qty, lang))}</b></li>`).join('')}</ul>
      </div>
    </section>`;
    function kpi(name, value, sub, tone) { return `<div class="kpi ${tone || ''}"><span>${esc(name)}</span><b>${esc(value)}</b><em>${esc(sub)}</em></div>`; }

    /* 2 · Operasyon akışı */
    const maxStage = Math.max(1, ...STG.map(x => st[x.key]));
    const flow = `<section class="sec" id="akis">
      <header><span class="n">01</span><h2>${esc(L('Siparişler ne durumda?', 'Where are the orders?'))}</h2><p>${esc(L('Operasyon aşamaları boru hattı sırasıyla: yüklenmemiş → yolda → depoda.', 'Operational stages in pipeline order: not loaded → in transit → in warehouse.'))}</p></header>
      <div class="flow">${STG.map((x, i) => `<div class="stage" style="--c:#${x.color};--i:${i}"><span>${esc(label(x.key))}</span>${countN(st[x.key], 'v')}<em>${esc(num(s.stageLines[x.key], lang))} ${esc(L('satır', 'lines'))} · ${esc(share(st[x.key], s.qty, lang))}</em><i class="bar"><i class="grow-x" style="width:${(st[x.key] / maxStage * 100).toFixed(1)}%"></i></i></div>`).join('')}</div>
      <div class="stack">${STG.filter(x => st[x.key] > 0).map((x, i) => `<i class="grow-x" style="--c:#${x.color};flex:${st[x.key]} 1 0;--i:${i}" title="${esc(label(x.key))} · ${esc(num(st[x.key], lang))}">${st[x.key] / (s.qty || 1) > 0.07 ? esc(share(st[x.key], s.qty, lang)) : ''}</i>`).join('')}</div>
    </section>`;

    /* 3 · Dünya haritası ve nakliye */
    const maxC = Math.max(1, ...geo.list.map(c => c.qty));
    const routes = geo.list.filter(c => c.k !== 'TR' || c.transit > 0).map((c, i) => {
      const d = routePath(c), color = c.mode === 'air' ? 'var(--chart-5)' : c.mode === 'road' ? 'var(--chart-4)' : 'var(--chart-1)';
      const ships = Math.min(4, Math.max(c.transit > 0 ? 1 : 0, Math.round(c.transit / Math.max(1, s.qty) * 30)));
      const dur = c.mode === 'air' ? 6 : c.mode === 'road' ? 9 : 16;
      return `<path class="route ${c.mode}" d="${d}" stroke="${color}" style="--i:${i}"><title>${esc(c[lang])} → İstanbul · ${esc(num(c.transit, lang))} ${esc(L('adet yolda', 'units in transit'))}</title></path>`
        + Array.from({ length:ships }, (_, j) => `<circle class="ship" r="4" fill="${color}"><animateMotion dur="${dur}s" begin="${(-j * dur / ships).toFixed(2)}s" repeatCount="indefinite" path="${d}" rotate="auto"/></circle>`).join('');
    }).join('');
    const hubs = geo.list.map((c, i) => {
      const r = 4 + Math.sqrt(c.qty / maxC) * 12;
      return `<g class="hub" style="--i:${i}"><circle class="pulse" cx="${px(c.lon).toFixed(1)}" cy="${py(c.lat).toFixed(1)}" r="${r.toFixed(1)}"/><circle cx="${px(c.lon).toFixed(1)}" cy="${py(c.lat).toFixed(1)}" r="${r.toFixed(1)}" class="dot"><title>${esc(c[lang])} · ${esc(num(c.qty, lang))} ${esc(L('adet', 'units'))}</title></circle><text x="${(px(c.lon) + r + 4).toFixed(1)}" y="${(py(c.lat) + 4).toFixed(1)}">${esc(c[lang])}</text></g>`;
    }).join('');
    const map = `<section class="sec" id="harita">
      <header><span class="n">02</span><h2>${esc(L('Dünya haritasında üretim ve nakliye', 'Production and shipping on the world map'))}</h2><p>${esc(L('Üretim ülkelerinden İstanbul\'a akış. Daire büyüklüğü backlog adedi, hareketli işaretler yoldaki yük.', 'Flow from production countries to Istanbul. Circle size is backlog quantity; moving markers are cargo in transit.'))}</p></header>
      <div class="mapGrid"><figure class="map"><svg viewBox="0 0 ${MAP_W.toFixed(0)} ${MAP_H.toFixed(0)}" role="img" aria-label="${esc(L('Üretim ve nakliye haritası', 'Production and shipping map'))}"><path class="land" d="${landPath()}"/>${routes}${hubs}<g class="dest"><circle class="pulse" cx="${px(DEST.lon).toFixed(1)}" cy="${py(DEST.lat).toFixed(1)}" r="9"/><circle cx="${px(DEST.lon).toFixed(1)}" cy="${py(DEST.lat).toFixed(1)}" r="5" class="destDot"/><text x="${(px(DEST.lon) - 6).toFixed(1)}" y="${(py(DEST.lat) - 12).toFixed(1)}" text-anchor="end">${esc(L('İstanbul · antrepo', 'Istanbul · warehouse'))}</text></g></svg>
        <figcaption><span><i style="background:var(--chart-1)"></i>${esc(L('Deniz', 'Sea'))}</span><span><i style="background:var(--chart-5)"></i>${esc(L('Hava', 'Air'))}</span><span><i style="background:var(--chart-4)"></i>${esc(L('Kara', 'Road'))}</span><em>${esc(L('Rotalar operasyonel yaklaşımdır; canlı GPS/AIS değildir.', 'Routes are operational approximations, not live GPS/AIS.'))}</em></figcaption></figure>
        <table class="tbl"><thead><tr><th>${esc(L('Ülke', 'Country'))}</th><th class="r">${esc(L('Adet', 'Qty'))}</th><th class="r">${esc(L('Yolda', 'In transit'))}</th><th class="r">${esc(L('Yüklendi', 'Loaded'))}</th></tr></thead><tbody>${geo.list.map(c => `<tr><td>${esc(c[lang])}</td><td class="r">${esc(num(c.qty, lang))}</td><td class="r">${esc(num(c.transit, lang))}</td><td class="r">${esc(c.loadedPct == null ? '–' : share(c.loadedPct, 1, lang))}</td></tr>`).join('')}${geo.unknown.qty ? `<tr class="muted"><td>${esc(L('Haritada olmayan / boş', 'Not on map / blank'))}</td><td class="r">${esc(num(geo.unknown.qty, lang))}</td><td></td><td></td></tr>` : ''}</tbody></table>
      </div>
    </section>`;

    /* 4 · 30 günlük projeksiyon */
    const P_SERIES = [
      { key:'exFactory', color:'var(--chart-1)', tr:'Ex-Factory (yüklenmesi beklenen)', en:'Ex-Factory (expected loads)' },
      { key:'antrepo', color:'var(--chart-3)', tr:'Antrepo girişi', en:'Warehouse arrival' },
      { key:'retail', color:'var(--chart-7)', tr:'Retail depo', en:'Retail warehouse' },
      { key:'inStore', color:'var(--chart-2)', tr:'In-Store', en:'In-Store' },
    ];
    const W = 900, H = 300, l = 60, r = 16, t = 16, b = 34, iw = W - l - r, ih = H - t - b;
    const maxP = niceMax(Math.max(1, ...proj.series.map(x => x.total)));
    const xs = i => l + i / (proj.days - 1) * iw, ys = v => t + ih - v / maxP * ih;
    let grid = '';
    for (let i = 0; i <= 4; i++) { const v = maxP * i / 4; grid += `<line x1="${l}" x2="${W - r}" y1="${ys(v).toFixed(1)}" y2="${ys(v).toFixed(1)}" class="gl"/><text x="${l - 8}" y="${(ys(v) + 4).toFixed(1)}" text-anchor="end">${esc(compact(v, lang))}</text>`; }
    proj.dates.forEach((d, i) => { if (i % 5 === 0 || i === proj.days - 1) grid += `<text x="${xs(i).toFixed(1)}" y="${H - 10}" text-anchor="middle">${esc(dayLabel(d, lang))}</text>`; });
    const lines = P_SERIES.map((p, i) => {
      const ser = proj.series.find(x => x.key === p.key);
      const pts = ser.cumulative.map((v, j) => xs(j).toFixed(1) + ' ' + ys(v).toFixed(1));
      return `<path class="area" d="M${pts.join('L')}L${xs(proj.days - 1).toFixed(1)} ${ys(0).toFixed(1)}L${xs(0).toFixed(1)} ${ys(0).toFixed(1)}Z" fill="${p.color}"/><path class="draw" style="--i:${i}" pathLength="1" d="M${pts.join('L')}" stroke="${p.color}"/><circle cx="${xs(proj.days - 1).toFixed(1)}" cy="${ys(ser.total).toFixed(1)}" r="4" fill="${p.color}"><title>${esc(L(p.tr, p.en))} · ${esc(num(ser.total, lang))}</title></circle>`;
    }).join('');
    const weeks = [];
    for (let w = 0; w < 5; w++) {
      const from = w * 7, to = Math.min(proj.days, from + 7);
      if (from >= proj.days) break;
      weeks.push({ label:dayLabel(proj.dates[from], lang) + ' – ' + dayLabel(proj.dates[to - 1], lang), vals:P_SERIES.map(p => proj.series.find(x => x.key === p.key).daily.slice(from, to).reduce((a, v) => a + v, 0)) });
    }
    const projection30 = `<section class="sec" id="projeksiyon">
      <header><span class="n">03</span><h2>${esc(L('30 günlük projeksiyon', '30-day projection'))}</h2><p>${esc(L(`${dayLabel(proj.dates[0], lang)} – ${dayLabel(proj.dates[proj.days - 1], lang)} arasında tarihlere göre beklenen akış (kümülatif adet).`, `Expected flow by date between ${dayLabel(proj.dates[0], lang)} and ${dayLabel(proj.dates[proj.days - 1], lang)} (cumulative units).`))}</p></header>
      <div class="projGrid"><figure class="chart"><ul class="legend row">${P_SERIES.map(p => `<li><i style="background:${p.color}"></i>${esc(L(p.tr, p.en))}<b>${esc(num(proj.series.find(x => x.key === p.key).total, lang))}</b></li>`).join('')}</ul>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(L('30 günlük kümülatif projeksiyon', '30-day cumulative projection'))}">${grid}<line x1="${xs(0)}" x2="${xs(0)}" y1="${t}" y2="${t + ih}" class="today"/><text x="${xs(0) + 5}" y="${t + 12}" class="todayLabel">${esc(L('Bugün', 'Today'))}</text>${lines}</svg></figure>
        <table class="tbl"><thead><tr><th>${esc(L('Hafta', 'Week'))}</th>${P_SERIES.map(p => `<th class="r" title="${esc(L(p.tr, p.en))}"><i class="sw" style="background:${p.color}"></i></th>`).join('')}</tr></thead><tbody>${weeks.map(w => `<tr><td>${esc(w.label)}</td>${w.vals.map(v => `<td class="r">${esc(compact(v, lang))}</td>`).join('')}</tr>`).join('')}</tbody></table>
      </div>
    </section>`;
    function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }

    /* 5 · Mozaik: ne kadar ürün ne aşamada */
    const CELLS = 200, raw = STG.map(x => ({ key:x.key, color:x.color, exact:st[x.key] / (s.qty || 1) * CELLS }));
    raw.forEach(x => { x.cells = Math.floor(x.exact); });
    let rest = CELLS - raw.reduce((a, x) => a + x.cells, 0);
    [...raw].sort((a, b2) => (b2.exact - b2.cells) - (a.exact - a.cells)).forEach(x => { if (rest > 0 && x.exact > 0) { x.cells += 1; rest -= 1; } });
    let cellIndex = 0;
    const cells = s.qty ? raw.map(x => Array.from({ length:x.cells }, () => `<i style="--c:#${x.color};--i:${cellIndex++}" title="${esc(label(x.key))}"></i>`).join('')).join('') : '';
    const unit = Math.round((s.qty || 0) / CELLS);
    const mosaic = `<section class="sec" id="mozaik">
      <header><span class="n">04</span><h2>${esc(L('Ne kadar ürün ne aşamada?', 'How many units at which stage?'))}</h2><p>${esc(L(`Her kare yaklaşık ${num(unit, lang)} adet.`, `Each square is about ${num(unit, lang)} units.`))}</p></header>
      <div class="mosaicGrid"><div class="waffle">${cells}</div><ul class="legend">${raw.filter(x => x.cells).map(x => `<li><i style="background:#${x.color}"></i>${esc(label(x.key))}<b>${esc(num(st[x.key], lang))}</b></li>`).join('')}</ul></div>
    </section>`;

    /* 6 · Kırılımlar */
    const DIMS = [['buyer', L('Buyer', 'Buyer')], ['manufacturer', L('Üretici', 'Manufacturer')], ['season', L('Sezon', 'Season')], ['category', L('Kategori', 'Category')]];
    const breakdown = `<section class="sec" id="kirilim">
      <header><span class="n">05</span><h2>${esc(L('Kim, nerede, ne kadar?', 'Who, where, how much?'))}</h2><p>${esc(L('İlk 8 grup; çubuk renkleri operasyon aşamalarıdır.', 'Top 8 groups; bar colours are operational stages.'))}</p></header>
      <div class="dims">${DIMS.map(([key, name]) => {
        const groups = V3().groupBy(list, key, { limit:8, blank:L('(boş)', '(blank)') });
        const max = Math.max(1, ...groups.map(g => g.qty));
        return `<div class="dim"><h3>${esc(name)}</h3>${groups.map((g, gi) => `<div class="hb"><span class="nm" title="${esc(g.name)}">${esc(g.name)}</span><span class="bb grow-x" style="width:${(g.qty / max * 100).toFixed(1)}%;--i:${gi}">${STG.filter(x => g.stages[x.key] > 0).map(x => `<i style="--c:#${x.color};flex:${g.stages[x.key]} 1 0" title="${esc(label(x.key))} · ${esc(num(g.stages[x.key], lang))}"></i>`).join('')}</span><b>${esc(compact(g.qty, lang))}</b></div>`).join('')}</div>`;
      }).join('')}</div>
    </section>`;

    /* 7 · Haftalık akış (Ex-Factory haftası) */
    const tl = V3().timeline(list, 'exFactory', { granularity:'week', lang, today });
    const ti = Math.max(0, tl.findIndex(w => !w.past));
    const window16 = tl.slice(Math.max(0, ti - 6), Math.max(0, ti - 6) + 16);
    const maxW = niceMax(Math.max(1, ...window16.map(w => w.qty)));
    const WW = 900, WH = 280, wl = 56, wb = 40, wt = 24, wiw = WW - wl - 10, wih = WH - wt - wb, bw = wiw / Math.max(1, window16.length);
    let wbars = '';
    for (let i = 0; i <= 4; i++) { const v = maxW * i / 4, y = wt + wih - v / maxW * wih; wbars += `<line x1="${wl}" x2="${WW - 10}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="gl"/><text x="${wl - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${esc(compact(v, lang))}</text>`; }
    window16.forEach((w, i) => {
      let acc = 0; const x = wl + i * bw;
      const segs = STG.filter(x2 => w.stages[x2.key] > 0).map(x2 => { const h = w.stages[x2.key] / maxW * wih, y = wt + wih - acc / maxW * wih - h; acc += w.stages[x2.key]; return `<rect x="${(x + bw * 0.18).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${Math.max(0, h - 1).toFixed(1)}" fill="#${x2.color}"><title>${esc(w.label)} · ${esc(label(x2.key))} · ${esc(num(w.stages[x2.key], lang))}</title></rect>`; }).join('');
      const current = !w.past && (i === 0 || window16[i - 1].past);
      wbars += (current ? `<rect x="${(x + 2).toFixed(1)}" y="${wt - 18}" width="${(bw - 4).toFixed(1)}" height="${wih + 18}" class="nowBand"/>` : '') + `<g class="grow-y" style="--i:${i}">${segs}</g>`;
      if (w.overdueQty) wbars += `<text x="${(x + bw / 2).toFixed(1)}" y="${(wt + wih - acc / maxW * wih - 5).toFixed(1)}" text-anchor="middle" class="late">${esc(compact(w.overdueQty, lang))}</text>`;
      wbars += `<text x="${(x + bw / 2).toFixed(1)}" y="${WH - 22}" text-anchor="middle"${current ? ' class="nowLabel"' : ''}>${esc(String(w.label).split(' · ')[0])}</text>`;
    });
    const weekly = `<section class="sec" id="haftalik">
      <header><span class="n">06</span><h2>${esc(L('Ex-Factory haftasına göre akış', 'Flow by Ex-Factory week'))}</h2><p>${esc(L('Kırmızı sayı: Ex-F tarihi geçmiş ama yüklenmemiş adet.', 'Red figure: units past Ex-F but not loaded.'))}</p></header>
      <figure class="chart"><svg viewBox="0 0 ${WW} ${WH}" role="img" aria-label="${esc(L('Haftalık akış', 'Weekly flow'))}">${wbars}</svg><ul class="legend row">${STG.map(x => `<li><i style="background:#${x.color}"></i>${esc(label(x.key))}</li>`).join('')}</ul></figure>
    </section>`;

    /* 8 · Aksiyonlar */
    const actionRow = (it, why, tone) => `<li class="${tone}"><div><b>${esc(it.orderCode || '–')}</b> ${esc(it.modelName || '')}<span>${esc([it.manufacturer, it.country].filter(Boolean).join(' · '))}</span></div><div class="r"><b>${esc(num(it.qty, lang))}</b><span>${esc(why)}</span></div></li>`;
    const overdue = list.filter(it => it.overdueNotLoaded).sort((a, b2) => b2.overdueDays - a.overdueDays || b2.qty - a.qty).slice(0, 8);
    const transitLate = list.filter(it => it.transitOverdue).sort((a, b2) => b2.qty - a.qty).slice(0, 8);
    const risky = list.filter(it => it.risk && !it.overdueNotLoaded).sort((a, b2) => b2.qty - a.qty).slice(0, 8);
    const empty = `<li class="none">${esc(L('Kayıt yok.', 'No records.'))}</li>`;
    const actions = `<section class="sec" id="aksiyon">
      <header><span class="n">07</span><h2>${esc(L('Aksiyon gerekenler', 'Needs action'))}</h2></header>
      <div class="acts">
        <div><h3>${esc(L('Ex-F geçti · yüklenmedi', 'Ex-F passed · not loaded'))}<em>${esc(num(s.overdueLines, lang))}</em></h3><ul>${overdue.map(it => actionRow(it, L(`${it.overdueDays} gün geçti`, `${it.overdueDays} days late`), 'bad')).join('') || empty}</ul></div>
        <div><h3>${esc(L('Transit gecikmiş', 'Transit overdue'))}<em>${esc(num(transitLate.length, lang))}</em></h3><ul>${transitLate.map(it => actionRow(it, label(it.stage), 'warn')).join('') || empty}</ul></div>
        <div><h3>${esc(L('Riskli', 'At risk'))}<em>${esc(num(risky.length, lang))}</em></h3><ul>${risky.map(it => actionRow(it, it.exFactory ? 'Ex-F ' + dayLabel(it.exFactory, lang) : label(it.stage), 'warn')).join('') || empty}</ul></div>
      </div>
    </section>`;

    /* 9 · Veri kalitesi */
    const qualitySec = `<section class="sec" id="kalite">
      <header><span class="n">08</span><h2>${esc(L('Veri kalitesi', 'Data quality'))}</h2><p>${esc(L('Excel Backlog V3 › Veri Kalitesi sayfasıyla aynı kontroller.', 'Same checks as the Excel Backlog V3 › Data Quality sheet.'))}</p></header>
      ${quality.length ? `<ul class="dq">${quality.map(q => `<li><b>${esc(num(q.count, lang))}</b><span>${esc(lang === 'en' ? q.en : q.tr)}</span><em>${esc(num(q.qty, lang))} ${esc(L('adet', 'units'))}</em></li>`).join('')}</ul>` : `<p class="ok">${esc(L('Kontrollerin hepsi temiz.', 'All checks are clean.'))}</p>`}
    </section>`;

    const nav = [['ozet', L('Özet', 'Summary')], ['akis', L('Akış', 'Flow')], ['harita', L('Harita', 'Map')], ['projeksiyon', L('Projeksiyon', 'Projection')], ['mozaik', L('Aşamalar', 'Stages')], ['kirilim', L('Kırılım', 'Breakdown')], ['haftalik', L('Haftalık', 'Weekly')], ['aksiyon', L('Aksiyon', 'Actions')], ['kalite', L('Kalite', 'Quality')]];
    const fonts = (opts.fonts || []).map(f => `@font-face{font-family:"${esc(f.family)}";font-weight:${Number(f.weight) || 400};font-style:normal;font-display:swap;src:url(${f.dataUrl}) format("woff2")}`).join('');
    const body = `<div class="top"><div class="brand"><span class="mark">BL</span><b>${esc(title)}</b><small>${esc(created)}${opts.scope ? ' · ' + esc(opts.scope) : ''}</small></div><nav>${nav.map(([id, name]) => `<a href="#${id}">${esc(name)}</a>`).join('')}</nav></div>
      <main>${hero}${flow}${map}${projection30}${mosaic}${breakdown}${weekly}${actions}${qualitySec}
      <footer>${esc(L('Buyer Log · Backlog V3 rapor modeli. Sayılar ekrandaki Backlog ve Excel Backlog V3 ile aynı toplulaştırmadan gelir.', 'Buyer Log · Backlog V3 report model. Figures come from the same aggregation as the on-screen Backlog and Excel Backlog V3.'))}</footer></main>`;
    return `<!doctype html><html lang="${lang}" data-theme="${opts.theme === 'dark' ? 'dark' : 'light'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:"><title>${esc(title)}</title><style>${fonts}${REPORT_CSS}</style></head><body>${body}<script>${REPORT_SCRIPT}</script></body></html>`;
  }

  const REPORT_CSS = `
:root{--paper:#f2f4f6;--card:#fff;--card2:#f6f7f9;--ink:#16212d;--ink2:#374454;--muted:#627184;--line:#dfe3e8;--line2:#c9cfd6;--acc:#356a96;--acc-bg:#eaf2f8;--good:#177a4c;--warn:#946200;--bad:#b42318;--land:#c9d3de;
--chart-1:#2a78d6;--chart-2:#eb6834;--chart-3:#1baf7a;--chart-4:#eda100;--chart-5:#e87ba4;--chart-6:#008300;--chart-7:#6250d6;--chart-8:#e34948;
--sans:"Barlow","Segoe UI",system-ui,Arial,sans-serif;--mono:"Cascadia Code",ui-monospace,Consolas,monospace;color-scheme:light}
html[data-theme="dark"]{--paper:#171c22;--card:#20262e;--card2:#252d36;--ink:#f0f3f6;--ink2:#bdc8d4;--muted:#a0adba;--line:#343e49;--line2:#485563;--acc:#8fbfe8;--acc-bg:#294056;--good:#7cd58c;--warn:#f0b44c;--bad:#ef7b6e;--land:#3a4756;
--chart-1:#3987e5;--chart-2:#d95926;--chart-3:#199e70;--chart-4:#c98500;--chart-5:#d55181;--chart-6:#008300;--chart-7:#9085e9;--chart-8:#e66767;color-scheme:dark}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:400 14px/1.45 var(--sans);-webkit-font-smoothing:antialiased}
.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:10px 24px;background:color-mix(in srgb,var(--card) 90%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:baseline;gap:10px;min-width:0}.brand .mark{align-self:center;width:28px;height:28px;display:grid;place-items:center;background:var(--acc);color:var(--card);font:700 12px var(--sans)}
.brand b{font-size:16px}.brand small{color:var(--muted);font-size:12px}
nav{display:flex;gap:2px;flex-wrap:wrap;margin-left:auto}nav a{color:var(--ink2);text-decoration:none;font-size:12.5px;font-weight:600;padding:5px 9px;border-bottom:2px solid transparent}nav a:hover{color:var(--acc);border-bottom-color:var(--acc)}
main{max-width:1240px;margin:0 auto;padding:20px 24px 48px}
.sec{background:var(--card);border:1px solid var(--line);padding:20px 22px;margin-top:16px;break-inside:avoid;scroll-margin-top:64px}
.sec>header{display:grid;grid-template-columns:auto 1fr;column-gap:12px;align-items:baseline;margin-bottom:14px}
.sec>header .n{font:500 12px var(--mono);color:var(--acc)}.sec>header h2{margin:0;font-size:24px;line-height:1.1}.sec>header p{grid-column:2;margin:4px 0 0;color:var(--ink2);max-width:72ch}
.hero{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:24px;align-items:center;margin-top:0;position:relative;overflow:hidden}
.hero::before{content:"";position:absolute;inset:-30%;background:radial-gradient(35% 30% at 18% 25%,color-mix(in srgb,var(--chart-1) 16%,transparent),transparent 70%),radial-gradient(30% 28% at 70% 70%,color-mix(in srgb,var(--chart-7) 12%,transparent),transparent 70%);animation:drift 18s ease-in-out infinite alternate;pointer-events:none}
.hero>*{position:relative}
.eyebrow{font:500 11px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--acc)}
.hero h1{margin:8px 0 2px;font-size:44px;line-height:1}
.big{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;font-size:64px;font-weight:700;line-height:1;margin-top:10px;font-variant-numeric:tabular-nums}.big small{font-size:16px;font-weight:500;color:var(--ink2)}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.chips span{border:1px solid var(--line2);padding:2px 9px;font-size:12px;color:var(--ink2)}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:18px}
.kpi{border:1px solid var(--line);background:var(--card2);padding:10px 12px;display:grid;gap:2px}.kpi span{font-size:11.5px;font-weight:600;color:var(--ink2)}.kpi b{font-size:24px;font-variant-numeric:tabular-nums}.kpi em{font-style:normal;font-size:11.5px;color:var(--muted)}
.kpi.good b{color:var(--good)}.kpi.bad b{color:var(--bad)}.kpi.warn b{color:var(--warn)}
.heroRing{display:grid;justify-items:center;gap:12px;position:relative}.donut{width:min(100%,260px);height:auto}
.ringCenter{position:absolute;top:0;width:260px;max-width:100%;aspect-ratio:1;display:grid;place-content:center;text-align:center;pointer-events:none}.ringCenter b{font-size:34px}.ringCenter span{color:var(--muted);font-size:12px}
.legend{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 16px;width:100%;font-size:12.5px;color:var(--ink2)}
.legend.row{display:flex;flex-wrap:wrap;gap:6px 16px;margin-bottom:8px}.legend li{display:flex;align-items:center;gap:7px}.legend i,.sw{width:10px;height:10px;display:inline-block;flex:none}.legend b{margin-left:auto;color:var(--ink);font-variant-numeric:tabular-nums}.legend.row b{margin-left:4px}
.flow{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
.stage{border:1px solid var(--line);border-top:3px solid var(--c);padding:10px;display:grid;gap:3px;background:var(--card)}.stage span{font-size:12px;color:var(--ink2);min-height:2.4em}.stage .v{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}.stage em{font-style:normal;font-size:11.5px;color:var(--muted)}
.bar{display:block;height:4px;background:var(--line);margin-top:6px}.bar>i{display:block;height:100%;background:var(--c)}
.stack{display:flex;height:30px;gap:2px;margin-top:14px;background:var(--line)}.stack>i{display:grid;place-items:center;background:var(--c);background-image:repeating-linear-gradient(115deg,rgba(255,255,255,.14) 0 8px,transparent 8px 16px);background-size:40px 100%;animation:stripe 2s linear infinite;font:600 11px var(--mono);color:#0b1016;overflow:hidden;white-space:nowrap}
.mapGrid,.projGrid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px;align-items:start}
.map{margin:0;border:1px solid var(--line);background:color-mix(in srgb,var(--acc-bg) 55%,var(--card))}.map svg{display:block;width:100%;height:auto}
.land{fill:var(--land)}.route{fill:none;stroke-width:2;stroke-linecap:round;opacity:.85;stroke-dasharray:6 6;animation:flowdash 1.6s linear infinite}.route.sea{stroke-dasharray:none;opacity:.7}.route.air{stroke-dasharray:3 5}
.hub .dot{fill:color-mix(in srgb,var(--chart-7) 70%,var(--card));stroke:var(--card);stroke-width:1.5}.hub .pulse,.dest .pulse{fill:none;stroke:var(--chart-7);stroke-width:1.5;transform-box:fill-box;transform-origin:center;animation:pulse 2.4s ease-out infinite;animation-delay:calc(var(--i,0)*.3s)}
.dest .pulse{stroke:var(--acc)}.destDot{fill:var(--acc);stroke:var(--card);stroke-width:2}
.map text,.chart text{fill:var(--ink2);font:600 11px var(--sans)}.map text{paint-order:stroke;stroke:var(--card);stroke-width:3px}
.ship{stroke:var(--card);stroke-width:1.5}
figcaption{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;padding:8px 12px;font-size:12px;color:var(--ink2);border-top:1px solid var(--line)}figcaption i{width:14px;height:3px;display:inline-block;margin-right:6px;vertical-align:middle}figcaption em{margin-left:auto;font-style:normal;color:var(--muted);font-size:11px}
.tbl{width:100%;border-collapse:collapse;font-size:12.5px}.tbl th{text-align:left;font-weight:600;color:var(--ink2);border-bottom:1px solid var(--line2);padding:6px 8px;font-size:11.5px}.tbl td{border-bottom:1px solid var(--line);padding:6px 8px;font-variant-numeric:tabular-nums}.tbl .r{text-align:right}.tbl tr.muted td{color:var(--muted)}
.chart{margin:0}.chart svg{display:block;width:100%;height:auto}.gl{stroke:var(--line);stroke-width:1}.today{stroke:var(--acc);stroke-width:1.5;stroke-dasharray:3 3}.todayLabel,.nowLabel{fill:var(--acc)!important}
.area{opacity:.07}.draw{fill:none;stroke-width:2.4;stroke-linejoin:round}
.nowBand{fill:var(--acc);opacity:.07}.late{fill:var(--bad)!important;font:700 11px var(--mono)!important}
.mosaicGrid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:20px;align-items:center}
.mosaicGrid .legend{grid-template-columns:1fr}
.waffle{display:grid;grid-template-columns:repeat(25,minmax(0,1fr));gap:3px}.waffle i{display:block;aspect-ratio:1;background:var(--c)}
.dims{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 26px}.dim h3{margin:0 0 6px;font-size:14px}
.hb{display:grid;grid-template-columns:minmax(0,150px) minmax(0,1fr) 64px;gap:10px;align-items:center;padding:4px 0;border-bottom:1px dashed var(--line);font-size:12.5px}.hb .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bb{display:flex;height:14px;gap:1px}.bb i{display:block;height:100%;background:var(--c)}.hb b{text-align:right;font-variant-numeric:tabular-nums}
.acts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.acts h3{display:flex;justify-content:space-between;margin:0 0 6px;font-size:14px}.acts h3 em{font-style:normal;font:600 12px var(--mono);color:var(--muted)}
.acts ul{list-style:none;margin:0;padding:0;display:grid;gap:5px}.acts li{display:flex;justify-content:space-between;gap:10px;padding:7px 9px;border:1px solid var(--line);border-left:3px solid var(--muted);font-size:12.5px}
.acts li.bad{border-left-color:var(--bad)}.acts li.warn{border-left-color:var(--warn)}.acts li span{display:block;color:var(--muted);font-size:11.5px}.acts li .r{text-align:right;white-space:nowrap}.acts li.none{color:var(--muted);border-left-color:var(--line)}
.dq{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px}.dq li{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;border:1px solid var(--line);padding:9px 11px}.dq b{grid-row:span 2;font-size:22px;color:var(--warn)}.dq em{font-style:normal;color:var(--muted);font-size:12px}.ok{color:var(--good);font-weight:600}
footer{margin-top:18px;color:var(--muted);font-size:12px}
@keyframes drift{to{transform:translate(4%,-3%) scale(1.06)}}@keyframes stripe{to{background-position:40px 0}}@keyframes flowdash{to{stroke-dashoffset:-24}}
@keyframes pulse{0%{transform:scale(1);opacity:.9}100%{transform:scale(2.6);opacity:0}}
@keyframes growX{from{transform:scaleX(0)}}@keyframes growY{from{transform:scaleY(0)}}@keyframes draw{from{stroke-dashoffset:1}}@keyframes arc{from{stroke-dasharray:0 2000}}@keyframes pop{from{transform:scale(0);opacity:0}}@keyframes rise{from{transform:translateY(14px);opacity:0}}
.grow-x{transform-origin:0 50%;animation:growX .9s cubic-bezier(.2,.9,.2,1) both;animation-delay:calc(var(--i,0)*60ms)}
.grow-y{transform-box:fill-box;transform-origin:50% 100%;animation:growY .9s cubic-bezier(.2,.9,.25,1.1) both;animation-delay:calc(var(--i,0)*40ms)}
.draw{stroke-dasharray:1;animation:draw 1.8s cubic-bezier(.4,.1,.2,1) both;animation-delay:calc(var(--i,0)*160ms)}
.arc{animation:arc 1.3s cubic-bezier(.5,0,.2,1) both;animation-delay:calc(var(--i,0)*110ms)}
.waffle i{animation:pop .5s cubic-bezier(.3,1.5,.5,1) both;animation-delay:calc(var(--i,0)*6ms)}
.stage,.kpi,.dim,.acts>div{animation:rise .6s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i,0)*60ms)}
@media (max-width:900px){.hero,.mapGrid,.projGrid,.mosaicGrid{grid-template-columns:1fr}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.dims,.acts{grid-template-columns:1fr}.big{font-size:48px}}
@media (prefers-reduced-motion:reduce){*,*::before{animation:none!important}.ship{display:none}}
@page{size:A4 landscape;margin:10mm}
@media print{html{--paper:#fff}*,*::before{animation:none!important}.top{position:static;backdrop-filter:none}nav{display:none}.ship,.pulse{display:none}.sec{break-inside:avoid;margin-top:8px}main{padding:0}.hero::before{display:none}}
`;

  /* Yalnız etkileşim: sayaçlar ve görünür olunca yeniden oynatma. JS kapalıyken rapor tamdır. */
  const REPORT_SCRIPT = `(function(){'use strict';
if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)return;
var lang=document.documentElement.lang==='en'?'en-US':'tr-TR';
document.querySelectorAll('[data-count]').forEach(function(el){var to=Number(el.getAttribute('data-count'))||0,orig=el.textContent,t0=0;if(!to)return;
function f(t){if(!t0)t0=t;var p=Math.min(1,(t-t0)/1200),e=1-Math.pow(1-p,4);el.textContent=Math.round(to*e).toLocaleString(lang);if(p<1)requestAnimationFrame(f);else el.textContent=orig;}requestAnimationFrame(f);});
})();`;

  return Object.freeze({ build, projection, countries, countryOf, COUNTRIES, landPath, fold, timeDomain, timeBounds, filterTimeRange });
});
