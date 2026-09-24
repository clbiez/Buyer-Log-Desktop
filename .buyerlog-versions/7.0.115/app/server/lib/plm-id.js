'use strict';

/* PLM ID normalizasyonu. Daha önce server/lib/plm-technical-sheets.js içinde
   yaşıyordu; TP/TF çekme modülleri kaldırılınca (bu işlev onlara özgü
   olmadığı, PLM Sync ve style-link akışları da kullandığı için) buraya
   taşındı. Davranış BİREBİR korunmuştur. */
function clean(value) { return String(value == null ? '' : value).trim(); }

function normalizePlmId(value) {
  let text = clean(value).replace(/^_+/, '').replace(/\.(?=\d{3}(?:\D|$))/g, '');
  if (/^\d+\.0+$/.test(text)) text = text.slice(0, text.indexOf('.'));
  text = text.replace(/^0+(?=\d)/, '');
  return /^\d+$/.test(text) && Number(text) > 0 ? text : '';
}

module.exports = { clean, normalizePlmId };
