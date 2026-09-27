'use strict';

/* Sayfa Horizon'u route'ları (alanlar, değerler, önizleme, kullanıcıdan kopyalama)
   server.js'ten birebir taşındı (davranış değişikliği yok). Kayıt, server.js'te
   blokların eskiden durduğu satırda yapılır; Express route SIRASI korunur.
   Bağımlılıklar kayıt anında enjekte edilir; çalışma sırasında yeniden atanan
   değerler (yok) canlı okuyucu fonksiyonla okunur. */
module.exports = function registerHorizonRoutes(app, deps) {
  const {
    USER_WORKSPACE_MODULES,
    apiError,
    cacheForUser,
    express,
    horizonFields,
    horizonFilterMapping,
    intakeHorizonFields,
    intakeLiveFields,
    intakeReport,
    intakeStore,
    loadModelConnections,
    logRuntimeFailure,
    modelQuery,
    queryModelDistinctValues,
    resolveDynamicHorizonValueSource,
    resolveHorizonValueSource,
    selectConnection,
    userAccess,
    userPreferences,
  } = deps;


/* ===================================================================
   v7.81 — ASAS FİLTRESİNİ IAS İÇİN ÖNERİR (yazmaz)

   Bir modül iki kaynaktan besleniyorsa (ör. Genel Bakış: ASAS + IAS),
   kullanıcı aynı filtreyi iki kez kurmak zorunda kalmasın. Bu uç ASAS
   tarafındaki koşulları IAS alanlarına eşleyip ÖNERİ döner; hiçbir şey
   kaydetmez. Yazma, kullanıcının düzenleyicide onaylayıp kaydetmesiyle
   olur — alan adları birebir tutmayabildiği için onay şart.
   =================================================================== */
app.get('/api/horizon/filter-mapping', userAccess.requireArea('source'), userAccess.requirePermission('manageModelConnections'), async (req, res) => {
  try {
    const target = String(req.query && req.query.target || '').trim().toLowerCase();
    const fromRole = String(req.query && req.query.from || 'asas').trim().toLowerCase();
    const toRole = String(req.query && req.query.to || 'intake').trim().toLowerCase();
    if (!target) return res.status(400).json({ error: 'target zorunlu.', code: 'TARGET_REQUIRED' });

    const items = loadModelConnections().items || [];
    const scopeFor = role => {
      const item = items.find(entry => entry && entry.role === role);
      if (!item || !Array.isArray(item.scopes)) return null;
      const scope = item.scopes.find(entry => entry && Array.isArray(entry.targets) && entry.targets.includes(target));
      return scope ? { item, scope } : null;
    };
    const from = scopeFor(fromRole);
    const to = scopeFor(toRole);
    /* Modül gerçekten İKİ kaynaktan beslenmiyorsa öneri üretmek anlamsız;
       sessiz boş liste yerine sebebi söylenir. */
    if (!from) return res.status(409).json({ error: 'Bu modülü besleyen bir ' + fromRole.toUpperCase() + ' kaynağı yok.', code: 'SOURCE_SCOPE_MISSING' });
    if (!to) return res.status(409).json({ error: 'Bu modülü besleyen bir ' + toRole.toUpperCase() + ' kaynağı yok.', code: 'TARGET_SCOPE_MISSING' });

    const groups = (from.scope.horizon && Array.isArray(from.scope.horizon.groups)) ? from.scope.horizon.groups : [];
    if (!groups.length) return res.status(409).json({ error: 'Kaynak filtresi boş — eşlenecek koşul yok.', code: 'SOURCE_FILTER_EMPTY' });

    /* Hedef alanları CANLI şemadan okunur: eşleme, kullanıcının gerçekten
       seçebileceği alanlar üzerinden yapılmalı. Şema okunamazsa öneri
       üretmek yerine hata döneriz — eski/eksik listeden üretilen bir öneri
       kullanıcıyı yanlış onaya sürükler. */
    let targetFields = [];
    if (toRole === 'intake') {
      const found = await intakeLiveFields(to.item || undefined);
      targetFields = intakeHorizonFields(found.fields);
    } else {
      const schema = await modelQuery.discoverSchema({ server: to.item.server, catalog: to.item.catalog });
      targetFields = horizonFields.fromSchema(schema);
    }

    const result = horizonFilterMapping.proposeMapping({ groups, targetFields });
    res.set('Cache-Control', 'no-store').json({
      ok: true, target, from: fromRole, to: toRole,
      fromSource: String(from.item.name || from.item.catalog || ''),
      toSource: String(to.item.name || to.item.catalog || ''),
      ...result,
    });
  } catch (err) { apiError(res, err, 'Filtre eşlemesi üretilemedi.'); }
});
app.get('/api/horizon/fields', async (req, res) => {
  try {
    const profile = req.currentUser || null;
    const target = String(req.query && req.query.target || 'cp').trim().toLowerCase();
    const sourceId = String(req.query && req.query.sourceId || '').trim();
    const connections = loadModelConnections().items || [];
    const explicitConnection = sourceId ? connections.find(item => item && String(item.id || '') === sourceId) || null : null;
    let fields = horizonFields.FIELDS;
    let schemaError = '';
    const connection = explicitConnection || selectConnection(connections, target);
    const intakeTarget = target === 'intake' || Boolean(connection && connection.role === 'intake');
    if (intakeTarget) {
      try {
        const found = await intakeLiveFields(connection || undefined);
        fields = intakeHorizonFields(found.fields);
        schemaError = (found.schema.errors || []).map(item => item && item.error).filter(Boolean).join(' · ');
      } catch (error) {
        const snapshot = intakeStore.loadSnapshot(req.currentUser.id);
        fields = intakeHorizonFields(snapshot && snapshot.fields && snapshot.fields.length ? snapshot.fields : intakeReport.defaultFields());
        schemaError = String(error && error.message || error);
      }
    } else if (connection) {
      try {
        const schema = await modelQuery.discoverSchema({ server: connection.server, catalog: connection.catalog });
        fields = horizonFields.fromSchema(schema);
        schemaError = (schema.errors || []).map(item => item && item.error).filter(Boolean).join(' · ');
      } catch (error) {
        schemaError = String(error && error.message || error);
      }
    }
    res.set('Cache-Control', 'no-store').json({
      ok: true,
      fields,
      schemaError,
      sourceId: connection && connection.id || '',
      sourceRole: connection && connection.role || '',
      operators: Object.entries(horizonFields.OPERATORS).map(([id, item]) => ({ id, arity: item.arity, label: item.label })),
      // Kullanıcı kartındaki MAG / MMYG / Buying Group — "bilgilerimden doldur".
      profileScope: profile ? {
        mags: Array.isArray(profile.mags) ? profile.mags : [],
        mmygs: Array.isArray(profile.mmygs) ? profile.mmygs : [],
        buyingGroups: Array.isArray(profile.buyingGroups) ? profile.buyingGroups : [],
      } : { mags: [], mmygs: [], buyingGroups: [] },
    });
  } catch (err) { apiError(res, err, 'Ufuk alanları okunamadı.'); }
});

/* Bir alanın seçilebilir değerleri. Sayfa Horizon'u, Horizon ve Bağlantı
   ile aynı canonical eşlemeyi kullanarak ASAS database'inin TAM tekil değer
   listesini okur; mevcut kişisel Horizon veya yüklü sayfa satırları bu listeyi
   daraltmaz. Database erişilemezse kullanıcı çalışmaya devam edebilsin diye
   yerel/yüklü satırlar yalnız açıkça işaretlenmiş geri dönüş kaynağıdır. */
app.get('/api/horizon/values', async (req, res) => {
  try {
    const field = String(req.query && req.query.field || '').trim();
    const table = String(req.query && req.query.table || '').trim();
    const column = String(req.query && req.query.column || '').trim() || field;
    const target = String(req.query && req.query.target || 'cp').trim().toLowerCase();
    const sourceId = String(req.query && req.query.sourceId || '').trim();
    if (!field) return res.status(400).json({ error: 'field zorunlu.', code: 'FIELD_REQUIRED' });
    const connections = loadModelConnections().items || [];
    const explicitConnection = sourceId ? connections.find(item => item && String(item.id || '') === sourceId) || null : null;
    if (sourceId && !explicitConnection) return res.status(404).json({ error: 'Kaynak bulunamadı.', code: 'SOURCE_NOT_FOUND' });
    let databaseSource = null;
    if (table) {
      databaseSource = explicitConnection
        ? {
          connectionId: String(explicitConnection.id || ''),
          server: String(explicitConnection.server || ''),
          catalog: String(explicitConnection.catalog || ''),
          table,
          field: column,
        }
        : resolveDynamicHorizonValueSource(connections, target, table, column);
      if (!databaseSource || !databaseSource.server || !databaseSource.catalog) return res.status(400).json({ error: 'Geçersiz Horizon alanı.', code: 'HORIZON_FIELD_INVALID' });
      const schema = await modelQuery.discoverSchema({ server: databaseSource.server, catalog: databaseSource.catalog });
      const valid = (schema.columns || []).some(item => String(item.table || '').trim().toLocaleLowerCase('tr-TR') === table.toLocaleLowerCase('tr-TR')
        && String(item.name || '').trim().toLocaleLowerCase('tr-TR') === column.toLocaleLowerCase('tr-TR'));
      if (!valid) return res.status(400).json({ error: 'Geçersiz ASAS Horizon sütunu.', code: 'HORIZON_FIELD_INVALID' });
    } else if (!horizonFields.FIELDS.some(item => item.header === field)) {
      return res.status(400).json({ error: 'Geçersiz Horizon alanı.', code: 'HORIZON_FIELD_INVALID' });
    } else {
      if (explicitConnection) {
        const scope = (Array.isArray(explicitConnection.scopes) ? explicitConnection.scopes : []).find(item =>
          item && item.enabled !== false
          && (Array.isArray(item.targets) ? item.targets : []).some(value => String(value || '').trim().toLowerCase() === target));
        const fallbackTable = String(scope && scope.horizon && scope.horizon.table
          || explicitConnection.horizon && explicitConnection.horizon.table || '').trim();
        const raw = explicitConnection.mapping && explicitConnection.mapping[field];
        const entry = typeof raw === 'string' ? { name: raw, table: fallbackTable, kind: 'column' }
          : (raw && typeof raw === 'object' ? raw : null);
        if (entry && entry.kind !== 'measure' && String(entry.name || '').trim()) {
          databaseSource = {
            connectionId: String(explicitConnection.id || ''),
            server: String(explicitConnection.server || ''),
            catalog: String(explicitConnection.catalog || ''),
            table: String(entry.table || fallbackTable || '').trim(),
            field: String(entry.name || '').trim(),
          };
        }
      } else {
        databaseSource = resolveHorizonValueSource(connections, target, field);
      }
    }
    let databaseError = '';
    if (databaseSource) {
      try {
        const distinct = await queryModelDistinctValues({ ...databaseSource, search: req.query && req.query.q, offset: req.query && req.query.offset }, Math.min(20000, Math.max(50, Number(req.query && req.query.limit) || 1000)));
        return res.set('Cache-Control', 'no-store').json({
          ok: true, field, target,
          values: distinct.values,
          /* Değerin ALAN TİPİ birlikte gider: ekran koşulu bu tiple damgalar ve
             seçilen değer aynı şemaya karşı doğrudan filtre olarak çalışır. */
          valueType: distinct.valueType || '',
          rowCount: null,
          truncated: Boolean(distinct.truncated),
          source: 'database',
          connectionId: databaseSource.connectionId,
          cached: Boolean(distinct.cached),
        });
      } catch (error) {
        databaseError = String(error && error.message ? error.message : error);
        logRuntimeFailure('horizonDatabaseValues', error);
      }
    }

    if (target === 'intake' || (explicitConnection && explicitConnection.role === 'intake')) {
      const snapshot = intakeStore.loadSnapshot(req.currentUser.id);
      const snapshotFields = Array.isArray(snapshot && snapshot.fields) ? snapshot.fields : [];
      const meta = snapshotFields.find(item => String(item.id) === field
        || (String(item.table).toLocaleLowerCase('tr-TR') === table.toLocaleLowerCase('tr-TR') && String(item.name).toLocaleLowerCase('tr-TR') === column.toLocaleLowerCase('tr-TR')));
      const seen = new Set();
      if (meta) {
        for (const row of Array.isArray(snapshot && snapshot.rows) ? snapshot.rows : []) {
          const rawValue = row && row[meta.id];
          const value = rawValue == null ? '' : String(rawValue).trim();
          if (value) seen.add(value);
        }
      }
      return res.set('Cache-Control', 'no-store').json({ok:true,field,target,values:[...seen].sort((a,b)=>a.localeCompare(b,'tr',{sensitivity:'base'})),rowCount:Array.isArray(snapshot&&snapshot.rows)?snapshot.rows.length:0,truncated:false,source:'intake-snapshot-fallback',warning:databaseError||'INTAKE canlı kaynağı kullanılamadı.'});
    }
    if (explicitConnection && explicitConnection.role === 'antrepo') {
      return res.set('Cache-Control', 'no-store').json({
        ok: true, field, target, values: [], rowCount: 0, truncated: false,
        source: 'database-unavailable', connectionId: explicitConnection.id,
        warning: databaseError || 'IAS canlı kaynağı kullanılamadı.',
      });
    }
    const cache = cacheForUser(req);
    const rows = Array.isArray(cache && cache.asasOrders) ? cache.asasOrders : [];
    const seen = new Set();
    for (const row of rows) {
      const value = String(horizonFields.rowValue(row, table ? column : field) == null ? '' : horizonFields.rowValue(row, table ? column : field)).trim();
      if (!value) continue;
      seen.add(value);
      if (seen.size >= 2000) break;
    }
    const values = [...seen].sort((a, b) => a.localeCompare(b, 'tr', { sensitivity: 'base' }));
    res.set('Cache-Control', 'no-store').json({
      ok: true, field, target, values, rowCount: rows.length,
      truncated: seen.size >= 2000,
      source: 'loaded-data-fallback',
      warning: databaseError || (databaseSource ? '' : 'Alan için database eşlemesi bulunamadı.'),
    });
  } catch (err) { apiError(res, err, 'Alan değerleri okunamadı.'); }
});

/* Ufkun kaç satır getireceğinin ÖNİZLEMESİ. Kullanıcı kaydetmeden önce
   sonucu görür; "kaydettim ama ekran boş" durumu böylece kapanır. */
app.post('/api/horizon/preview', express.json({ limit: '256kb' }), (req, res) => {
  try {
    const horizon = (req.body || {}).horizon;
    const target = String(req.body && req.body.target || 'cp').trim().toLowerCase();
    const cache = cacheForUser(req);
    const snapshot = target === 'intake' ? intakeStore.loadSnapshot(req.currentUser.id) : null;
    const rows = target === 'intake'
      ? (Array.isArray(snapshot && snapshot.rows) ? snapshot.rows : [])
      : (Array.isArray(cache && cache.asasOrders) ? cache.asasOrders : []);
    const kept = horizonFields.filterRows(rows, horizon);
    res.set('Cache-Control', 'no-store').json({
      ok: true, total: rows.length, matched: kept.length,
      bounded: horizonFields.isBounded(horizon),
      summary: horizonFields.describeHorizon(horizon, String(req.query && req.query.lang || 'tr')),
    });
  } catch (err) { apiError(res, err, 'Ufuk önizlemesi hesaplanamadı.'); }
});

/* Kullanıcıdan kopyalama: kimlerden kopyalanabilir ve o kişinin ufku nedir.
   Ufuk bir FİLTREDİR, veri değil; bu yüzden aktif kullanıcılar arasında
   paylaşılabilir. Kopyalanan ufuk yalnız KENDİ çalışma alanınıza yazılır. */
app.get('/api/horizon/users', (req, res) => {
  try {
    const module = String(req.query && req.query.module || '').toLowerCase();
    const me = String(req.currentUser && req.currentUser.id || '');
    const items = userAccess.allPublicProfiles()
      .filter(profile => profile && profile.id !== me && profile.status !== 'INACTIVE')
      .map(profile => {
        const horizon = USER_WORKSPACE_MODULES.has(module) ? userPreferences.getHorizon(profile.id, module) : null;
        return {
          id: profile.id,
          name: profile.displayName || profile.username || profile.id,
          role: profile.systemRoleLabel || profile.roleLabel || '',
          mags: profile.mags || [], mmygs: profile.mmygs || [], buyingGroups: profile.buyingGroups || [],
          hasHorizon: Boolean(horizon && Object.keys(horizon).length),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'tr', { sensitivity: 'base' }));
    res.set('Cache-Control', 'no-store').json({ ok: true, users: items });
  } catch (err) { apiError(res, err, 'Kullanıcı listesi okunamadı.'); }
});
app.get('/api/horizon/from-user/:id', (req, res) => {
  try {
    const module = String(req.query && req.query.module || '').toLowerCase();
    if (!USER_WORKSPACE_MODULES.has(module)) return res.status(400).json({ error: 'Geçersiz çalışma alanı modülü.', code: 'INVALID_WORKSPACE_MODULE' });
    const target = userAccess.profileById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı.', code: 'USER_NOT_FOUND' });
    const stored = userPreferences.getHorizon(target.id, module);
    const roleEntries = userAccess.roleWorkspaceEntries(target);
    const resolved = userPreferences.resolveHorizon(target.id, module, null, {}, roleEntries);
    // Kişisel ufku yoksa o kullanıcının EKRANINDA GEÇERLİ olan ufuk döner;
    // "kopyaladım ama boş geldi" durumu oluşmaz.
    const horizon = stored && Object.keys(stored).length ? stored : resolved;
    res.set('Cache-Control', 'no-store').json({
      ok: true, module, userId: target.id,
      userName: target.displayName || target.username || target.id,
      horizon: horizon || {}, fromPersonal: Boolean(stored && Object.keys(stored).length),
    });
  } catch (err) { apiError(res, err, 'Kullanıcının ufku okunamadı.'); }
});

/* v7.81 — /api/horizon-presets KALDIRILDI (kullanıcı kararı).
   Ön ayar, hiç seçim yapmamış kullanıcıya profiline göre otomatik bir ufuk
   atıyordu. Kullanıcı bunu görmüyor, ortak filtreyi değiştirip hiçbir şeyin
   değişmediğini fark ediyordu. Ufuk artık ya kullanıcının kendi ayarından ya
   da Veri Yönetimi'ndeki ortak filtreden gelir — ikisi de görünür.
   horizon-presets.json diskte durur; okunmaz. */

/* Moderatör / Yönetici, kullanıcılar panelinden BİR KULLANICININ ufkunu
   doğrudan ayarlar. Kişisel ufuk her zaman ön ayarı yendiği için, buradan
   yazılan değer kullanıcının ekranında hemen geçerli olur; kullanıcı
   isterse kendi ekranından değiştirebilir (talep: "Kullanıcı, Yönetici ve
   Moderatör istediğinde bu ufukları değiştirebilsin"). */
app.put('/api/iam/users/:id/horizon', express.json({ limit: '2mb' }), (req, res) => {
  try {
    const target = userAccess.profileById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı.', code: 'USER_NOT_FOUND' });
    // Yönetici yalnız KENDİ ekibindeki kullanıcının ufkunu ayarlayabilir;
    // Moderatör hepsini. Yetkisiz istek hiç veri görmeden reddedilir (§32).
    if (!userAccess.canManageTarget(req.currentUser, target)) {
      return res.status(403).json({ error: 'Bu kullanıcı sizin yönetim alanınızda değil.', code: 'USER_NOT_MANAGEABLE' });
    }
    const body = req.body || {};
    const module = String(body.module || '').toLowerCase();
    if (!USER_WORKSPACE_MODULES.has(module)) return res.status(400).json({ error: 'Geçersiz çalışma alanı modülü.', code: 'INVALID_WORKSPACE_MODULE' });
    /* v7.81: ön ayardan uygulama kaldırıldı; yönetici doğrudan bir Horizon
       yazar. Ön ayar kavramı artık yok (bkz. /api/horizon-presets notu). */
    const horizon = body.horizon;
    if (!horizon || typeof horizon !== 'object') return res.status(400).json({ error: 'Uygulanacak Horizon seçin.', code: 'HORIZON_REQUIRED' });
    userPreferences.saveHorizon(target.id, module, horizon, { connectionId: String(body.connectionId || ''), role: String(body.role || '') });
    userAccess.appendAudit(req.currentUser, 'USER_HORIZON_SET', target.id, {
      targetName: target.displayName || target.username, module, connectionId: String(body.connectionId || ''),
    });
    res.json({ ok: true, module, horizon: userPreferences.getHorizon(target.id, module) });
  } catch (err) { apiError(res, err, 'Kullanıcı Horizon ayarı kaydedilemedi.'); }
});
app.post('/api/iam/users/:id/horizon/reset', express.json({ limit: '256kb' }), (req, res) => {
  try {
    const target = userAccess.profileById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı.', code: 'USER_NOT_FOUND' });
    // Yönetici yalnız KENDİ ekibindeki kullanıcının ufkunu ayarlayabilir;
    // Moderatör hepsini. Yetkisiz istek hiç veri görmeden reddedilir (§32).
    if (!userAccess.canManageTarget(req.currentUser, target)) {
      return res.status(403).json({ error: 'Bu kullanıcı sizin yönetim alanınızda değil.', code: 'USER_NOT_MANAGEABLE' });
    }
    const module = String((req.body || {}).module || 'all').toLowerCase();
    if (module !== 'all' && !USER_WORKSPACE_MODULES.has(module)) return res.status(400).json({ error: 'Geçersiz çalışma alanı modülü.', code: 'INVALID_WORKSPACE_MODULE' });
    const saved = userPreferences.resetWorkspace(target.id, module, ['horizon']);
    userAccess.appendAudit(req.currentUser, 'USER_HORIZON_RESET', target.id, { targetName: target.displayName || target.username, module, removedKeys: saved.removedKeys || [] });
    res.json({ ok: true, module, removedKeys: saved.removedKeys || [] });
  } catch (err) { apiError(res, err, 'Kullanıcı Horizon ayarı sıfırlanamadı.'); }
});

};
