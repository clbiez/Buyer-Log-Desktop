'use strict';

/* LFL'ye her geri dönüşte (30k satır) ~0,8 sn ana iş parçacığı bloke oluyordu:
   ana analiz (compute) zaten önbellekliyken
   - bağımsız karşılaştırma senaryoları her çizimde tüm satırları yeniden
     süzüp özetliyordu (~0,4 sn),
   - Sipariş Hacmi Analizi filtre seçenekleri için her boyutta tüm güncel +
     kıyas satırlarını tarayıp iki kez Türkçe büyük harfe çeviriyordu (~0,37 sn).
   İkisi de aynı veri/filtre/dil için aynı sonucu üretir; artık önbelleklenir.
   Veri yeniden yüklenince (analysisDatasetRevision) veya deneme satırları
   değişince (analysisRevision) anahtar değişir; önbellek bayat sonuç vermez. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LFL = fs.readFileSync(path.join(__dirname, '..', 'public', 'lfl.js'), 'utf8');
const ANALYTICS = fs.readFileSync(path.join(__dirname, '..', 'public', 'lfl-order-analytics.js'), 'utf8');

function body(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunamadı`);
  return src.slice(start, src.indexOf('\n  }', start) > 0 ? src.indexOf('\n', src.indexOf('\n  }', start) + 1) : undefined);
}

test('senaryo sonuçları veri sürümü + senaryo + genel filtre + kırılım + dil anahtarıyla önbelleklenir', () => {
  assert.match(LFL, /function comparisonScenarioResults\(a\)\{return ensureComparisonScenarios\(a\)\.map\(item=>cachedScenarioComparisonResult\(item\)\);\}/);
  const key = body(LFL, 'scenarioResultCacheKey');
  for (const part of ['analysisDatasetRevision', 'state.analysisRevision', 'state.loadedAt', 'serializeComparisonScenario', 'globalScenarioFilterValues', 'state.breakdown', 'state.periods.current.dateField', 'state.periods.compare.dateField', 'isEn()']) {
    assert.ok(key.includes(part), `anahtar ${part} içermeli`);
  }
  assert.match(LFL, /analysisDatasetRevision\+=1;lflAnalysisCache\.clear\(\);lflScenarioCache\.clear\(\);/);
  // Test kancası ham (önbelleksiz) hesaplamayı açığa vermeye devam eder.
  assert.match(LFL, /window\.__lflTest=\{[\s\S]*scenarioComparisonResult,/);
});

test('Sipariş Hacmi Analizi filtre seçenekleri analiz nesnesi + dil başına bir kez hesaplanır', () => {
  const unique = body(ANALYTICS, 'uniqueValues');
  assert.match(unique, /uniqueValuesCache/);
  assert.match(unique, /locale\(\)/);
  assert.match(ANALYTICS, /const uniqueValuesCache=new WeakMap\(\);/);
  assert.doesNotMatch(unique, /seen\.has\(value\.toLocaleUpperCase\('tr-TR'\)\)\)seen\.set\(value\.toLocaleUpperCase/);
});
