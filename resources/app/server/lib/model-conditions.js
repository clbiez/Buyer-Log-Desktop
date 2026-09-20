'use strict';

/*
 * Serbest ufuk koşulları → DAX.
 *
 * Eski ufuk yalnız iki şeyi biliyordu: sezon listesi ve tarih aralığı, aralarında
 * sabit bir VEYA ile. Artık istenen sayıda koşul kurulabiliyor (sezon, MAG, üretici,
 * lisans, tarih, sayı...).
 *
 * BİRLEŞTİRME MODELİ — grup içi VE, gruplar arası VEYA:
 *
 *     ( koşul1 VE koşul2 )  VEYA  ( koşul3 )
 *
 * Bu, tam bir boole ifade editörü kurmadan gerçek ihtiyaçların hepsini karşılar.
 * Örnek: CP'nin kayan tarih penceresi bir grup, LFL'in karşılaştırdığı sezonların
 * tamamı başka bir grup olur; ikisi VEYA ile birleşir ve tek sorgu ikisini de besler.
 * "Sezon W6 VE MAG 320" gibi bir daraltma ise tek grupta iki koşuldur.
 */

const OPERATORS = {
  in: { arity: 'list', label: 'şunlardan biri' },
  notIn: { arity: 'list', label: 'şunlardan biri değil' },
  between: { arity: 'range', label: 'aralığında' },
  gte: { arity: 'from', label: 'şundan büyük/eşit' },
  lte: { arity: 'to', label: 'şundan küçük/eşit' },
  contains: { arity: 'single', label: 'içerir' },
  startsWith: { arity: 'single', label: 'ile başlar' },
  empty: { arity: 'none', label: 'boş' },
  notEmpty: { arity: 'none', label: 'dolu' },
};
const VALUE_TYPES = ['text', 'date', 'number', 'boolean'];
const MAX_CONDITIONS = 40;
const MAX_GROUPS = 10;
const MAX_VALUES = 500;

function normalizeCondition(raw, fallbackTable) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const text = (value, max) => String(value == null ? '' : value).trim().slice(0, max);
  const op = Object.prototype.hasOwnProperty.call(OPERATORS, item.op) ? item.op : 'in';
  const valueType = VALUE_TYPES.includes(item.valueType) ? item.valueType : 'text';
  const values = (Array.isArray(item.values) ? item.values : String(item.values == null ? '' : item.values).split(/[,;\n]+/))
    .map(value => String(value == null ? '' : value).trim())
    .filter(Boolean)
    .slice(0, MAX_VALUES);
  return {
    id: text(item.id, 40) || `hc_${Math.random().toString(36).slice(2, 9)}`,
    table: text(item.table, 200) || text(fallbackTable, 200),
    field: text(item.field, 200),
    // Dynamic Horizon fields keep their display key separate from the actual
    // model column name so duplicate names across tables remain addressable.
    name: text(item.name, 200),
    op, valueType, values,
    /* Tipin NEREDEN geldiği kayıtta kalır: 'schema' otoriterdir, '' ya da
       'heuristic' yalnız arayüz tahminidir. Predicate üreticisi canlı şemayı
       tercih eder; bu alan, şema okunamadığında kayıtlı tipe ne kadar
       güvenilebileceğini söyler. */
    valueTypeSource: ['schema', 'heuristic'].includes(item.valueTypeSource) ? item.valueTypeSource : '',
    from: text(item.from, 40),
    to: text(item.to, 40),
  };
}

function normalizeGroup(raw, fallbackTable) {
  const item = raw && typeof raw === 'object' ? raw : {};
  return {
    id: String(item.id || '').trim().slice(0, 40) || `hg_${Math.random().toString(36).slice(2, 9)}`,
    conditions: (Array.isArray(item.conditions) ? item.conditions : [])
      .map(condition => normalizeCondition(condition, fallbackTable))
      .slice(0, MAX_CONDITIONS),
  };
}

function normalizeGroups(raw, fallbackTable) {
  return (Array.isArray(raw) ? raw : [])
    .map(group => normalizeGroup(group, fallbackTable))
    .slice(0, MAX_GROUPS);
}

/**
 * Eski (sezon + tarih) ayarını yeni koşul yapısına çevirir.
 * Eski davranış korunur: sezon ve tarih AYRI gruplardır, yani aralarında VEYA vardır.
 */
function legacyGroupsFromHorizon(horizon) {
  const groups = [];
  if (Array.isArray(horizon.seasons) && horizon.seasons.length) {
    groups.push({
      id: 'legacy-season',
      conditions: [{
        id: 'legacy-season-c', table: horizon.seasonTable || horizon.table,
        field: horizon.seasonField, op: 'in', valueType: 'text', values: horizon.seasons, from: '', to: '',
      }],
    });
  }
  if (horizon.dateStart || horizon.dateEnd) {
    groups.push({
      id: 'legacy-date',
      conditions: [{
        id: 'legacy-date-c', table: horizon.dateTable || horizon.table,
        field: horizon.dateField,
        op: horizon.dateStart && horizon.dateEnd ? 'between' : (horizon.dateStart ? 'gte' : 'lte'),
        valueType: 'date', values: [], from: horizon.dateStart || '', to: horizon.dateEnd || '',
      }],
    });
  }
  return groups;
}

module.exports = {
  OPERATORS, VALUE_TYPES, MAX_CONDITIONS, MAX_GROUPS, MAX_VALUES,
  normalizeCondition, normalizeGroup, normalizeGroups, legacyGroupsFromHorizon,
};
