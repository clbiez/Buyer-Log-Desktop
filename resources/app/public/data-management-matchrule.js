/* ===================================================================
   VERİ EŞLEŞTİRME KURALLARI (v7.82, §7 — v7.81 ASAS↔IAS ekranının genellemesi)

   Bir antrepo satırının HANGİ sipariş satırına ait olduğu bu kuralla
   belirlenir. Yanlış kurulmuş bir kural sessiz ve pahalıdır: eşleşme
   çöker, Backlog boşalır, kimse nedenini bilmez.

   NEDEN "ASAS TARAFI / IAS TARAFI" DEĞİL

   Ekran v7.81'de iki sabit sütundu: solda ASAS, sağda IAS. Üçüncü bir
   veritabanı bağlandığında bu düzen yeni bir kutu ve yeni bir kod dalı
   istiyordu. Artık bir koşul, her biri BİR KAYNAĞA bağlı 2+ OPERANDDAN
   oluşur. Kaynak listesi sunucudan gelir (kayıtlı bağlantılar + kaynak
   profilleri); burada hiçbir veritabanı adı gömülü değildir.

   NEDEN AYRI BİR BÖLÜM, KAYNAK KARTININ İÇİNDE DEĞİL

   Bu kural TEK BİR kaynağın özelliği değil, kaynaklar ARASINDAKİ
   ilişkidir. Bir kartın altına koymak "o kaynağın ayarı" izlenimi verir
   ve kullanıcı diğer tarafı değiştirmek istediğinde yanlış kartta arar.

   SUNUCU TARAFI YENİDEN YAZILMADI. /api/match-rule zaten çalışıyor ve
   doğrulaması (validateMatchConfig) orada; burada yalnız ekran var.
   İkinci bir yazma yolu açmak, iki ayrı doğrulama demek olurdu (§9).

   TAM ŞEMA LAZY YÜKLENİR. Varsayılan açılış hızlı kalır; bir veritabanı
   sütun seçicisi ilk kez açıldığında yalnız O KAYNAĞIN gerçek model şeması
   okunur. Böylece kullanıcı Buyer Log Field Mapping alanlarıyla sınırlanmaz,
   ama ekran açılırken bütün bağlantıları tarama maliyeti de ödenmez. "Tüm
   sütunları getir" düğmesi hâlâ bütün kaynakları tek seferde taramak içindir.

   ÇÖZÜLEMEYEN ALAN GİZLENMEZ. Yapılandırılmış sütun kaynakta yoksa
   sunucu onu `unresolved` işaretler; ekran kırmızı gösterir ve kayıt
   kullanıcı düzeltene kadar reddedilir. Benzer bir alana sessizce kaymak
   yanlış bir Backlog üretmenin en kısa yoludur.
   =================================================================== */
(() => {
  'use strict';

  const en = () => typeof appLang !== 'undefined' && appLang === 'en';
  const T = (tr, enText) => (en() ? enText : tr);
  const esc = value => (typeof escapeHtml === 'function'
    ? escapeHtml(String(value == null ? '' : value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])));

  let host = null;
  let state = null;          // sunucudan gelen {config, revision, suggested, sources, sourceMode}
  let conditions = [];       // düzenlenen kopya
  let fullSchema = false;
  let busy = false;
  let loading = false;
  let message = '';
  let messageTone = 'info';
  let canManage = false;
  let onClosed = null;
  /* DENETİM SONUCU. Kural doğru yazılmış görünüp pratikte çökebilir; denetim
     iki tarafı gerçek veriyle karşılaştırıp kaç satırın eşleştiğini söyler.
     Eski eşleştirme modalında vardı ve taşınmadan silinmedi. */
  let audit = '';
  let auditBusy = false;

  const SOURCE_MODE = {
    excel: { tr: 'Antrepo Excel', en: 'Bonded warehouse Excel' },
    database: { tr: 'IAS Database', en: 'IAS database' },
    dashboard: { tr: 'Power BI Dashboard', en: 'Power BI dashboard' },
  };

  /* ---------------------------------------------------------------- */

  const sources = () => (state && Array.isArray(state.sources) ? state.sources : []);

  function sourceById(id) {
    return sources().find(source => source.id === id) || null;
  }
  /* Operandın kaynağı: kimlik, yoksa AYNI ROLDEKİ ilk kaynak. Rol düşüşü eski
     kayıtları ve Excel↔Veritabanı geçişini ayakta tutar; sunucudaki çözümlemenin
     aynısıdır, böylece ekran ile kaydedilen kural aynı şeyi gösterir. */
  function sourceForOperand(operand) {
    if (!operand) return null;
    return sourceById(operand.sourceId)
      || sources().find(source => source.role === operand.role)
      || null;
  }
  function sourceLabel(source) {
    if (!source) return T('kaynak yok', 'no source');
    return source.label || source.id;
  }
  function columnEntries(source) {
    return ((source && source.columns) || []).map(entry => ({
      value: `${entry.table || ''}|${entry.name}`,
      label: entry.name,
      hint: entry.table || '',
    }));
  }

  /* Veritabanı operandında yalnız Buyer Log Field Mapping başlıklarını göstermek
     yeterli değildir. Kullanıcı eşleştirme anahtarını modeldeki HERHANGİ bir
     gerçek sütundan seçebilmelidir. Tam şema ekran açılırken değil, ilk sütun
     seçimi anında yalnız seçilen kaynak için istenir; böylece diğer bağlantılar
     gereksiz yere taranmaz. */
  async function ensureDatabaseColumns(source, anchor) {
    if (!source || source.kind !== 'database' || fullSchema || source.schemaLoaded) return source;

    const oldHtml = anchor && anchor.innerHTML;
    const oldDisabled = anchor && anchor.disabled;
    if (anchor) {
      anchor.disabled = true;
      anchor.innerHTML = `<em>${esc(T('veritabanı sütunları okunuyor…', 'loading database columns…'))}</em>`;
    }

    try {
      const response = await fetch(`/api/match-rule?fullSource=${encodeURIComponent(source.id)}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || T('Veritabanı sütunları okunamadı.', 'Could not read database columns.'));

      const fresh = (Array.isArray(payload.sources) ? payload.sources : []).find(entry => entry.id === source.id);
      if (!fresh) throw new Error(T('Seçilen veri kaynağının şeması dönmedi.', 'The selected data source schema was not returned.'));

      const index = sources().findIndex(entry => entry.id === source.id);
      const merged = { ...source, ...fresh, schemaLoaded: true };
      if (index >= 0) state.sources[index] = merged;

      if (fresh.error) {
        message = fresh.error;
        messageTone = 'warn';
      }
      return merged;
    } catch (error) {
      message = String(error && error.message || error);
      messageTone = 'warn';
      if (typeof showToast === 'function') showToast(message);
      // Şema okunamazsa mevcut Field Mapping listesi + serbest giriş korunur.
      return source;
    } finally {
      if (anchor && anchor.isConnected !== false) {
        anchor.disabled = Boolean(oldDisabled);
        anchor.innerHTML = oldHtml;
      }
    }
  }
  function sourceEntries(condition, operandIndex) {
    // Aynı kaynak bir koşulda iki kez yer alamaz: kendisiyle karşılaştırma her
    // satırı eşleştirir ve kuralı sessizce etkisizleştirir.
    const taken = new Set(condition.operands
      .map((operand, index) => (index === operandIndex ? '' : operand.sourceId))
      .filter(Boolean));
    return sources()
      .filter(source => !taken.has(source.id))
      .map(source => ({ value: source.id, label: source.label || source.id, hint: source.connection && source.connection.catalog ? source.connection.catalog : source.kind }));
  }
  function operandLabel(operand) {
    if (!operand) return '';
    return operand.canonicalHeader || operand.header || operand.name || '';
  }
  function unresolvedText(operand) {
    if (!operand || !operand.unresolved) return '';
    return operand.unresolved === 'source'
      ? T('Bu alanın kaynağı bağlı değil. Kaynağı seçin.', 'This field has no connected source. Pick a source.')
      : T('Sütun kaynakta bulunamadı. Doğru sütunu seçin.', 'Column not found in the source. Pick the correct column.');
  }
  function unresolvedCount() {
    return conditions.reduce((total, condition) =>
      total + condition.operands.filter(operand => operand.unresolved).length, 0);
  }
  function defaultOperand(condition) {
    const taken = new Set(condition.operands.map(operand => operand.sourceId));
    const source = sources().find(item => !taken.has(item.id)) || sources()[0] || null;
    return source
      ? { sourceId: source.id, role: source.role, header: '', canonicalHeader: '', table: '', name: '', kind: 'column', unresolved: '' }
      : { sourceId: '', role: '', header: '', canonicalHeader: '', table: '', name: '', kind: 'column', unresolved: '' };
  }

  async function fetchState({ full = false } = {}) {
    loading = true; render();
    try {
      const response = await fetch(`/api/match-rule${full ? '?full=1' : ''}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || T('Eşleştirme kuralı okunamadı.', 'Could not read the matching rule.'));
      state = payload;
      fullSchema = Boolean(payload.fullSchema);
      conditions = JSON.parse(JSON.stringify((payload.config && payload.config.conditions) || []))
        .map(condition => ({ ...condition, operands: Array.isArray(condition.operands) ? condition.operands : [] }));
      /* Şema hataları YUTULMAZ: sütun listesi eksikse kullanıcı neden aradığını
         bulamadığını bilmeli. Kural yine de düzenlenebilir. */
      const problems = sources().map(source => source.error).filter(Boolean);
      if (problems.length) { message = problems.join(' · '); messageTone = 'warn'; }
      if (unresolvedCount()) {
        message = T(
          `${unresolvedCount()} alan çözülemedi; kaydetmeden önce düzeltin.`,
          `${unresolvedCount()} field could not be resolved; fix it before saving.`);
        messageTone = 'bad';
      }
    } catch (error) {
      state = null;
      message = String(error && error.message || error);
      messageTone = 'bad';
    } finally {
      loading = false;
      render();
    }
  }

  /* ---------------------------------------------------------------- */

  function operandCell(condition, operand, conditionIndex, operandIndex) {
    const source = sourceForOperand(operand);
    const label = operandLabel(operand);
    const problem = unresolvedText(operand);
    return `<div class="dmrOperand${operand.unresolved ? ' isUnresolved' : ''}">
      <button type="button" class="dmrSource" data-source="${conditionIndex}:${operandIndex}" ${busy ? 'disabled' : ''}
        title="${esc(T('Veri kaynağını değiştir', 'Change data source'))}">${esc(sourceLabel(source))}</button>
      <button type="button" class="dmmColumn" data-pick="${conditionIndex}:${operandIndex}" ${busy ? 'disabled' : ''}
        ${problem ? `title="${esc(problem)}"` : ''}>
        ${label ? esc(label) : `<em>${esc(T('sütun seç', 'pick a column'))}</em>`}
      </button>
      <button type="button" class="dmfDrop" data-drop-operand="${conditionIndex}:${operandIndex}"
        ${busy || condition.operands.length <= 2 ? 'disabled' : ''}
        title="${esc(condition.operands.length <= 2
          ? T('Bir koşul en az iki kaynağı karşılaştırır', 'A condition compares at least two sources')
          : T('Alanı sil', 'Delete field'))}">🗑</button>
    </div>`;
  }

  function conditionRow(condition, index) {
    const cells = condition.operands
      .map((operand, operandIndex) => operandCell(condition, operand, index, operandIndex))
      .join(`<span class="dmrEq" aria-hidden="true">=</span>`);
    return `<li class="dmrRow">
      <div class="dmrOperands">${cells}</div>
      <div class="dmrRowActions">
        <button type="button" class="dmfAddValue" data-add-operand="${index}" ${busy || sources().length <= condition.operands.length ? 'disabled' : ''}
          title="${esc(T('Bu koşula başka bir kaynaktan alan ekle', 'Add a field from another source to this condition'))}">+ ${esc(T('alan', 'field'))}</button>
        <button type="button" class="dmfDrop" data-drop="${index}" ${busy || conditions.length <= 1 ? 'disabled' : ''}
          title="${esc(conditions.length <= 1
            ? T('Son koşul silinemez: eşleştirme tamamen çökerdi', 'The last condition cannot be deleted: matching would collapse entirely')
            : T('Koşulu sil', 'Delete condition'))}">🗑</button>
      </div>
    </li>`;
  }

  function render() {
    if (!host) return;

    if (loading && !state) {
      host.innerHTML = `<p class="dmsHint">${esc(T('Eşleştirme kuralları okunuyor…', 'Reading the matching rules…'))}</p>`;
      return;
    }

    const mode = SOURCE_MODE[state && state.sourceMode] || SOURCE_MODE.excel;
    const unresolved = unresolvedCount();
    host.innerHTML = `<div class="dmMatchRule" role="region" aria-label="${esc(T('Veri eşleştirme kuralları', 'Data matching rules'))}">
      <div class="dmfHead">
        <span class="dmfTitle">${esc(T('Veri eşleştirme kuralları', 'Data matching rules'))}</span>
        <span class="dmsHint">${esc(T(
          `Bir antrepo satırının hangi sipariş satırına ait olduğunu belirler. Antrepo kaynağı: ${mode[en() ? 'en' : 'tr']}.`,
          `Decides which order line a bonded warehouse row belongs to. Warehouse source: ${mode[en() ? 'en' : 'tr']}.`))}</span>
      </div>

      ${state ? `
        <p class="dmrNote">${esc(T(
          'Bütün koşullar birlikte sağlanmalıdır (VE). Karşılaştırma birebirdir; kısmi benzerlik kullanılmaz. Bir koşul en az iki kaynağın alanını karşılaştırır.',
          'All conditions must hold together (AND). Comparison is exact; partial similarity is not used. A condition compares fields from at least two sources.'))}</p>

        ${unresolved ? `<p class="dmrNote dmrNote--bad">${esc(T(
          `${unresolved} alan kaynağında bulunamadı. Bu alanlar hiçbir satırı eşleştirmez; doğru sütunu seçmeden kural kaydedilemez.`,
          `${unresolved} field(s) could not be found in their source. They match no rows; the rule cannot be saved until you pick the correct column.`))}</p>` : ''}

        <ul class="dmrList">${conditions.map(conditionRow).join('')}</ul>

        ${auditBusy ? `<p class="dmsHint">${esc(T('İki taraf karşılaştırılıyor…', 'Comparing both sides…'))}</p>` : ''}
        ${audit ? `<div class="dmrAudit">${audit}</div>` : ''}

        <div class="dmfFoot">
          <button type="button" class="dmfAdd" data-add ${busy || sources().length < 2 ? 'disabled' : ''}>+ ${esc(T('Koşul ekle', 'Add condition'))}</button>
          <button type="button" class="tbtn" data-audit ${busy || auditBusy ? 'disabled' : ''}
            title="${esc(T('Kayıtlı kuralı gerçek veriyle sınar: kaç sipariş eşleşiyor, hangileri belirsiz.', 'Tests the saved rule against real data: how many orders match, and which are ambiguous.'))}">
            ${esc(T('Denetle', 'Audit'))}</button>
          ${!fullSchema ? `<button type="button" class="tbtn" data-full ${busy ? 'disabled' : ''}
            title="${esc(T('Bütün modeli tarar; büyük modellerde dakikalar sürebilir.', 'Scans the whole model; can take minutes on large models.'))}">
            ${esc(T('Tüm sütunları getir', 'Load all columns'))}</button>` : ''}
          ${state.suggested ? `<button type="button" class="tbtn" data-suggest ${busy ? 'disabled' : ''}
            title="${esc(T('Alan eşlemesinden türetilen öneriyi uygular; kaydetmeden önce gözden geçirin.', 'Applies the suggestion derived from field mapping; review before saving.'))}">
            ${esc(T('Öneriyi uygula', 'Apply suggestion'))}</button>` : ''}
          <span class="dmfSpacer"></span>
          ${message ? `<span class="dmfMessage is-${esc(messageTone)}">${esc(message)}</span>` : ''}
          <button type="button" class="tbtn" data-close ${busy ? 'disabled' : ''}>${esc(T('Kapat', 'Close'))}</button>
          ${canManage ? `<button type="button" class="navActionBtn" data-save ${busy ? 'disabled' : ''}>${esc(T('Kaydet', 'Save'))}</button>` : ''}
        </div>`
      : `<div class="dmfFoot">
          ${message ? `<span class="dmfMessage is-${esc(messageTone)}">${esc(message)}</span>` : ''}
          <span class="dmfSpacer"></span>
          <button type="button" class="tbtn" data-retry>${esc(T('Yeniden dene', 'Retry'))}</button>
          <button type="button" class="tbtn" data-close>${esc(T('Kapat', 'Close'))}</button>
        </div>`}
    </div>`;
  }

  /* ---------------------------------------------------------------- */

  async function save() {
    busy = true; message = ''; render();
    try {
      const response = await fetch('/api/match-rule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'If-Match': `"${state.revision}"` },
        /* Kaynak listesi KİMLİĞİYLE gönderilir, şemasıyla değil: tam şema
           yüklendiğinde sütun listesi megabaytlara çıkabiliyor ve sunucu zaten
           kendi kataloğundan yeniden çözüyor. */
        body: JSON.stringify({
          config: {
            version: 2,
            sources: sources().map(source => ({
              id: source.id, role: source.role, profileId: source.profileId, label: source.label, kind: source.kind,
            })),
            conditions,
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || T('Eşleştirme kuralı kaydedilemedi.', 'Could not save the matching rule.'));
      message = T('Kural kaydedildi. Yeni eşleşme bir sonraki yenilemede geçerli olur.',
        'Rule saved. The new matching takes effect at the next refresh.');
      messageTone = 'info';
      /* Sürüm yanıttan TAZELENİR: aynı oturumda ikinci bir kayıt "başkası
         değiştirdi" diye reddedilmemeli. */
      if (payload.revision != null) state.revision = payload.revision;
      if (payload.config && Array.isArray(payload.config.conditions)) {
        conditions = JSON.parse(JSON.stringify(payload.config.conditions));
      }
    } catch (error) {
      message = String(error && error.message || error);
      messageTone = 'bad';
    } finally {
      busy = false;
      render();
    }
  }

  /* DENETİM.

     Sonucu çizen renderMatchAudit app-main.js'te tanımlı ve eski eşleştirme
     ekranından beri çalışıyor; burada İKİNCİ bir kopyası yazılmadı (§9).
     Denetim KAYITLI kuralı sınar, formdaki taslağı değil — bu yüzden düğme
     "kaydet"in yerine geçmez ve sonucu yanlış bir kurala bağlamaz. */
  async function runAudit() {
    auditBusy = true; audit = ''; message = ''; render();
    try {
      const response = await fetch('/api/match-audit?target=backlog', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || T('Denetim çalıştırılamadı.', 'The audit could not run.'));
      audit = typeof renderMatchAudit === 'function'
        ? renderMatchAudit(payload, en())
        : `<p class="dmsHint">${esc(T('Denetim sonucu çizilemedi.', 'The audit result could not be rendered.'))}</p>`;
    } catch (error) {
      message = String(error && error.message || error);
      messageTone = 'bad';
    } finally {
      auditBusy = false;
      render();
    }
  }

  function onClick(event) {
    if (event.target.closest('[data-close]')) { close(); return; }
    if (event.target.closest('[data-audit]')) { void runAudit(); return; }
    if (event.target.closest('[data-retry]')) { void fetchState(); return; }
    if (event.target.closest('[data-full]')) { void fetchState({ full: true }); return; }
    if (event.target.closest('[data-save]')) { void save(); return; }

    const addOperand = event.target.closest('[data-add-operand]');
    if (addOperand) {
      const condition = conditions[Number(addOperand.dataset.addOperand)];
      if (!condition) return;
      condition.operands.push(defaultOperand(condition));
      render();
      return;
    }

    if (event.target.closest('[data-add]')) {
      /* Yeni koşul, kullanılabilir ilk İKİ kaynakla açılır. Tek operandlı bir
         koşul hiçbir şeyi kısıtlamaz; boş bir kutu göstermek yerine ikinci
         kaynağı baştan bağlarız. */
      const seed = { id: `condition-${conditions.length + 1}`, normalization: '', operands: [] };
      seed.operands.push(defaultOperand(seed));
      seed.operands.push(defaultOperand(seed));
      conditions.push(seed);
      render();
      return;
    }

    if (event.target.closest('[data-suggest]')) {
      /* Öneri DOĞRUDAN KAYDEDİLMEZ, forma yazılır. Eşleştirme kuralını sessizce
         değiştirmek, kullanıcının görmediği bir Backlog değişimi demektir. */
      conditions = JSON.parse(JSON.stringify((state.suggested && state.suggested.conditions) || conditions));
      message = T('Öneri forma yazıldı. Gözden geçirip kaydedin.', 'Suggestion filled in. Review it and save.');
      messageTone = 'warn';
      render();
      return;
    }

    const dropOperand = event.target.closest('[data-drop-operand]');
    if (dropOperand) {
      const [conditionIndex, operandIndex] = String(dropOperand.dataset.dropOperand).split(':').map(Number);
      const condition = conditions[conditionIndex];
      // Bir koşul en az İKİ kaynağı karşılaştırır; tek operand kısıt üretmez.
      if (!condition || condition.operands.length <= 2) return;
      condition.operands.splice(operandIndex, 1);
      render();
      return;
    }

    const drop = event.target.closest('[data-drop]');
    if (drop) {
      /* SON KOŞUL SİLİNEMEZ. Koşulsuz bir kural her antrepo satırını her siparişe
         eşleştirirdi; sessizce yanlış Backlog üretmenin en kısa yolu. */
      if (conditions.length <= 1) return;
      conditions.splice(Number(drop.dataset.drop), 1);
      render();
      return;
    }

    const sourcePick = event.target.closest('[data-source]');
    if (sourcePick) {
      const [conditionIndex, operandIndex] = String(sourcePick.dataset.source).split(':').map(Number);
      const condition = conditions[conditionIndex];
      const operand = condition && condition.operands[operandIndex];
      if (!operand) return;
      window.BLDataPicker?.open?.(sourcePick, sourceEntries(condition, operandIndex), value => {
        const picked = sourceById(String(value));
        if (!picked) return;
        /* Kaynak değişince sütun TAŞINMAZ: aynı adlı sütunun başka bir
           veritabanında aynı anlama geldiğini varsaymak sessiz bir hatadır. */
        condition.operands[operandIndex] = {
          sourceId: picked.id, role: picked.role,
          header: '', canonicalHeader: '', table: '', name: '', kind: 'column', unresolved: '',
        };
        render();
      }, { placeholder: T('Kaynak ara…', 'Search sources…') });
      return;
    }

    const pick = event.target.closest('[data-pick]');
    if (pick) {
      const [conditionIndex, operandIndex] = String(pick.dataset.pick).split(':').map(Number);
      const condition = conditions[conditionIndex];
      const operand = condition && condition.operands[operandIndex];
      if (!operand) return;
      const source = sourceForOperand(operand);

      void (async () => {
        const resolvedSource = await ensureDatabaseColumns(source, pick);
        window.BLDataPicker?.open?.(pick, columnEntries(resolvedSource), value => {
          const parts = String(value).split('|');
          const table = parts.length >= 2 ? parts[0] : '';
          const name = parts.length >= 2 ? parts.slice(1).join('|') : String(value);
          condition.operands[operandIndex] = {
            ...operand,
            sourceId: resolvedSource ? resolvedSource.id : operand.sourceId,
            role: resolvedSource ? resolvedSource.role : operand.role,
            header: name, canonicalHeader: name, table, name, kind: 'column',
            // Kullanıcı sütunu yeniden seçti; çözülememe işareti kalkar. Kaynak
            // gerçekten tanımıyorsa sunucu kaydederken yine reddeder.
            unresolved: '',
          };
          render();
        }, {
          placeholder: T('Sütun ara…', 'Search columns…'),
          // Şema okunamadıysa kullanıcı kilitlenmemeli; sütun adını elle yazabilir.
          allowFree: true,
        });
      })();
      return;
    }
  }

  /* ---------------------------------------------------------------- */

  function close() {
    window.BLDataPicker?.close?.();
    if (!host) return;
    const notifier = onClosed;
    host.innerHTML = '';
    host.classList.remove('isOpen');
    host.removeEventListener('click', onClick);
    host = null;
    state = null;
    conditions = [];
    audit = ''; auditBusy = false;
    busy = false;
    if (typeof notifier === 'function') notifier();
  }

  async function open(container, options = {}) {
    close();
    host = container;
    canManage = Boolean(options.canManage);
    onClosed = options.onClosed || null;
    message = ''; messageTone = 'info'; busy = false; fullSchema = false;
    host.classList.add('isOpen');
    host.addEventListener('click', onClick);
    await fetchState();
  }

  window.BLDataMatchRule = { open, close };
})();
