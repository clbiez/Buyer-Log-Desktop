const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBacklogDetailRows } = require('../server/lib/parse');

test('Orders/CP Backlog detail uses source-row values as presentation fallback when ASAS fields are blank', () => {
  const asasOrder = {
    ocode: 1294062,
    _matchOcode: '1294062',
    model: 'HRK,HARRY-1-YD',
    ccode: 'J8',
    colour: 'BLACK',
    qty: 100,
    kalan: 100,
    fob: 3.8,
    ex: new Date(2026, 5, 20),
    retail: null,
    mb: null,
    opd: null,
    countryRaw: 'Turkey',
    buyer: '',
    buyerGrup: '',
    manufacturer: '',
    category: '',
    license: '',
    line: '',
    season: '',
    ozel: '',
  };
  const selector = {
    identities: [{
      orderCode: 1294062,
      modelName: 'HRK,HARRY-1-YD',
      colourCode: 'J8',
      fallback: {
        'Season': 'S7',
        'Country': 'Turkey',
        'Manufacturer': 'Example Supplier',
        'License': 'Minecraft',
        'Category': 'T-Shirt',
        'Model Name': 'HRK,HARRY-1-YD',
        'C.Code': 'J8',
        'Order Code': 1294062,
        'FOB ($)': 3.8,
        'OPD': '20.06.2026',
        'Ex-factory': '20.06.2026',
        'Retail Date': '15.02.2027',
        'In-Store (Model Budget)': '15.01.2027',
        'Line': 'BS',
        'Buyer': 'Buyer A',
        'Buyer Grup (TR)': 'Group A',
      },
    }],
  };

  const rows = buildBacklogDetailRows([asasOrder], {}, {}, selector);
  assert.equal(rows.length, 1);
  // v5.83: detay satırı artık Backlog başlık listesinin anahtarlarını kullanıyor.
  assert.equal(rows[0]['Retail Depo Tarih Yıl Ay Gün'], '15.02.2027');
  assert.equal(rows[0]['Model Bütçe Tarih Yıl Ay Gün'], '15.01.2027');
  assert.equal(rows[0]['Sipariş Yerleştirme MerchTarih'], '20.06.2026');
  assert.equal(rows[0]['Üretici'], 'Example Supplier');
  assert.equal(rows[0]['Ürün Klasman'], 'T-Shirt');
  assert.equal(rows[0]['Line'], 'BS');
  assert.equal(rows[0]['Buyer'], 'Buyer A');
});
