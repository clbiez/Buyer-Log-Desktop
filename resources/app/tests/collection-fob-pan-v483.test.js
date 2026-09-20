'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));

function functionSource(name) {
  const marker = `function ${name}(`;
  const start = INDEX.indexOf(marker);
  assert.ok(start >= 0, `${name} bulunmalı`);
  const brace = INDEX.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = brace; i < INDEX.length; i++) {
    const ch = INDEX[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return INDEX.slice(start, i + 1);
    }
  }
  throw new Error(`${name} kapanışı bulunamadı`);
}

function loadPricingFunctions() {
  const src = [
    functionSource('kolComputeFobFromConfirmed'),
    functionSource('kolSuppFob'),
    functionSource('kolApplyRulePricing'),
    'return {kolSuppFob,kolApplyRulePricing};',
  ].join('\n');

  const parse = value => {
    if (value === '' || value == null) return NaN;
    const number = Number(String(value).replace('%', '').replace(',', '.'));
    return Number.isFinite(number) ? number : NaN;
  };
  const confirmed = row => {
    const name = String(row.confirmedManufacturer || '').trim();
    const price = parse(row.pricing && row.pricing[name]);
    return name && Number.isFinite(price) && price > 0 ? { name, price } : null;
  };
  const best = row => {
    let out = null;
    Object.entries(row.pricing || {}).forEach(([name, raw]) => {
      const price = parse(raw);
      if (Number.isFinite(price) && price > 0 && (!out || price < out.price)) out = { name, price };
    });
    return out;
  };

  return new Function(
    'kolParseMoneyNum', 'kolConfirmedPricing', 'kolBestPricing', 'kolFindPricingRule',
    'kolLandedIsNonDtr', 'kolLicensorUnresolvedState',
    'kolFormatPercentDisplay', 'kolFormatHologramDisplay', 'kolFormatMoneyDisplay',
    'editableValuesEqual', src
  )(
    parse, confirmed, best,
    () => ({ id: 'rule-1', royalty: 10, hologramCost: 0.1 }),
    /* Gerçek kuralın sadeleştirilmiş hâli: licensor dolu ve DTR değilse Non-DTR. */
    row => { const l = String((row && row.licensor) || '').trim().toUpperCase(); return Boolean(l && l !== 'DTR'); },
    /* Licensor belirsizligi bu senaryolarda yok; guard notr kalir. */
    () => null,
    value => `${Number(value).toFixed(2)}%`,
    value => String(value),
    value => Number(String(value).replace(',', '.')).toFixed(2),
    (a, b) => String(a ?? '') === String(b ?? '')
  );
}

test('v4.83 Collection FOB uses Confirmed, then Best Price, then Target Price', () => {
  const { kolApplyRulePricing } = loadPricingFunctions();

  const confirmed = { pricing: { A: '5.00', B: '4.00' }, confirmedManufacturer: 'A', targetPrice: '3.00' };
  kolApplyRulePricing(confirmed);
  assert.equal(confirmed.fob, '5.66');

  const best = { pricing: { A: '5.00', B: '4.00' }, confirmedManufacturer: '', targetPrice: '3.00' };
  kolApplyRulePricing(best);
  assert.equal(best.fob, '4.54');

  const target = { pricing: {}, confirmedManufacturer: '', targetPrice: '3.00' };
  kolApplyRulePricing(target);
  assert.equal(target.fob, '3.43');

  const empty = { pricing: {}, confirmedManufacturer: '', targetPrice: '', fob: '9.99' };
  kolApplyRulePricing(empty);
  assert.equal(empty.fob, '');
});

test('v4.83 fallback FOB is visibly marked and Target Price edits recalculate immediately', () => {
  assert.match(INDEX, /const fobSource=kolSuppFob\(row\)/);
  assert.match(INDEX, /fobSource\.source!==['"]confirmed['"]/);
  assert.match(INDEX, /kolFobFallback/);
  assert.match(INDEX, /else if\(k===['"]targetPrice['"]\)\{[\s\S]*?kolApplyRulePricing\(row\)/);
});

test('v4.83 right-button hand pan supports horizontal, vertical and diagonal movement everywhere', () => {
  assert.match(INDEX, /window\.addEventListener\('pointerdown'/);
  assert.match(INDEX, /window\.addEventListener\('pointermove'/);
  assert.doesNotMatch(INDEX, /event\.target\.closest\?\.\(interactiveSelector\)/);
  assert.match(INDEX, /if\(!xTarget&&yTarget&&axisScrollable\(yTarget,'x'\)\)xTarget=yTarget/);
  assert.match(INDEX, /if\(!yTarget&&xTarget&&axisScrollable\(xTarget,'y'\)\)yTarget=xTarget/);
  assert.match(INDEX, /pan\.xTarget\.scrollLeft=pan\.xStart-totalDx/);
  assert.match(INDEX, /pan\.yTarget\.scrollTop=pan\.yStart-totalDy/);
  assert.match(INDEX, /setPointerCapture/);
  assert.match(INDEX, /pointercancel/);
});
