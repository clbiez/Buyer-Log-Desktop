'use strict';

/* Ön Ayar Paylaşımı uçları (kullanıcı menüsü → "Ön Ayar Paylaşımı").
   Talep eden kullanıcı yalnız KENDİ çalışma alanına yazar; kaynak kullanıcının
   kaydı yalnız okunur. Ek alan yetkisi aranmaz: aktarılan şey kişisel sunum
   tercihidir, iş verisi değildir (bkz. server/lib/preset-share.js). */
module.exports = function registerPresetShareRoutes(app, deps) {
  const {
    apiError,
    express,
    presetShare,
    userAccess,
  } = deps;

const activeProfile = profile => Boolean(profile) && profile.enabled !== false && profile.status !== 'INACTIVE';
const displayName = profile => profile.displayName || profile.username || profile.id;
function sourceProfile(req, id) {
  const profile = userAccess.profileById(id);
  if (!activeProfile(profile)) throw Object.assign(new Error('Kullanıcı bulunamadı.'), { statusCode: 404, code: 'USER_NOT_FOUND' });
  if (profile.id === req.currentUser.id) throw Object.assign(new Error('Kendi ayarlarınızı kendinize aktaramazsınız.'), { statusCode: 400, code: 'PRESET_SHARE_SELF' });
  return profile;
}

app.get('/api/preset-share/users', (req, res) => {
  try {
    const me = String(req.currentUser && req.currentUser.id || '');
    const users = userAccess.allPublicProfiles()
      .filter(profile => activeProfile(profile) && profile.id !== me)
      .map(profile => ({ id: profile.id, name: displayName(profile), title: profile.title || '', role: profile.systemRoleLabel || profile.roleLabel || '' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr', { sensitivity: 'base' }));
    res.set('Cache-Control', 'no-store').json({ ok: true, users, undo: presetShare.undoInfo(me) });
  } catch (err) { apiError(res, err, 'Kullanıcı listesi okunamadı.'); }
});

app.get('/api/preset-share/preview/:id', (req, res) => {
  try {
    const source = sourceProfile(req, req.params.id);
    res.set('Cache-Control', 'no-store').json({ ok: true, user: { id: source.id, name: displayName(source) }, items: presetShare.preview(source.id) });
  } catch (err) { apiError(res, err, 'Kullanıcının ön ayarları okunamadı.'); }
});

app.post('/api/preset-share/apply', express.json({ limit: '64kb' }), (req, res) => {
  try {
    const body = req.body || {}, source = sourceProfile(req, body.sourceUserId);
    const result = presetShare.apply({ sourceUserId: source.id, targetUserId: req.currentUser.id, items: body.items, mode: body.mode });
    userAccess.appendAudit(req.currentUser, 'USER_PRESET_SHARE_PULL', req.currentUser.id, {
      sourceUserId: source.id, sourceName: displayName(source), mode: result.mode, items: result.items,
      changed: result.changed, keys: result.setKeys.length + result.removedKeys.length, profiles: result.profiles || [],
    }, req);
    res.json({ ...result, sourceName: displayName(source) });
  } catch (err) { apiError(res, err, 'Ön ayarlar aktarılamadı.'); }
});

app.post('/api/preset-share/undo', express.json({ limit: '8kb' }), (req, res) => {
  try {
    const result = presetShare.undo(req.currentUser.id);
    userAccess.appendAudit(req.currentUser, 'USER_PRESET_SHARE_UNDO', req.currentUser.id, { sourceUserId: result.sourceUserId, keys: result.setKeys.length + result.removedKeys.length, profiles: result.profiles }, req);
    res.json(result);
  } catch (err) { apiError(res, err, 'Ön ayar aktarımı geri alınamadı.'); }
});
};
