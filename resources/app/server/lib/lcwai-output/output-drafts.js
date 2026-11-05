'use strict';

/*
 * AI Çıktı Düzenleyici — düzenlenebilir taslaklar.
 *
 * LCW AI cevabı doğrulanıp normalize edildikten sonra dosyanın KAYNAK
 * YAPISI (sunum JSON'u, çalışma kitabı JSON'u ya da temizlenmiş rapor
 * HTML'i) taslak olarak saklanır. Kullanıcı dosyayı Buyer Log içinde
 * düzenleyip yeniden oluşturabilir; LCW AI'a tekrar gidilmez.
 *
 * Taslak, oluşturulan dosyayla aynı içeriği taşır: ham AI cevabı, istem,
 * token veya Authorization bilgisi YAZILMAZ. Yalnız sahibine açılır ve
 * yerel veri kökünde durur (Downloads'a değil). Model görselleri, dosya
 * yeniden oluşturulurken tekrar istenmesin diye taslağın yanında tutulur.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { isExpired } = require('./output-retention');
const ID_RE = /^[a-f0-9]{24}$/;

function defaultRoot() {
  return path.join(require('../../user-data').LOCAL_DATA_ROOT, 'ai-output-drafts');
}

function createDraftStore(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  let rootPath = options.root || null;
  const root = () => (rootPath || (rootPath = defaultRoot()));
  // Sahip kimliği klasör adına doğrudan yazılmaz (yol enjeksiyonu yok).
  const ownerDir = ownerId => path.join(root(), crypto.createHash('sha256').update(String(ownerId || 'default')).digest('hex').slice(0, 32));
  const fileOf = (ownerId, id) => path.join(ownerDir(ownerId), `${id}.json`);
  const lastPrunedAt = new Map();

  function write(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value), 'utf8');
    fs.renameSync(temp, file);
  }

  /* Son oluşturma/düzenlemeden itibaren 60 gün; adet sınırıyla erken silme yok. */
  function prune(ownerId) {
    const dir = ownerDir(ownerId);
    const at = now();
    const last = lastPrunedAt.get(dir);
    // Görsel içeren büyük taslakları her yeni dosyada tekrar okumayız.
    if (last != null && at.getTime() >= last && at.getTime() - last < 24 * 60 * 60 * 1000) return;
    let names = [];
    try { names = fs.readdirSync(dir).filter(name => /^[a-f0-9]{24}\.json$/.test(name)); } catch (_) { return; }
    lastPrunedAt.set(dir, at.getTime());
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        const draft = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (draft && draft.owner === String(ownerId || 'default') && isExpired(draft, at)) fs.unlinkSync(file);
      } catch (_) { /* Okunamayan taslağı silme. */ }
    }
  }

  function create(ownerId, draft) {
    const id = crypto.randomBytes(12).toString('hex');
    const at = now().toISOString();
    write(fileOf(ownerId, id), { ...draft, id, owner: String(ownerId || 'default'), revision: 1, createdAt: at, updatedAt: at });
    prune(ownerId);
    return id;
  }

  function get(ownerId, id) {
    const key = String(id || '');
    if (!ID_RE.test(key)) return null;
    let draft = null;
    try { draft = JSON.parse(fs.readFileSync(fileOf(ownerId, key), 'utf8')); } catch (_) { return null; }
    return draft && draft.owner === String(ownerId || 'default') && !isExpired(draft, now()) ? draft : null;
  }

  function update(ownerId, id, patch) {
    const current = get(ownerId, id);
    if (!current) return null;
    const next = { ...current, ...patch, id: current.id, owner: current.owner, revision: (Number(current.revision) || 1) + 1, updatedAt: now().toISOString() };
    write(fileOf(ownerId, current.id), next);
    return next;
  }

  return { create, get, update, root };
}

module.exports = { createDraftStore };
