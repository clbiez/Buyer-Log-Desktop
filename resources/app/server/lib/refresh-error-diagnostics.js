'use strict';

function clean(value, max = 1800) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function lang(tr, en) {
  return { tr, en };
}

function failedConnectionFromContext(context = {}) {
  const operations = Array.isArray(context.operations) ? context.operations : [];
  for (let i = operations.length - 1; i >= 0; i--) {
    const item = operations[i];
    if (!item || !item.error) continue;
    const connection = clean(item.connection, 220);
    if (connection) return connection;
  }
  return '';
}

function sourceLabel(raw, context = {}) {
  const text = `${clean(raw)} ${failedConnectionFromContext(context)}`;
  if (/\bIAS\b|ANTREPO|BONDED WAREHOUSE|ITHALAT/i.test(text)) return 'IAS Database';
  if (/\bASAS\b/i.test(text)) return 'ASAS Database';
  if (/POWER\s*BI|DASHBOARD/i.test(text)) return 'Power BI Dashboard';
  if (/EXCEL|PIVOT/i.test(text)) return 'Excel';
  return lang('Veri modeli / kaynak bağlantısı', 'Data model / source connection');
}

function staleCalculatedColumn(raw) {
  const text = clean(raw, 4000);
  const direct = text.match(/column\s+['"]([^'"]+)['"]\s*\[([^\]]+)\][\s\S]{0,320}?does not hold any data[\s\S]{0,320}?needs to be recalculated or refreshed/i);
  if (direct) return { table: clean(direct[1], 180), column: clean(direct[2], 220) };
  if (/does not hold any data[\s\S]{0,320}?needs to be recalculated or refreshed/i.test(text)) {
    return { table: '', column: '' };
  }
  return null;
}

function missingModelField(raw) {
  const text = clean(raw, 4000);
  const a = text.match(/Column\s+['"]([^'"]+)['"]\s+in\s+table\s+['"]([^'"]+)['"][\s\S]{0,180}?(?:cannot be found|does not exist|not found)/i);
  if (a) return { table: clean(a[2], 180), column: clean(a[1], 220) };
  const b = text.match(/['"]([^'"]+)['"]\s*\[([^\]]+)\][\s\S]{0,180}?(?:cannot be found|does not exist|not found)/i);
  if (b) return { table: clean(b[1], 180), column: clean(b[2], 220) };
  return null;
}

function result(category, source, title, summary, action, owner, raw, code, extra = {}) {
  return {
    category,
    source,
    title,
    summary,
    action,
    owner,
    code: clean(code, 120),
    technical: clean(raw, 2400),
    ...extra,
  };
}

function diagnoseRefreshError(error, context = {}) {
  const raw = clean(error && (error.publicMessage || error.message) || error || 'Yenileme başarısız oldu.', 4000);
  const code = clean(error && error.code || '', 120);
  const source = sourceLabel(raw, context);
  const repair = error && error.repairAction && error.repairAction.kind === 'field-mapping'
    ? error.repairAction : null;

  if (repair || /MODEL_REFRESH_(?:FIELD_MAPPING_REQUIRED|MAPPING_|HORIZON_MAPPING|HORIZON_MEASURE)/.test(code)) {
    const field = clean(repair && repair.header || error && error.header || '', 220);
    return result(
      'field-mapping', source,
      lang('Alan eşlemesi güncellenmeli', 'Field mapping needs attention'),
      lang(
        field ? `Buyer Log, “${field}” alanının bağlı olduğu güncel database sütununu kullanamıyor. Bu bir VPN hatası değil; kaynak şema/eşleme uyuşmazlığı.`
          : 'Buyer Log alan eşlemesi ile canlı model şeması birbiriyle uyuşmuyor.',
        field ? `Buyer Log cannot use the current database column mapped to “${field}”. This is not a VPN issue; the source schema and mapping no longer match.`
          : 'Buyer Log field mapping no longer matches the live model schema.'
      ),
      lang('Data Management → Field Mapping içinde işaretlenen alanı güncel sütuna bağlayın ve kaydedin; ardından yenilemeyi tekrar çalıştırın.',
        'Open Data Management → Field Mapping, map the flagged field to the current column, save it, then retry the refresh.'),
      lang('Buyer Log yapılandırması / kaynak şema değişikliği', 'Buyer Log configuration / source schema change'),
      raw, code, { confidence: 'high', repairable: true, repairAction: repair || null }
    );
  }

  const stale = staleCalculatedColumn(raw);
  if (stale) {
    const ref = stale.table && stale.column ? `'${stale.table}'[${stale.column}]` : '';
    return result(
      'source-model-processing', source,
      lang('Kaynak veri modeli yeniden işlenmeli', 'Source data model needs processing'),
      lang(
        `Buyer Log kaynağa ulaşabiliyor; ancak ${ref || 'hesaplanmış bir model sütunu'} veri taşımıyor çünkü kaynak model yeniden hesaplanmamış/işlenmemiş. Bu ağ veya VPN hatası değil.`,
        `Buyer Log can reach the source, but ${ref || 'a calculated model column'} has no data because the source model has not been recalculated/processed. This is not a network or VPN problem.`
      ),
      lang(
        `${ref || 'İlgili calculated column'} kaynağın BI/model sahibi tarafından Process/Recalculate edilmelidir. Buyer Log bağlantı veya Field Mapping ayarlarını değiştirmeyin; model düzeldikten sonra Yenile'yi tekrar çalıştırın.`,
        `${ref || 'The affected calculated column'} must be processed/recalculated by the BI/model owner. Do not change Buyer Log connection or Field Mapping settings; retry Refresh after the source model is processed.`
      ),
      lang('Kaynak BI / veri modeli', 'Source BI / data model'),
      raw, code, { confidence: 'high', repairable: false, table: stale.table, column: stale.column, vpnRelated: false }
    );
  }

  // Tabular sunucu sorgu sırasında belleği tükettiğinde (MODEL_QUERY_OUT_OF_MEMORY)
  // bağlantı ve yetki sağlamdır; sorunu ağda veya eşlemede aramak yanlış yönlendirir.
  if (/MODEL_QUERY_OUT_OF_MEMORY/.test(code) || /not enough memory|yeterli bellek/i.test(raw)) {
    return result(
      'source-memory', source,
      lang('Veri kaynağı sunucusunun belleği yetmedi', 'The data source server ran out of memory'),
      lang('Buyer Log kaynağa bağlandı ve sorguyu gönderdi; ancak kaynak sunucu sorguyu tamamlayacak belleği ayıramadı. Bu ağ/VPN veya yetki hatası değil. Sunucu o an başka işlerle yoğunsa geçici olabilir; tekrarlıyorsa sorgunun ara sonucu sunucu için fazla büyüktür.',
        'Buyer Log reached the source and sent the query, but the source server could not allocate enough memory to finish it. This is not a network/VPN or permission problem. It can be temporary when the server is busy; if it repeats, the query\'s intermediate result is too large for the server.'),
      lang('Birkaç dakika sonra Yenile’yi tekrar deneyin. Tekrarlarsa Data Management → Horizon kapsamını (sezon, tarih) daraltın ve kullanılmayan eşlenmiş alanları (özellikle farklı tablolardan gelen sütunları) kaldırın; sürerse sunucu belleğini BI ekibiyle kontrol edin.',
        'Retry Refresh in a few minutes. If it repeats, narrow the Data Management → Horizon scope (season, dates) and remove unused mapped fields (especially columns from other tables); if it persists, ask the BI team to check server memory.'),
      lang('Kaynak sunucu kapasitesi / sorgu kapsamı', 'Source server capacity / query scope'),
      raw, code, { confidence: 'high', repairable: false, vpnRelated: false }
    );
  }

  if (/permission|access denied|forbidden|unauthori[sz]ed|yetki|read access/i.test(raw)) {
    return result(
      'permission', source,
      lang('Veri modeli okuma yetkisi yok', 'Data-model read permission is missing'),
      lang('Bağlantı adresine ulaşılmış görünüyor ancak Windows hesabınızın kaynak model için gerekli okuma yetkisi yok veya oturum yetkisi reddediliyor.',
        'The source appears reachable, but your Windows account does not have the required read access to the model, or the session permission is being rejected.'),
      lang('Kurumsal hesabınızın ilgili model/catalog için okuma yetkisini doğrulayın. Buyer Log tarafında parola tanımlamak bu sorunu çözmez.',
        'Verify that your corporate account has read access to the relevant model/catalog. Adding a password in Buyer Log will not solve this.'),
      lang('Kurumsal yetkilendirme / model sahibi', 'Corporate access / model owner'),
      raw, code, { confidence: 'high', repairable: false }
    );
  }

  if (/Cannot connect|connection (?:either )?timed out|ECONN|ENOTFOUND|network|VPN|unreachable|bağlan/i.test(raw)) {
    return result(
      'network', source,
      lang('Kurumsal veri kaynağına ulaşılamıyor', 'Corporate data source cannot be reached'),
      lang('Buyer Log veri modeline bağlantı kuramadı. Bu sınıf hata gerçekten ağ, şirket interneti/VPN, sunucu adresi veya kurumsal erişimle ilgilidir.',
        'Buyer Log could not open a connection to the data model. This class of error is genuinely related to the network, company internet/VPN, server address, or corporate access.'),
      lang('Şirket ağı/VPN bağlantısını ve aynı kaynağın Excel/Power BI üzerinden açılıp açılmadığını kontrol edin; sonra Yenile’yi tekrar deneyin.',
        'Check the company network/VPN and whether the same source opens from Excel/Power BI, then retry Refresh.'),
      lang('Ağ / kurumsal erişim', 'Network / corporate access'),
      raw, code, { confidence: 'high', repairable: false, vpnRelated: true }
    );
  }

  if (/MODEL_QUERY_TIMEOUT|QUERY_TIMEOUT|COMMAND_TIMEOUT|query[^.]{0,80}timed out|command[^.]{0,80}timed out|sorgu[^.]{0,80}zaman aş/i.test(`${code} ${raw}`)) {
    return result(
      'timeout', source,
      lang('Veri kaynağı zaman aşımına uğradı', 'Data source timed out'),
      lang('Buyer Log kaynağa sorgu gönderdi ancak yanıt güvenli süre içinde tamamlanmadı. Bu durum yoğun model, çok geniş filtre veya geçici sunucu yavaşlığından kaynaklanabilir.',
        'Buyer Log sent the query, but the source did not finish within the safe time window. This can be caused by a busy model, a very broad filter, or temporary server slowness.'),
      lang('Önce aynı yenilemeyi bir kez daha deneyin. Tekrarlarsa Horizon/filtre kapsamını daraltın; bağlantı açılıyor fakat sorgu bekliyorsa kaynak model performansını BI ekibiyle kontrol edin.',
        'Retry once. If it repeats, narrow the Horizon/filter scope; if the connection opens but the query stalls, ask the BI team to check source-model performance.'),
      lang('Kaynak performansı / sorgu kapsamı', 'Source performance / query scope'),
      raw, code, { confidence: 'medium', repairable: false }
    );
  }

  const missing = missingModelField(raw);
  if (missing) {
    const ref = `'${missing.table}'[${missing.column}]`;
    return result(
      'schema-change', source,
      lang('Kaynak model şeması değişmiş', 'Source model schema changed'),
      lang(`Sorgu ${ref} alanını bekliyor ancak canlı modelde bu alan bulunamıyor veya artık bu ifadede kullanılamıyor.`,
        `The query expects ${ref}, but that field is missing from the live model or can no longer be used in this expression.`),
      lang('Önce Data Management → Field Mapping ve Horizon ayarını kontrol edin. Alan kaynak modelden kaldırıldıysa güncel karşılığını model sahibiyle teyit edin.',
        'Check Data Management → Field Mapping and Horizon first. If the field was removed from the source model, confirm its replacement with the model owner.'),
      lang('Kaynak şema / Buyer Log eşlemesi', 'Source schema / Buyer Log mapping'),
      raw, code, { confidence: 'high', repairable: true, table: missing.table, column: missing.column }
    );
  }

  if (/MODEL_REFRESH_ANTREPO_|MODEL_REFRESH_ASAS_PARSE_FAILED|data integrity|veri bütünlüğü|zorunlu .* sütun|loaded qty|Yükleme Toplam Adet/i.test(`${code} ${raw}`)) {
    return result(
      'data-integrity', source,
      lang('Kaynak veri bütünlüğü kontrolünden geçmedi', 'Source data failed integrity checks'),
      lang('Kaynak bağlantısı çalıştı ancak dönen veri Buyer Log’un güvenli yayın kurallarını karşılamadı. Eksik/yanlış veriyle yeni snapshot yazılmadı.',
        'The source connection worked, but the returned data did not pass Buyer Log safety checks. A new snapshot was not published with incomplete or inconsistent data.'),
      lang('Teknik ayrıntıda belirtilen zorunlu sütun/miktar/eşleşme alanını kaynakta veya Field Mapping’de düzeltin; ardından yeniden deneyin.',
        'Fix the required column, quantity, or matching field named in the technical detail—at the source or in Field Mapping—then retry.'),
      lang('Kaynak veri kalitesi / eşleme', 'Source data quality / mapping'),
      raw, code, { confidence: 'high', repairable: true }
    );
  }

  if (/MODEL_REFRESH_(?:ASAS_CONNECTION_MISSING|NO_SCOPE|TABLE_MISSING|QUERY_MISSING|MAPPING_MISSING|MAPPING_INCOMPLETE|HORIZON_)/.test(code)) {
    return result(
      'configuration', source,
      lang('Buyer Log kaynak yapılandırması eksik', 'Buyer Log source configuration is incomplete'),
      lang('Yenileme başlamadan önce gerekli bağlantı, rol, Horizon veya alan eşleme ayarlarından biri eksik bulundu.',
        'A required connection, role, Horizon, or field-mapping setting is missing before the refresh can run.'),
      lang('Data Management içindeki ilgili kaynağın bağlantı, bağlı modül, Horizon ve zorunlu Field Mapping alanlarını tamamlayın.',
        'Complete the connection, linked modules, Horizon, and required Field Mapping settings for the source in Data Management.'),
      lang('Buyer Log → Data Management', 'Buyer Log → Data Management'),
      raw, code, { confidence: 'high', repairable: true }
    );
  }

  return result(
    'unknown', source,
    lang('Yenileme tamamlanamadı', 'Refresh could not be completed'),
    lang('Buyer Log bu hatanın kök nedenini güvenle otomatik sınıflandıramadı. Ağ/VPN varsayımı yapılmadı; teknik hata aşağıda aynen korunuyor.',
      'Buyer Log could not safely classify the root cause of this error. It is not being assumed to be a network/VPN problem; the original technical error is preserved below.'),
    lang('Teknik ayrıntıyı ve hata kodunu kullanarak sorunu inceleyin. Aynı hata tekrarlanırsa bu bilgileri paylaşın; bağlantı veya eşleme ayarını tahmin ederek değiştirmeyin.',
      'Use the technical detail and error code to investigate. If it repeats, share this information; do not change connection or mapping settings based on a guess.'),
    lang('Henüz sınıflandırılamadı', 'Not yet classified'),
    raw, code, { confidence: 'low', repairable: false }
  );
}

module.exports = {
  diagnoseRefreshError,
  staleCalculatedColumn,
  missingModelField,
  sourceLabel,
};
