'use strict';
const BLBusinessRules=require('../../public/business-rules');
function normalizePricingRuleDate(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? text : '';
}
function normalizePricingCountryGroup(value) {
  const key = String(value == null ? '' : value).trim().toUpperCase().replace(/[\s_]+/g, '-');
  if (key === 'TR') return 'TR';
  if (key === 'NON-TR') return 'Non-TR';
  return '';
}
function normalizePricingRuleSeasons(value) {
  const raw = Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]);
  const seen = new Set(), out = [];
  for (const item of raw) {
    const text = String(item == null ? '' : item).trim();
    const key = text.toLocaleUpperCase('tr-TR');
    if (text && !seen.has(key)) { seen.add(key); out.push(text); }
  }
  return out.sort((a, b) => a.localeCompare(b, 'tr'));
}
function pricingRuleSeasonSetsOverlap(a, b) {
  const aa = normalizePricingRuleSeasons(a && a.seasons != null ? a.seasons : a && a.season);
  const bb = normalizePricingRuleSeasons(b && b.seasons != null ? b.seasons : b && b.season);
  if (!aa.length || !bb.length) return true;
  const bset = new Set(bb.map(v => v.toLocaleUpperCase('tr-TR')));
  return aa.some(v => bset.has(v.toLocaleUpperCase('tr-TR')));
}
function pricingRuleDateRangesOverlap(a, b) {
  const a1 = a.opdStart ? Date.parse(a.opdStart + 'T00:00:00Z') : -Infinity;
  const a2 = a.opdEnd ? Date.parse(a.opdEnd + 'T00:00:00Z') : Infinity;
  const b1 = b.opdStart ? Date.parse(b.opdStart + 'T00:00:00Z') : -Infinity;
  const b2 = b.opdEnd ? Date.parse(b.opdEnd + 'T00:00:00Z') : Infinity;
  return a1 <= b2 && b1 <= a2;
}
function normalizeTransitList(value) {
  const raw = Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]);
  const seen = new Set(), out = [];
  raw.forEach(item => {
    const text = String(item == null ? '' : item).trim();
    const key = text.toLocaleUpperCase('tr-TR');
    if (text && !seen.has(key)) { seen.add(key); out.push(text); }
  });
  return out.sort((a, b) => a.localeCompare(b, 'tr'));
}
const normalizeTransitDelType=BLBusinessRules.normalizeTransitDelType;
function normalizeTransitRules(incoming){
    const seen = new Set();
    const rules = incoming.map((r, i) => ({
      id: String(r.id || ('transit-rule-' + Date.now() + '-' + i)),
      exfStart: normalizePricingRuleDate(r.exfStart),
      exfEnd: normalizePricingRuleDate(r.exfEnd),
      seasons: normalizeTransitList(r.seasons),
      countries: normalizeTransitList(r.countries),
      delType: normalizeTransitDelType(r.delType),
      days: Number(r.days),
    })).filter(r => {
      if ((r.exfStart && r.exfEnd && r.exfStart > r.exfEnd) || !r.delType || !Number.isFinite(r.days) || !Number.isInteger(r.days) || r.days < 0 || r.days > 3650) return false;
      const key = [r.exfStart, r.exfEnd, r.seasons.map(v => v.toLocaleUpperCase('tr-TR')).join('~'), r.countries.map(v => v.toLocaleUpperCase('tr-TR')).join('~'), BLBusinessRules.transitDelTypeKey(r.delType)].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
return rules;
}
function normalizePricingRules(incoming){
    const migrated = BLBusinessRules.migrateLicenseRoyaltyRules(incoming);
    const nullablePercent = value => {
      if (value == null || String(value).trim() === '') return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : NaN;
    };
    const nullableMoney = value => {
      if (value == null || String(value).trim() === '') return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : NaN;
    };
    const rules = migrated.map((r, i) => ({
      id: String(r.id || ('rule-' + Date.now() + '-' + i)),
      opdStart: normalizePricingRuleDate(r.opdStart),
      opdEnd: normalizePricingRuleDate(r.opdEnd),
      seasons: normalizePricingRuleSeasons(r.seasons != null ? r.seasons : r.season),
      licensor: String(r.licensor != null ? r.licensor : (r.manufacturer || '')).trim(),
      license: String(r.license || '').trim(),
      royalty: Number(r.royalty),
      trCommission: nullablePercent(r.trCommission),
      ydCommission: nullablePercent(r.ydCommission),
      hologramCost: Number(r.hologramCost),
      legacyTrHologramCost: nullableMoney(r.legacyTrHologramCost),
      legacyYdHologramCost: nullableMoney(r.legacyYdHologramCost),
      legacyRuleIds: Array.isArray(r.legacyRuleIds) ? r.legacyRuleIds.map(String).filter(Boolean) : [],
      migratedFromCountrySplit: r.migratedFromCountrySplit === true,
    })).filter(r => {
      const commissions = [r.trCommission, r.ydCommission].filter(value => value != null);
      const commissionValid = commissions.length > 0 && commissions.every(value => Number.isFinite(value) && value >= 0 && value <= 100);
      const totalValid = (r.trCommission == null || r.royalty + r.trCommission <= 100)
        && (r.ydCommission == null || r.royalty + r.ydCommission <= 100);
      const legacyHologramValid = (r.legacyTrHologramCost == null || (Number.isFinite(r.legacyTrHologramCost) && r.legacyTrHologramCost >= 0))
        && (r.legacyYdHologramCost == null || (Number.isFinite(r.legacyYdHologramCost) && r.legacyYdHologramCost >= 0));
      return (!r.opdStart || !r.opdEnd || r.opdStart <= r.opdEnd)
        && r.licensor && r.license
        && Number.isFinite(r.royalty) && r.royalty >= 0 && r.royalty <= 100
        && commissionValid && totalValid
        && Number.isFinite(r.hologramCost) && r.hologramCost >= 0
        && legacyHologramValid;
    });
    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        const a = rules[i], b = rules[j];
        const sameKey = a.licensor.toLocaleUpperCase('tr-TR') === b.licensor.toLocaleUpperCase('tr-TR')
          && a.license.toLocaleUpperCase('tr-TR') === b.license.toLocaleUpperCase('tr-TR');
        const sameCountrySide = (a.trCommission != null && b.trCommission != null)
          || (a.ydCommission != null && b.ydCommission != null);
        if (sameKey && sameCountrySide && pricingRuleSeasonSetsOverlap(a, b) && pricingRuleDateRangesOverlap(a, b)) {
          throw Object.assign(new Error('Royalty date/season ranges overlap.'),{code:'PRICING_RULE_OVERLAP',statusCode:400});
        }
      }
    }
return rules;
}
module.exports={normalizePricingRuleDate,normalizePricingCountryGroup,normalizePricingRuleSeasons,pricingRuleSeasonSetsOverlap,pricingRuleDateRangesOverlap,normalizeTransitList,normalizeTransitRules,normalizePricingRules};
