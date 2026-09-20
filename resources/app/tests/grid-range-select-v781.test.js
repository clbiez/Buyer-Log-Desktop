'use strict';

/* Shift ile satır aralığı seçimi (CP, Siparişler, Koleksiyon).
 *
 * Kullanıcı talebi: "Tabloların sol başındaki tik tek tek seçmenin yanı sıra
 * shift ile belirli satır aralıklarını çoklu seçebilsin."
 *
 * TASARIM KARARI (bu testlerin koruduğu şey): üç tablo seçim defterini üç
 * ayrı yerde tutuyor — Siparişler tbody üzerinde devredilmiş 'change'
 * dinleyicisi (tbody._chkMeta), CP satır başına dinleyici, Koleksiyon kendi
 * kolSelected kümesi. Modül bu defterlerin hiçbirini çoğaltmaz: aralıktaki
 * kutuların durumunu değiştirip her birine 'change' gönderir, defteri
 * tablonun kendi mevcut dinleyicisi tutar. Testler bu yüzden gönderilen
 * 'change' olaylarını da sayar — kopyalanmış bir seçim mantığı olsaydı bu
 * olaylar hiç doğmazdı.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const RangeSelect = require(path.join(__dirname, '..', 'public', 'grid-range-select.js'));

/* --- küçük sahte DOM: modülün gerçekten dokunduğu yüzey kadar --- */
function makeBody(spec) {
  const tbody = { nodeType: 1, tagName: 'TBODY', boxes: [] };

  function build(list) {
    tbody.boxes.length = 0;
    list.forEach((s) => {
      const box = {
        nodeType: 1,
        tagName: 'INPUT',
        type: 'checkbox',
        checked: !!s.checked,
        disabled: !!s.disabled,
        dataset: { id: String(s.id) },
        classList: { contains: (c) => c === 'rowChk' },
        closest: (sel) => (sel === 'tbody' ? tbody : null),
        changes: 0,
      };
      box.dispatchEvent = (event) => {
        if (event && event.type === 'change') box.changes++;
        return true;
      };
      tbody.boxes.push(box);
    });
  }

  build(spec);
  tbody.querySelectorAll = () => tbody.boxes;
  /* Tablolar tbody'yi innerHTML ile yeniden kuruyor: aynı tbody, yeni kutular. */
  tbody.rerender = build;
  return tbody;
}

const ids = (tbody) => tbody.boxes.filter((b) => b.checked).map((b) => b.dataset.id);
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
const click = (box, shiftKey) => RangeSelect.onClick({ target: box, shiftKey });

test('aşağı doğru aralık: çıpa ile tıklanan satır arası işaretlenir', () => {
  const tbody = makeBody(rows(6));
  tbody.boxes[0].checked = true;               // kullanıcı 1. satırı tikledi
  const target = tbody.boxes[3];
  target.checked = true;                       // shift+tık: tarayıcı çevirdi
  const changed = RangeSelect.applyRange(tbody, '1', target);
  assert.equal(changed, 2, 'yalnız aradaki 2 ve 3 değişmeli');
  assert.deepEqual(ids(tbody), ['1', '2', '3', '4']);
});

test('yukarı doğru aralık da çalışır', () => {
  const tbody = makeBody(rows(6));
  tbody.boxes[4].checked = true;               // çıpa 5. satır
  const target = tbody.boxes[1];
  target.checked = true;
  RangeSelect.applyRange(tbody, '5', target);
  assert.deepEqual(ids(tbody), ['2', '3', '4', '5']);
});

test('shift ile işareti KALDIRMAK da aralığa yayılır', () => {
  const tbody = makeBody(rows(5).map((r) => ({ ...r, checked: true })));
  const target = tbody.boxes[3];
  target.checked = false;                      // tıklama kaldırdı
  RangeSelect.applyRange(tbody, '1', target);
  assert.deepEqual(ids(tbody), ['5'], '1-4 arası temizlenmeli');
});

test('zaten doğru durumdaki kutuya gereksiz change gönderilmez', () => {
  /* Koleksiyon her change için seçim sayacını yeniden hesaplıyor; boş
     olaylar büyük aralıklarda ölçülebilir maliyet demek. */
  const tbody = makeBody([{ id: 1 }, { id: 2, checked: true }, { id: 3 }, { id: 4 }]);
  const target = tbody.boxes[3];
  target.checked = true;
  const changed = RangeSelect.applyRange(tbody, '1', target);
  assert.equal(changed, 2, '2 zaten işaretliydi');
  assert.equal(tbody.boxes[1].changes, 0, 'değişmeyen kutu change almamalı');
  assert.equal(tbody.boxes[0].changes, 1);
  assert.equal(tbody.boxes[2].changes, 1);
});

test('tıklanan kutuya change gönderilmez — tarayıcı zaten gönderdi', () => {
  const tbody = makeBody(rows(4));
  const target = tbody.boxes[2];
  target.checked = true;
  RangeSelect.applyRange(tbody, '1', target);
  assert.equal(target.changes, 0, 'çift sayım seçim defterini bozar');
});

test('devre dışı kutu atlanır', () => {
  const tbody = makeBody([{ id: 1 }, { id: 2, disabled: true }, { id: 3 }]);
  const target = tbody.boxes[2];
  target.checked = true;
  RangeSelect.applyRange(tbody, '1', target);
  assert.equal(tbody.boxes[1].checked, false, 'salt okunur satır seçilmemeli');
});

test('çıpa yoksa veya çıpa ile hedef aynıysa aralık uygulanmaz', () => {
  const tbody = makeBody(rows(4));
  const target = tbody.boxes[1];
  target.checked = true;
  assert.equal(RangeSelect.applyRange(tbody, 'yok', target), 0);
  assert.equal(RangeSelect.applyRange(tbody, '2', target), 0);
});

test('shift olmadan tık çıpayı taşır, shift ile tık çıpayı KORUR', () => {
  const tbody = makeBody(rows(8));

  tbody.boxes[1].checked = true;               // 2. satıra düz tık → çıpa
  click(tbody.boxes[1], false);

  tbody.boxes[4].checked = true;               // 5. satıra shift+tık
  click(tbody.boxes[4], true);
  assert.deepEqual(ids(tbody), ['2', '3', '4', '5']);

  /* Çıpa hâlâ 2 olmalı: aynı çıpadan daha geniş bir aralık denenebilsin. */
  tbody.boxes[6].checked = true;               // 7. satıra shift+tık
  click(tbody.boxes[6], true);
  assert.deepEqual(ids(tbody), ['2', '3', '4', '5', '6', '7'],
    'çıpa kaysaydı aralık 5-7 olurdu');
});

test('çıpa id ile saklanır: tbody yeniden çizilince kaybolmaz', () => {
  /* Element referansı tutulsaydı ilk filtre/sıralama sonrasında aralık
     seçimi sessizce ölürdü — kullanıcı için "bazen çalışıyor" demekti. */
  const tbody = makeBody(rows(6));
  tbody.boxes[0].checked = true;
  click(tbody.boxes[0], false);

  tbody.rerender(rows(6).map((r) => (r.id === 1 ? { ...r, checked: true } : r)));

  const target = tbody.boxes[3];
  target.checked = true;
  click(target, true);
  assert.deepEqual(ids(tbody), ['1', '2', '3', '4'], 'çizim sonrası çıpa korunmalı');
});

test('rowChk olmayan onay kutuları bu davranışa girmez', () => {
  /* "Tümünü seç" başlık kutusu ve sütun paneli kutuları .rowChk taşımaz. */
  const other = {
    nodeType: 1, tagName: 'INPUT', type: 'checkbox', checked: true,
    dataset: { id: '9' }, classList: { contains: () => false },
    closest: () => null, dispatchEvent: () => true,
  };
  assert.doesNotThrow(() => click(other, true));
});
