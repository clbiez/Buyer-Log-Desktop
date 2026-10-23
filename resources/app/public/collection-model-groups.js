(function (root, factory) {
  const api = factory(typeof module==='object' && module.exports ? require('./overview-collection-summary.js') : root.BLOverviewCollectionSummary);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BLCollectionModelGroups = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (collectionSummary) {
  'use strict';

  const text = value => String(value == null ? '' : value).trim();
  const normal = value => text(value).replace(/\s+/g, ' ').toLocaleUpperCase('tr-TR');
  // An MB month is a period, not a localized string: mixed legacy labels must
  // not divide colour variants into separate model identities.
  const monthIdentity = value => {
    const parts=collectionSummary?.monthParts?.(value);
    return parts?`${parts.year}${String(parts.month).padStart(2,'0')}`:text(value);
  };
  const identityOf = row => [text(row && row.plmId), normal(row && row.modelKod), monthIdentity(row && row.inStoreMonth)].join('\u0000');
  const colourIdentity = row => normal(row && row.colourCode) || normal(row && row.colour);
  const hash = value => {
    let h = 2166136261;
    for (const ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  };
  const clone = value => value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
  const hasIdentity = row => Boolean(text(row && row.plmId) && normal(row && row.modelKod) && text(row && row.inStoreMonth));
  const rowId = row => text(row && row.id);
  const groupIdFor = (identity, rows) => `mg_${hash(identity)}_${hash((rows || []).map(rowId).join('\u0000'))}`;
  const singleGroupId = row => `mg_single_${hash(rowId(row) || identityOf(row))}`;
  const COLOR_SPECIFIC_FIELDS = new Set(['quantity', 'img', 'imgRef', 'colour', 'colourCode', 'durum', 'status']);
  const CALCULATED_FIELDS = new Set(['fob', 'royalty', 'hologramCost', 'exToRetail', '__bestPrice__', '__confirmedName__', '__confirmedPrice__']);

  function fieldMetadata(key) {
    const name = text(key);
    const colorSpecific = COLOR_SPECIFIC_FIELDS.has(name);
    const calculated = CALCULATED_FIELDS.has(name);
    return {
      key: name,
      inheritance: colorSpecific ? 'color' : 'model',
      editable: !calculated,
      calculated,
      overrideable: !colorSpecific && !calculated,
    };
  }

  function memberGroups(rows) {
    const map = new Map();
    (rows || []).forEach(row => {
      if (!row || !row.modelGroupId) return;
      if (!map.has(row.modelGroupId)) map.set(row.modelGroupId, []);
      map.get(row.modelGroupId).push(row);
    });
    return map;
  }

  function normalizeRows(input) {
    const rows = (Array.isArray(input) ? input : []).map((source, index) => {
      const row = clone(source) || {};
      if (row.id == null || row.id === '') row.id = index + 1;
      if (!row.variantOverrides || typeof row.variantOverrides !== 'object' || Array.isArray(row.variantOverrides)) row.variantOverrides = {};
      if (!row.modelSharedValues || typeof row.modelSharedValues !== 'object' || Array.isArray(row.modelSharedValues)) row.modelSharedValues = {};
      return row;
    });

    const candidates = new Map();
    rows.forEach(row => {
      // Existing membership is authoritative. It may have been deliberately
      // detached by the user and must not be silently re-created on reload.
      if (!hasIdentity(row) || row.modelGroupId) return;
      const key = identityOf(row);
      if (!candidates.has(key)) candidates.set(key, []);
      candidates.get(key).push(row);
    });
    const groups = [];
    candidates.forEach((items, identity) => {
      const colours = items.map(colourIdentity);
      const complete = items.length >= 2 && colours.every(Boolean) && new Set(colours).size === items.length;
      if (!complete) return;
      const groupId = groupIdFor(identity, items);
      const leader = items[0];
      items.forEach((row, index) => {
        row.modelGroupId = groupId;
        row.variantId = text(row.variantId) || `variant_${hash(`${groupId}\u0000${rowId(row)}`)}`;
        row.modelGroupRole = index === 0 ? 'parent' : 'variant';
        row.modelGroupIdentity = identity;
      });
      groups.push({ id: groupId, identity, rows: items, parentId: leader.id, auto: true });
    });

    // Give every row a stable identity too. Single rows remain independent.
    rows.forEach(row => {
      if (!row.modelGroupId) {
        row.modelGroupId = singleGroupId(row);
        row.modelGroupRole = 'single';
      }
      row.variantId = text(row.variantId) || `variant_${hash(`${row.modelGroupId}\u0000${rowId(row)}`)}`;
      if (!row.modelGroupIdentity && hasIdentity(row)) row.modelGroupIdentity = identityOf(row);
    });
    memberGroups(rows).forEach((items, id) => {
      if (items.length < 2) return;
      const parent = items.find(row => row.modelGroupRole === 'parent') || items[0];
      // A persisted group may predate the explicit parent role or may have
      // been saved with every member marked as a variant. Repair the role
      // deterministically so model-level edits propagate from the real parent.
      items.forEach(row => { row.modelGroupRole = row === parent ? 'parent' : 'variant'; });
      if (!groups.some(group => group.id === id)) groups.push({ id, identity: parent.modelGroupIdentity || identityOf(parent), rows: items, parentId: parent.id, auto: false });
    });
    return { rows, groups: groups.filter(group => group.rows.length > 1) };
  }

  // PLM aktarımında Model Budget Month henüz girilmemiş olabilir. Bu yüzden yalnız
  // o aktarımın yeni satırları için PLM ID + model adı kimliğiyle bağ kurulur;
  // genel otomatik gruplama kuralı (ay dahil) değişmeden kalır.
  function linkImportedColourVariants(input) {
    const rows = Array.isArray(input) ? input : [];
    const candidates = new Map(), groups = [];
    rows.forEach(row => {
      if (!row || text(row.modelGroupId)) return;
      const plmId = text(row.plmId), model = normal(row.modelKod), colour = colourIdentity(row);
      if (!plmId || !model || !colour) return;
      const identity = `${plmId}\u0000${model}`;
      if (!candidates.has(identity)) candidates.set(identity, []);
      candidates.get(identity).push(row);
    });
    candidates.forEach((items, identity) => {
      const names = items.map(row => normal(row && row.colour));
      const codes = items.map(colourIdentity);
      const colours = names.every(Boolean) && new Set(names).size === items.length ? names : codes;
      if (items.length < 2 || new Set(colours).size !== items.length) return;
      const groupId = groupIdFor(`import\u0000${identity}`, items), leader = items[0];
      items.forEach((row, index) => {
        row.modelGroupId = groupId;
        row.variantId = text(row.variantId) || `variant_${hash(`${groupId}\u0000${rowId(row)}`)}`;
        row.modelGroupRole = index === 0 ? 'parent' : 'variant';
        row.modelGroupIdentity = identity;
      });
      groups.push({ id: groupId, identity, rows: items, parentId: leader.id, auto: true, imported: true });
    });
    return { rows, groups };
  }

  function groupFor(rows, groupId) {
    return (rows || []).filter(row => String(row && row.modelGroupId) === String(groupId));
  }

  function hasVariantOverride(row, key) {
    return Boolean(row && row.variantOverrides && Object.prototype.hasOwnProperty.call(row.variantOverrides, key));
  }

  function effectiveValue(row, key, rows, parents) {
    if (!row) return '';
    // Override existence and override value are intentionally separate. Empty
    // string, 0, false and null are all valid explicit colour-level values and
    // must never fall back to the model merely because they are falsy.
    if (hasVariantOverride(row, key)) return row.variantOverrides[key];
    if (row.modelGroupRole !== 'variant' && row.modelSharedValues && Object.prototype.hasOwnProperty.call(row.modelSharedValues, key)) return row.modelSharedValues[key];
    if (fieldMetadata(key).inheritance === 'model') {
      const parent = parents ? parents.get(String(row.modelGroupId)) : groupFor(rows, row.modelGroupId).find(item => item.modelGroupRole === 'parent');
      if (parent && parent !== row) {
        if (parent.modelSharedValues && Object.prototype.hasOwnProperty.call(parent.modelSharedValues, key)) return parent.modelSharedValues[key];
        if (parent[key] !== undefined && parent[key] !== null && text(parent[key]) !== '') return parent[key];
      }
    }
    return row[key];
  }

  // A fresh reader for one read-only operation: index parents once instead of
  // scanning all rows for every model-level cell. Rebuild after row changes.
  function createValueReader(rows) {
    const parents = new Map();
    (rows || []).forEach(row => {
      if (row && row.modelGroupRole === 'parent' && !parents.has(String(row.modelGroupId))) parents.set(String(row.modelGroupId), row);
    });
    return (row, key) => effectiveValue(row, key, null, parents);
  }

  function setSharedValue(rows, groupId, key, value, options={}) {
    const next = options.inPlace ? rows : (rows || []).map(clone), members = groupFor(next, groupId);
    if (!members.length) return next;
    const parent = members.find(row => row.modelGroupRole === 'parent') || members[0];
    const sharedValue = clone(value);
    parent.modelSharedValues = { ...(parent.modelSharedValues || {}), [key]: clone(sharedValue) };

    // Keep the materialized row value in sync for every member that is still
    // linked to the model for this field. effectiveValue() already resolves
    // inheritance at read time; mirroring the value here prevents stale raw
    // data from resurfacing after detach/split and keeps legacy/raw consumers
    // consistent. A colour-specific override is authoritative and must never
    // be overwritten by a parent edit.
    members.forEach(row => {
      if (!hasVariantOverride(row, key)) row[key] = clone(sharedValue);
    });
    return next;
  }

  function setVariantOverride(rows, id, key, value, options={}) {
    const next = options.inPlace ? rows : (rows || []).map(clone), row = next.find(item => String(item && item.id) === String(id));
    if (!row) return next;
    row.variantOverrides = { ...(row.variantOverrides || {}), [key]: clone(value) };
    row[key] = clone(value);
    return next;
  }

  function writeGroupedValue(rows,id,key,value) {
    const row=rows.find(item=>String(item.id)===String(id));
    if(!row)return rows;
    if(groupFor(rows,row.modelGroupId).length>1){
      if(hasVariantOverride(row,key)||fieldMetadata(key).inheritance==='model'&&row.modelGroupRole!=='parent')return setVariantOverride(rows,id,key,value,{inPlace:true});
      if(fieldMetadata(key).inheritance==='model')return setSharedValue(rows,row.modelGroupId,key,value,{inPlace:true});
    }
    row[key]=clone(value);return rows;
  }

  function clearVariantOverride(rows, id, key) {
    const next = (rows || []).map(clone), row = next.find(item => String(item && item.id) === String(id));
    if (!row) return next;
    delete row.variantOverrides?.[key];
    const shared = effectiveValue(row, key, next);
    if (shared !== undefined) row[key] = clone(shared);
    return next;
  }

  function clearAllVariantOverrides(rows, id) {
    let next = (rows || []).map(clone);
    const row = next.find(item => String(item && item.id) === String(id));
    if (!row) return next;
    const overrides = row.variantOverrides || {};
    Object.keys(overrides).forEach(key => {
      if (fieldMetadata(key).inheritance === 'model') {
        next = clearVariantOverride(next, id, key);
      }
    });
    return next;
  }

  function visibleRows(rows, collapsedGroups) {
    const collapsed = collapsedGroups instanceof Set ? collapsedGroups : new Set(collapsedGroups || []);
    return (rows || []).filter(row => {
      const members = groupFor(rows, row && row.modelGroupId);
      if (members.length < 2 || !collapsed.has(String(row.modelGroupId))) return true;
      return row.modelGroupRole === 'parent' || members[0] === row;
    });
  }

  function setPricingOverrides(rows, id, keys) {
    let next = (rows || []).map(clone);
    const row = next.find(item => String(item && item.id) === String(id));
    if (!row) return next;
    // Manufacturer quote values are already stored as a nested pricing map.
    // Mark the complete map as a variant override as well as the legacy scalar
    // fields, so the action remains safe when new pricing columns are added.
    row.variantOverrides = { ...(row.variantOverrides || {}), pricing: clone(row.pricing || {}) };
    (keys || []).filter(Boolean).forEach(key => { row.variantOverrides[key] = clone(row[key]); });
    return next;
  }

  const GROUP_METADATA_FIELDS = new Set([
    'id', 'modelGroupId', 'modelGroupRole', 'modelGroupIdentity', 'modelGroupDetached',
    'variantId', 'variantOverrides', 'modelSharedValues', '_rev'
  ]);

  const equalValue = (left, right) => {
    if (left === right) return true;
    if (left == null && right == null) return true;
    if ((left && typeof left === 'object') || (right && typeof right === 'object')) {
      try { return JSON.stringify(left) === JSON.stringify(right); } catch (_) { return false; }
    }
    return false;
  };

  // Merge is deliberately the inverse of detachVariant at the grouping layer:
  // rows are never removed or collapsed. Every selected model group is expanded
  // to all of its colour members, then attached to one existing canonical group.
  // Model-level values that would otherwise start inheriting from the new parent
  // are captured as variant overrides so the values visible before the merge stay
  // intact and a later split can round-trip without data loss.
  function mergeGroups(rows, selectedIds, targetRowId) {
    const source = Array.isArray(rows) ? rows : [];
    const next = source.map(clone);
    const wanted = new Set((selectedIds || []).map(String));
    const selected = next.filter(row => wanted.has(rowId(row)));
    const selectedGroupIds = [...new Set(selected.map(row => text(row && row.modelGroupId)).filter(Boolean))];
    if (selectedGroupIds.length < 2) return { rows: next, changed: false, reason: 'distinct-groups-required', groupIds: selectedGroupIds };

    const selectedGroups = new Set(selectedGroupIds);
    let target = next.find(row => rowId(row) === text(targetRowId) && selectedGroups.has(text(row && row.modelGroupId)));
    if (!target) target = selected[0];
    if (!target) return { rows: next, changed: false, reason: 'target-not-found', groupIds: selectedGroupIds };

    const targetGroupId = text(target.modelGroupId) || singleGroupId(target);
    const targetMembers = groupFor(next, targetGroupId);
    const targetParent = targetMembers.find(row => row.modelGroupRole === 'parent') || targetMembers[0] || target;
    const targetIdentity = text(targetParent.modelGroupIdentity) || (hasIdentity(targetParent) ? identityOf(targetParent) : `manual\u0000${rowId(targetParent)}`);
    const memberRows = next.filter(row => selectedGroups.has(text(row && row.modelGroupId)));
    if (memberRows.length < 2) return { rows: next, changed: false, reason: 'members-not-found', groupIds: selectedGroupIds };

    const keys = new Set();
    memberRows.forEach(row => Object.keys(row || {}).forEach(key => {
      if (!GROUP_METADATA_FIELDS.has(key) && !String(key).startsWith('_')) keys.add(key);
    }));
    // Freeze every row's pre-merge effective values before changing any group id.
    // Otherwise moving a source parent first would make its still-unmoved variants
    // lose the parent they inherit from while this loop is still running.
    const effectiveBefore = new Map();
    memberRows.forEach(row => {
      const values = new Map();
      keys.forEach(key => values.set(key, clone(effectiveValue(row, key, next))));
      effectiveBefore.set(rowId(row), values);
    });
    const targetEffective = effectiveBefore.get(rowId(targetParent)) || new Map();

    memberRows.forEach(row => {
      if (row !== targetParent) {
        const overrides = { ...(row.variantOverrides || {}) };
        const beforeValues = effectiveBefore.get(rowId(row)) || new Map();
        keys.forEach(key => {
          const meta = fieldMetadata(key);
          if (meta.inheritance !== 'model' || meta.calculated) return;
          const before = clone(beforeValues.get(key));
          const canonical = targetEffective.get(key);
          if (!equalValue(before, canonical)) {
            overrides[key] = before;
            row[key] = clone(before);
          }
        });
        row.variantOverrides = overrides;
      }
      row.modelGroupId = targetGroupId;
      row.modelGroupIdentity = targetIdentity;
      row.modelGroupDetached = false;
      row.modelGroupRole = row === targetParent ? 'parent' : 'variant';
      row.variantId = text(row.variantId) || `variant_${hash(`${targetGroupId}\u0000${rowId(row)}`)}`;
    });

    return {
      rows: next, changed: true, groupId: targetGroupId, parentId: targetParent.id,
      groupIds: selectedGroupIds, memberIds: memberRows.map(row => row.id)
    };
  }

  function detachVariant(rows, id) {
    const next = (rows || []).map(clone), row = next.find(item => String(item && item.id) === String(id));
    if (!row) return next;
    row.modelGroupId = singleGroupId(row);
    row.modelGroupRole = 'single';
    row.modelGroupDetached = true;
    return next;
  }

  function relinkVariant(rows, id) {
    const next = (rows || []).map(clone), row = next.find(item => String(item && item.id) === String(id));
    if (!row || !hasIdentity(row)) return next;
    const peer = next.find(item => item !== row && hasIdentity(item) && identityOf(item) === identityOf(row) && item.modelGroupId !== row.modelGroupId);
    if (!peer) return next;
    const target = peer.modelGroupId;
    next.forEach(item => {
      if (item === row || item.modelGroupId === target) {
        item.modelGroupId = target;
        item.modelGroupIdentity = identityOf(row);
        item.modelGroupDetached = false;
        item.modelGroupRole = item === row ? 'variant' : (item.modelGroupRole === 'parent' ? 'parent' : 'variant');
      }
    });
    return next;
  }

  function summary(rows, groupId) {
    const members = groupFor(rows, groupId);
    const keys = new Set(members.flatMap(row => Object.keys(row || {})).filter(key => !['variantOverrides', 'modelSharedValues'].includes(key)));
    const mixed = {};
    keys.forEach(key => {
      const values = [...new Set(members.map(row => text(effectiveValue(row, key, rows))))];
      if (values.length > 1) mixed[key] = true;
    });
    return { id: groupId, count: members.length, parent: members.find(row => row.modelGroupRole === 'parent') || members[0] || null, mixed };
  }

  function bestPricing(pricing,parse){let best=null;Object.entries(pricing||{}).forEach(([name,value])=>{const number=parse(value);if(value!==''&&value!=null&&Number.isFinite(number)&&number>0&&(!best||number<best.price))best={name,price:number};});return best;}
  function confirmedPricing(row,pricing,parse,normalize=text){const name=normalize(row&&row.confirmedManufacturer),raw=pricing&&pricing[name],number=parse(raw);return name&&raw!==''&&raw!=null&&Number.isFinite(number)&&number>0?{name,price:number}:null;}
function kolImportMatchKey(plmId, modelKod,helpers){
  const {norm,turknorm}=helpers;
  const plm=turknorm(norm(plmId)), model=turknorm(norm(modelKod));
  if(!plm && !model) return '';
  return plm+'\u0000'+model;
}
function kolImportReadField(row, key,helpers){
  const {norm,turknorm}=helpers;
  if(!row) return '';
  if(key.startsWith('pricing:')) return norm((row.pricing||{})[key.slice(8)]);
  if(key==='buyingSampleApproved') return row[key]?'true':'false';
  return norm(row[key]);
}
function kolPlmCodePrefix(value,helpers){
  const {norm,turknorm}=helpers;
  const raw=norm(value);if(!raw)return '';
  return norm(raw.split(/\s+-\s+/,1)[0]);
}
function kolPlmSeason(value,helpers){
  const {norm,turknorm}=helpers;
  const raw=norm(value);if(!raw)return '';
  const m=/^([WS]\d+)/i.exec(raw);return m?m[1].toUpperCase():raw;
}
function kolPlmBrandToken(styleName,helpers){
  const {norm,turknorm}=helpers;
  const raw=turknorm(norm(styleName));return raw?raw.split('-')[0].trim():'';
}
function kolPlmImportTouchedKeys(){
  return ['plmId','modelKod','productMainDefinition','specialCode','season','mag','mmyg','buyingGroup','colourCode','colour','fabric','fit','line','urunTipi','lisans','licensor'];
}
function kolPlmImportColourKey(row,helpers){
  const {norm,turknorm}=helpers;
  return turknorm(norm(row&&row.colourCode||row&&row.colour));
}
function kolPlmNormalizeDirectRecord(record,helpers){
  const {norm,migrateKolRow,kolPlmIsLicensedDesignSource,kolPlmBrandToken,kolPlmTranslate,kolPlmSeason,kolPlmCodePrefix}=helpers;
  const r=record||{};
  const modelKod=norm(r.styleName);
  const source={
    lineRaw:norm(r.lineRaw),categoryRaw:norm(r.categoryRaw),designSourceRaw:norm(r.designSourceRaw),brandToken:kolPlmIsLicensedDesignSource(r.designSourceRaw)?kolPlmBrandToken(modelKod):'',
    productMainDefinition:norm(r.productMainDefinition),buyerRaw:norm(r.buyerRaw),fmhSpecialist:norm(r.fmhSpecialist),
    productType:norm(r.productType),ageGroup:norm(r.ageGroup),statusRaw:norm(r.statusRaw),orderStatusRaw:norm(r.orderStatusRaw),
  };
  const row=migrateKolRow({
    id:0,plmId:norm(r.plmId),modelKod,productMainDefinition:kolPlmTranslate('productMainDefinition',source.productMainDefinition),specialCode:norm(r.specialCode),season:kolPlmSeason(r.season),
    mag:kolPlmCodePrefix(r.magRaw),mmyg:kolPlmCodePrefix(r.mmygRaw),buyingGroup:norm(r.buyingGroup),
    colourCode:norm(r.colourCode),colour:norm(r.colour),fabric:norm(r.fabric),fit:norm(r.fit),
    line:kolPlmTranslate('line',source.lineRaw),urunTipi:kolPlmTranslate('category',source.categoryRaw),
    lisans:kolPlmTranslate('license',source.brandToken),licensor:norm(r.licensor),pricing:{},pricingSent:{},img:null,_plmSource:source,
  });
  // Excel yolunda karşılığı olmayan, yalnız Direct PLM'e özgü bilgi:
  // Style ID (PLM link sözlüğü zaten sunucu tarafında ayrıca güncellendi,
  // ama tekil model detayında/§12 URL kurucusunda hızlı erişim için taşınır)
  // ve görselin kaynağı (henüz İNDİRİLMEDİ — §13, görsel ayrı akışın işi).
  row._plmStyleId=norm(r.styleId);row._plmImageUrl=norm(r.imageUrl);
  return row;
}

function kolBuildPlmImportPlan(kolRows,parsedRows,helpers){
  const {norm,turknorm,kolImportMatchKey,kolPlmNormalizeId,kolPlmImportColourKey,kolImportReadField,kolImportFieldLabel,knownByKey,touched}=helpers;
  const byKey=new Map(),byPlm=new Map();
  kolRows.forEach(row=>{
    const key=kolImportMatchKey(row.plmId,row.modelKod);if(key&&!byKey.has(key))byKey.set(key,row);
    const plm=kolPlmNormalizeId(row.plmId);
    if(plm){if(!byPlm.has(plm))byPlm.set(plm,[]);byPlm.get(plm).push(row);}
  });

  const existing=[],creates=[],ambiguous=[],inputDuplicates=[],seenInputPlm=new Set();
  (parsedRows||[]).forEach(parsed=>{
    const plm=kolPlmNormalizeId(parsed.plmId),key=kolImportMatchKey(parsed.plmId,parsed.modelKod);
    // Aynı PLM ID PLM Excel içinde birden fazla kez geçerse Koleksiyon'da ikinci bir
    // model oluşturma. İlk kayıt işlenir, diğerleri raporlanıp atlanır.
    const parsedColour=kolPlmImportColourKey(parsed),inputIdentity=plm?`${plm}\u0000${parsedColour}`:key;
    if(plm&&seenInputPlm.has(inputIdentity)){inputDuplicates.push(parsed);return;}
    if(plm)seenInputPlm.add(inputIdentity);
    const plmTargets=plm?(byPlm.get(plm)||[]):[];
    let target=null;
    if(plmTargets.length===1){
      const only=plmTargets[0];
      if(!parsedColour||!kolPlmImportColourKey(only)||kolPlmImportColourKey(only)===parsedColour)target=only;
    }else if(plmTargets.length>1){
      const colourMatches=parsedColour?plmTargets.filter(row=>kolPlmImportColourKey(row)===parsedColour):[];
      if(colourMatches.length===1)target=colourMatches[0];
      else {
      const modelKey=turknorm(norm(parsed.modelKod));
      const exact=plmTargets.filter(row=>turknorm(norm(row.modelKod))===modelKey);
      if(!parsedColour&&exact.length===1)target=exact[0];
      else {ambiguous.push({parsed,targets:plmTargets});return;} // PLM mevcutsa ASLA yeni kopya üretme.
      }
    }else target=key?byKey.get(key):null;
    if(!target){creates.push(parsed);return;}
    const changes=[];
    touched.forEach(fieldKey=>{
      const to=kolImportReadField(parsed,fieldKey);if(!to)return; // PLM'de olmayan/çevirisi onaylanmamış alan mevcut değeri silmez.
      const from=kolImportReadField(target,fieldKey);if(from!==to)changes.push({key:fieldKey,label:kolImportFieldLabel(fieldKey,knownByKey),from,to});
    });
    // PLM ID Koleksiyon'da mevcutsa değişiklik olmasa bile kullanıcıya model model sorulur.
    // Güncelleme yalnız changes içindeki PLM-kaynaklı alanları yazar; pricing/notlar ve
    // diğer Buyer Log kullanıcı alanları hedef satırda aynen kalır.
    existing.push({target,parsed,changes,hasImage:Boolean(parsed._plmImage),matchedByPlm:Boolean(plm&&plmTargets.length)});
  });
  return {existing,creates,ambiguous,inputDuplicates,knownByKey};
}

function kolApplyApprovedPlmUpdate(item,kolImportWriteField){
  // Yalnız PLM'nin açıkça yönettiği alanlar yazılır. pricing, pricingSent, not,
  // confirmedManufacturer, targetPrice, Buying Sample ve diğer kullanıcı alanlarına
  // hiçbir assignment yapılmaz; bu nedenle mevcut kullanıcı verisi kaybolmaz.
  item.changes.forEach(change=>kolImportWriteField(item.target,change.key,change.to));
  item.target._plmSource={...(item.target._plmSource||{}),...(item.parsed._plmSource||{})};
}

function kolParseQuantityNum(v){
  if(v==null || String(v).trim()==='') return NaN;
  const s=String(v).trim();
  const neg=s.startsWith('-');
  const digits=s.replace(/\D/g,'');
  if(!digits) return NaN;
  const n=Number(digits);
  return neg?-n:n;
}

function kolParseMoneyNum(v){
  if(v==null || v==='') return NaN;
  return Number(String(v).trim().replace('%','').replace(',', '.'));
}
  return { writeGroupedValue,kolParseQuantityNum,kolParseMoneyNum,kolApplyApprovedPlmUpdate,kolImportMatchKey,kolImportReadField,kolPlmCodePrefix,kolPlmSeason,kolPlmBrandToken,kolPlmImportTouchedKeys,kolPlmImportColourKey,kolPlmNormalizeDirectRecord,kolBuildPlmImportPlan,bestPricing,confirmedPricing,identityOf, colourIdentity, fieldMetadata, normalizeRows, linkImportedColourVariants, groupFor, hasVariantOverride, effectiveValue, createValueReader, setSharedValue, setVariantOverride, clearVariantOverride, clearAllVariantOverrides, setPricingOverrides, visibleRows, mergeGroups, detachVariant, relinkVariant, summary };
});
