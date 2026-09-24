(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BLCollectionModelGroups = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const text = value => String(value == null ? '' : value).trim();
  const normal = value => text(value).replace(/\s+/g, ' ').toLocaleUpperCase('tr-TR');
  const identityOf = row => [text(row && row.plmId), normal(row && row.modelKod), text(row && row.inStoreMonth)].join('\u0000');
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

  // PLM aktarımında In Store Month henüz girilmemiş olabilir. Bu yüzden yalnız
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

  function effectiveValue(row, key, rows) {
    if (!row) return '';
    // Override existence and override value are intentionally separate. Empty
    // string, 0, false and null are all valid explicit colour-level values and
    // must never fall back to the model merely because they are falsy.
    if (hasVariantOverride(row, key)) return row.variantOverrides[key];
    if (row.modelGroupRole !== 'variant' && row.modelSharedValues && Object.prototype.hasOwnProperty.call(row.modelSharedValues, key)) return row.modelSharedValues[key];
    if (fieldMetadata(key).inheritance === 'model') {
      const parent = groupFor(rows, row.modelGroupId).find(item => item.modelGroupRole === 'parent');
      if (parent && parent !== row) {
        if (parent.modelSharedValues && Object.prototype.hasOwnProperty.call(parent.modelSharedValues, key)) return parent.modelSharedValues[key];
        if (parent[key] !== undefined && parent[key] !== null && text(parent[key]) !== '') return parent[key];
      }
    }
    return row[key];
  }

  function setSharedValue(rows, groupId, key, value) {
    const next = (rows || []).map(clone), members = groupFor(next, groupId);
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

  function setVariantOverride(rows, id, key, value) {
    const next = (rows || []).map(clone), row = next.find(item => String(item && item.id) === String(id));
    if (!row) return next;
    row.variantOverrides = { ...(row.variantOverrides || {}), [key]: clone(value) };
    row[key] = clone(value);
    return next;
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

  return { identityOf, colourIdentity, fieldMetadata, normalizeRows, linkImportedColourVariants, groupFor, hasVariantOverride, effectiveValue, setSharedValue, setVariantOverride, clearVariantOverride, clearAllVariantOverrides, setPricingOverrides, visibleRows, mergeGroups, detachVariant, relinkVariant, summary };
});
