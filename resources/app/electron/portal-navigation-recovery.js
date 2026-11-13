'use strict';

/*
 * Kurumsal portal (CoreNectum/PLM, PASS/OAB, LCW AI) giriş penceresi gezinme
 * kurtarma ve teşhisi.
 *
 * Saha bulgusu: bazı bilgisayarlarda üç portalın giriş ekranı da
 * "ERR_FAILED (-2) loading …" ile açılmıyordu. 7.0.247'deki service worker /
 * önbellek temizliği yalnız CoreNectum'a uygulanıyordu ve bu makinelerde
 * yetmiyordu; OAB ve LCW AI ise ilk hatada hiç yeniden denemeden düşüyordu.
 * ERR_FAILED Chromium'un genel hata kodudur; kök neden iki sınıfa ayrılır:
 *
 *   - "partition": Buyer Log'un ayrık kalıcı bölümünün (persist:...) disk
 *     verisi bozulmuş/kilitli. Aynı adres varsayılan oturumdan açılabilir.
 *     Çözüm: o bölümün tüm verisini sıfırla (SSO yeniden ister) ve tekrar dene.
 *   - "network": Bu bilgisayardan adrese Buyer Log'un hiçbir oturumu ulaşamıyor
 *     (VPN/ağ, proxy, güvenlik yazılımı). Kod tarafında onarılamaz; kullanıcıya
 *     ve log'a kanıtla raporlanır.
 *
 * Teşhis yalnız hata yolunda çalışır (normal açılışa maliyeti yok). Token,
 * çerez veya yanıt gövdesi okunmaz/loglanmaz; yalnız durum kodu, Chromium hata
 * adı ve proxy çözümü kaydedilir.
 */

const ERR_ABORTED = -3;
const DEFAULT_PROBE_TIMEOUT_MS = 8000;
const SOFT_RESET_STORAGES = ['serviceworkers', 'cachestorage'];

function navigationErrno(error) {
  const code = Number(error && error.errno);
  if (Number.isFinite(code) && code < 0) return code;
  const match = /\((-\d+)\)/.exec(String(error && error.message || ''));
  if (match) return Number(match[1]);
  const text = String(error && (error.code || error.message) || '');
  if (/ERR_ABORTED/i.test(text)) return -3;
  if (/ERR_FAILED/i.test(text)) return -2;
  return 0;
}

function chromiumErrorName(error) {
  const match = /ERR_[A-Z0-9_]+/.exec(String(error && (error.code || error.message) || ''));
  return match ? match[0] : '';
}

function timeoutAfter(ms, value) {
  let timer = null;
  const promise = new Promise(resolve => { timer = setTimeout(() => resolve(value), ms); });
  return { promise, cancel: () => clearTimeout(timer) };
}

async function probeSession(targetSession, url, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS) {
  if (!targetSession || typeof targetSession.fetch !== 'function') return { ok: false, error: 'UNSUPPORTED' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Yönlendirme takip edilmez: SSO'ya giden 302 de "sunucuya ulaşıldı" demektir.
    const response = await targetSession.fetch(url, {
      method: 'GET', redirect: 'manual', cache: 'no-store', credentials: 'include', signal: controller.signal,
    });
    try { if (response.body && typeof response.body.cancel === 'function') await response.body.cancel(); } catch (_) {}
    return { ok: true, status: Number(response.status) || 0 };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, error: 'TIMEOUT' };
    // Electron 44 net.fetch, redirect:'manual' iken 3xx yanıtı döndürmez;
    // "Redirect was cancelled" ile reddeder (runtime'da doğrulandı). Bu,
    // sunucunun yanıt verdiği (SSO yönlendirmesi) anlamına gelir.
    if (/redirect was cancelled/i.test(String(error && error.message || ''))) return { ok: true, status: 'redirect' };
    return { ok: false, errno: navigationErrno(error), error: chromiumErrorName(error) || 'FETCH_FAILED' };
  } finally { clearTimeout(timer); }
}

async function resolveProxySafe(targetSession, url, timeoutMs = 3000) {
  if (!targetSession || typeof targetSession.resolveProxy !== 'function') return '';
  const guard = timeoutAfter(timeoutMs, 'TIMEOUT');
  try { return String(await Promise.race([targetSession.resolveProxy(url), guard.promise]) || ''); }
  catch (_) { return ''; }
  finally { guard.cancel(); }
}

function classifyDiagnosis(portal, baseline) {
  if (portal && portal.ok) return 'transient';
  if (baseline && baseline.ok) return 'partition';
  return 'network';
}

async function diagnosePortalNavigation({ portalSession, baselineSession, url, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = {}) {
  const [proxy, portal, baseline] = await Promise.all([
    resolveProxySafe(portalSession, url),
    probeSession(portalSession, url, timeoutMs),
    probeSession(baselineSession, url, timeoutMs),
  ]);
  return { proxy, portal, baseline, verdict: classifyDiagnosis(portal, baseline) };
}

function describeProbe(probe) {
  if (!probe) return '-';
  if (probe.ok) return 'HTTP ' + probe.status;
  return (probe.error || 'FAILED') + (probe.errno ? ' (' + probe.errno + ')' : '');
}

function describeDiagnosis(diagnosis) {
  if (!diagnosis) return '';
  return 'verdict=' + diagnosis.verdict
    + ' · portal=' + describeProbe(diagnosis.portal)
    + ' · default=' + describeProbe(diagnosis.baseline)
    + ' · proxy=' + (diagnosis.proxy || '?');
}

/* SSO çerezleri/localStorage korunur; yalnız gezinmeyi bozabilen SW kaydı,
 * Cache Storage, HTTP önbelleği, DNS önbelleği ve açık soketler sıfırlanır. */
async function softResetPortalSession(targetSession) {
  if (!targetSession) return;
  try { await targetSession.clearStorageData({ storages: SOFT_RESET_STORAGES }); } catch (_) {}
  try { await targetSession.clearCache(); } catch (_) {}
  try { await targetSession.clearHostResolverCache(); } catch (_) {}
  try { await targetSession.closeAllConnections(); } catch (_) {}
}

/* Bölüm verisinin tamamı (çerezler dahil) silinir: yalnız teşhis bölümün
 * kendisinin bozuk olduğunu gösterdiğinde kullanılır; kullanıcı yeniden SSO
 * girişi yapar. */
async function fullResetPortalSession(targetSession) {
  if (!targetSession) return;
  try { await targetSession.clearStorageData(); } catch (_) {}
  try { await targetSession.clearCache(); } catch (_) {}
  try { await targetSession.clearAuthCache(); } catch (_) {}
  try { await targetSession.clearHostResolverCache(); } catch (_) {}
  try { await targetSession.closeAllConnections(); } catch (_) {}
}

/*
 * Bir giriş penceresi loadURL hatası için sonraki adım:
 *   attempt 0 → hafif sıfırlama + yeniden dene
 *   attempt 1 → teşhis; bölüm bozuksa tam sıfırlama + yeniden dene
 *               (allowFullReset=false, yani sessiz denemede: dur),
 *               geçiciyse yeniden dene, ağ ise dur
 *   attempt 2+ → dur
 * ERR_ABORTED (SSO yönlendirmesi sürüyor) hata sayılmaz.
 */
async function nextPortalRecoveryStep({ error, attempt = 0, portalSession, baselineSession, url, label = 'Portal', log = () => {}, timeoutMs, allowFullReset = true } = {}) {
  const errno = navigationErrno(error);
  const name = chromiumErrorName(error) || 'ERR_UNKNOWN';
  if (errno === ERR_ABORTED) return { action: 'ignore', errno };
  if (attempt === 0) {
    log(label + ' açılamadı (' + name + ' ' + errno + '); önbellek/DNS/bağlantılar sıfırlanıp yeniden deneniyor.');
    await softResetPortalSession(portalSession);
    return { action: 'retry', errno };
  }
  if (attempt === 1) {
    const diagnosis = await diagnosePortalNavigation({ portalSession, baselineSession, url, timeoutMs });
    log(label + ' gezinme teşhisi (' + name + ' ' + errno + '): ' + describeDiagnosis(diagnosis));
    if (diagnosis.verdict === 'partition' && !allowFullReset) {
      /* Arka plan (sessiz) denemesi kullanıcının SSO oturumunu asla silmez:
         yanlış bir teşhis bile kullanıcıyı yeniden girişe zorlamamalı. Tam
         sıfırlama yalnız kullanıcının başlattığı (etkileşimli) girişte yapılır. */
      log(label + ' oturum bölümü bozuk görünüyor; sessiz denemede bölüm korunuyor.');
      return { action: 'fail', errno, diagnosis, detail: name + ' (' + errno + ') · ' + describeDiagnosis(diagnosis) };
    }
    if (diagnosis.verdict === 'partition') {
      log(label + ' oturum bölümü bozuk görünüyor; bölüm verisi tamamen sıfırlanıp yeniden deneniyor (SSO yeniden istenebilir).');
      await fullResetPortalSession(portalSession);
      return { action: 'retry', errno, diagnosis };
    }
    if (diagnosis.verdict === 'transient') return { action: 'retry', errno, diagnosis };
    return { action: 'fail', errno, diagnosis, detail: name + ' (' + errno + ') · ' + describeDiagnosis(diagnosis) };
  }
  return { action: 'fail', errno, detail: name + ' (' + errno + ')' };
}

module.exports = {
  navigationErrno,
  chromiumErrorName,
  probeSession,
  classifyDiagnosis,
  diagnosePortalNavigation,
  describeDiagnosis,
  softResetPortalSession,
  fullResetPortalSession,
  nextPortalRecoveryStep,
};
