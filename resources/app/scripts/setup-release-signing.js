'use strict';
/*
 * Tek seferlik güncelleme imzası kurulumu (KİŞİSEL bilgisayarda çalıştırılır).
 *
 * Yönetici yetkisi istemez, hiçbir şey kurmaz, sistem ayarına dokunmaz.
 * Gerekenler: Node.js, git, GitHub CLI (gh) ve `gh auth login` ile giriş.
 *
 * Yaptıkları:
 *   1. Repo DIŞINDA (kullanıcı klasöründe) Ed25519 anahtar çifti üretir.
 *   2. Private key'i stdin üzerinden GitHub secret'ına yazar
 *      (BUYER_LOG_RELEASE_SIGNING_KEY); ekrana veya log'a basmaz.
 *   3. Public key'i electron/update/release-signing-keys.json'a ekler,
 *      commit eder ve mevcut dala push eder.
 *
 * Yeniden çalıştırılırsa mevcut anahtarı kullanır; yeni anahtar üretmez.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { keyIdFor } = require('../electron/update/signature');

const APP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..');
const KEYS_FILE = path.join(APP_ROOT, 'electron', 'update', 'release-signing-keys.json');
const KEY_DIR = path.join(os.homedir(), 'BuyerLogReleaseKeys');
const SECRET_NAME = 'BUYER_LOG_RELEASE_SIGNING_KEY';
const DRY_RUN = process.argv.includes('--dry-run');

function step(text) { console.log(`\n▶ ${text}`); }
function fail(text) { console.error(`\n✖ ${text}`); process.exit(1); }
function run(cmd, args, options = {}) {
  const result = cp.spawnSync(cmd, args, { cwd: REPO_ROOT, encoding: 'utf8', shell: false, ...options });
  if (result.error) fail(`${cmd} çalıştırılamadı: ${result.error.message}`);
  if (result.status !== 0) fail(`${cmd} ${args.join(' ')} başarısız:\n${(result.stderr || result.stdout || '').trim()}`);
  return String(result.stdout || '').trim();
}
function has(cmd) { return !cp.spawnSync(cmd, ['--version'], { encoding: 'utf8', shell: false }).error; }

function ensureKeyPair() {
  fs.mkdirSync(KEY_DIR, { recursive: true });
  const existing = fs.readdirSync(KEY_DIR).find(name => /^buyerlog-release-[a-f0-9]{16}\.private\.pem$/.test(name));
  if (existing) {
    const privatePem = fs.readFileSync(path.join(KEY_DIR, existing), 'utf8');
    const publicKey = crypto.createPublicKey(crypto.createPrivateKey(privatePem));
    console.log(`  Mevcut anahtar kullanılıyor: ${path.join(KEY_DIR, existing)}`);
    return { privatePem, publicPem: publicKey.export({ type: 'spki', format: 'pem' }), keyId: keyIdFor(publicKey) };
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const keyId = keyIdFor(publicKey);
  fs.writeFileSync(path.join(KEY_DIR, `buyerlog-release-${keyId}.private.pem`), privatePem, { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(path.join(KEY_DIR, `buyerlog-release-${keyId}.public.pem`), publicPem, { flag: 'wx' });
  console.log(`  Yeni anahtar üretildi: ${KEY_DIR}`);
  return { privatePem, publicPem, keyId };
}

function main() {
  console.log('Buyer Log · güncelleme imzası kurulumu' + (DRY_RUN ? ' (deneme modu: GitHub\'a hiçbir şey gönderilmez)' : ''));

  step('Ön kontroller');
  if (!fs.existsSync(path.join(REPO_ROOT, '.git'))) fail('Bu script Buyer-Log-Desktop repo klasörünün içinden çalıştırılmalı.');
  if (!has('git')) fail('git bulunamadı. https://git-scm.com adresinden kurun (yönetici yetkisi gerektirmeyen kullanıcı kurulumu seçilebilir).');
  if (!DRY_RUN) {
    if (!has('gh')) fail('GitHub CLI (gh) bulunamadı. https://cli.github.com adresinden kurun, sonra "gh auth login" çalıştırın.');
    run('gh', ['auth', 'status']);
  }
  const repo = DRY_RUN ? '(deneme)' : run('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  console.log(`  Repo: ${repo} · Dal: ${branch}`);
  if (run('git', ['status', '--porcelain'])) fail('Çalışma alanında commit edilmemiş değişiklik var. Önce bunları commit edin veya geri alın.');

  step('Anahtar çifti (repo dışında, kullanıcı klasöründe)');
  const rel = path.relative(REPO_ROOT, KEY_DIR);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) fail('Anahtar klasörü repo içinde olamaz.');
  const { privatePem, publicPem, keyId } = ensureKeyPair();
  console.log(`  keyId: ${keyId}`);

  step(`GitHub secret: ${SECRET_NAME}`);
  if (DRY_RUN) console.log('  (deneme modu: atlandı)');
  else { run('gh', ['secret', 'set', SECRET_NAME], { input: privatePem }); console.log('  Kaydedildi (private key ekrana yazılmadı).'); }

  step('Public key repoya ekleniyor');
  const data = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  data.keys = Array.isArray(data.keys) ? data.keys : [];
  if (data.keys.some(k => k && k.keyId === keyId)) console.log('  Zaten ekli.');
  else {
    data.keys.push({ keyId, publicKey: publicPem, addedAt: new Date().toISOString().slice(0, 10) });
    fs.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
    if (DRY_RUN) {
      console.log('  (deneme modu: dosya geri alınıyor)');
      run('git', ['checkout', '--', path.relative(REPO_ROOT, KEYS_FILE)]);
    } else {
      run('git', ['add', path.relative(REPO_ROOT, KEYS_FILE)]);
      run('git', ['commit', '-m', `Bundle release signing public key ${keyId}`]);
      run('git', ['push', 'origin', branch]);
      console.log(`  Commit edildi ve ${branch} dalına push edildi.`);
    }
  }

  console.log(`\n✔ Bitti.
  • Private key yedeği: ${KEY_DIR}
    Bu klasörü bir USB'ye veya şifre kasasına yedekleyin. Repoya, e-postaya,
    Teams'e ya da şirket bilgisayarına KOPYALAMAYIN.
  • Bu dal main'e birleştiğinde sonraki sürümden itibaren imzasız güncelleme kabul edilmez.`);
}

main();
