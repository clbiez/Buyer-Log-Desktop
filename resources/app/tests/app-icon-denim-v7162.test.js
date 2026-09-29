'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { syncShortcutIcons } = require('../electron/shortcut-icon');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel));

function pngSize(buffer) {
  assert.equal(buffer.subarray(1, 4).toString('latin1'), 'PNG');
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

function icoSizes(buffer) {
  assert.equal(buffer.readUInt16LE(0), 0);
  assert.equal(buffer.readUInt16LE(2), 1);
  const count = buffer.readUInt16LE(4);
  const sizes = [];
  for (let i = 0; i < count; i++) sizes.push(buffer[6 + i * 16] || 256);
  return sizes.sort((a, b) => a - b);
}

function icoEntries(buffer) {
  assert.equal(buffer.readUInt16LE(0), 0);
  assert.equal(buffer.readUInt16LE(2), 1);
  const entries = [];
  for (let i = 0; i < buffer.readUInt16LE(4); i++) {
    const at = 6 + i * 16;
    const offset = buffer.readUInt32LE(at + 12);
    entries.push({ size: buffer[at] || 256, png: buffer.subarray(offset + 1, offset + 4).toString('latin1') === 'PNG' });
  }
  return entries.sort((a, b) => a.size - b.size);
}

test('uygulama simgesi dosyaları doğru boyutlarda ve tek kaynaktan', () => {
  assert.deepEqual(pngSize(read('public/icons/icon-512.png')), [512, 512]);
  assert.deepEqual(pngSize(read('public/icons/icon-192.png')), [192, 192]);
  assert.deepEqual(pngSize(read('public/icons/icon-mark.png')), [128, 128]);
  assert.deepEqual(pngSize(read('public/icons/avatar-patch.png')), [96, 96]);
  const entries = icoEntries(read('buyerlog.ico'));
  const sizes = entries.map(entry => entry.size);
  for (const size of [16, 24, 32, 48, 256]) assert.ok(sizes.includes(size), 'buyerlog.ico ' + size + 'px içermeli');
  // Görev çubuğu/pencere simgesi yükleyen eski Windows API'leri küçük boyutlarda
  // PNG sıkıştırmalı girdiyi okuyamayabilir; yalnız 256px PNG olabilir.
  assert.deepEqual(entries.filter(entry => entry.png).map(entry => entry.size), [256]);
});

test('favicon, PWA manifest ve Electron pencereleri aynı simgeyi gösterir', () => {
  const index = read('public/index.html').toString('utf8');
  assert.match(index, /<link rel="icon" type="image\/png" sizes="128x128" href="icons\/icon-mark\.png/);
  const manifest = JSON.parse(read('public/manifest.webmanifest').toString('utf8'));
  assert.deepEqual(manifest.icons.map(icon => icon.src), ['icons/icon-192.png', 'icons/icon-512.png']);
  const main = read('electron/main.js').toString('utf8');
  assert.match(main, /const APP_ICON_SOURCE = path\.join\(APP_CORE_ROOT, 'buyerlog\.ico'\)/);
  assert.match(main, /iconPath: APP_ICON_SOURCE,\s*appDetails: taskbarAppDetails\(\),/);
  assert.match(main, /syncShortcutIcons\(/);
  assert.match(main, /runExeIconPatch\(/);
  const workspace = read('electron/workspace-manager.js').toString('utf8');
  assert.match(workspace, /window\.setAppDetails\(appDetails\)/);
});

test('giriş ekranı büyük simgeyi, sol menü ve sekme çubuğu küçük boyut simgesini gösterir', () => {
  const login = read('public/select-user.html').toString('utf8');
  assert.match(login, /class="logoMark logoMark--image"[^>]*><img src="\/icons\/icon-512\.png" alt="" width="112" height="112"/);
  assert.match(read('public/giris.css').toString('utf8'), /\.logoMark--image\{width:112px;height:112px/);
  const index = read('public/index.html').toString('utf8');
  assert.match(index, /<img class="brandMarkImage" src="icons\/icon-mark\.png/);
  const shell = read('electron/workspace.html').toString('utf8');
  assert.match(shell, /class="brand"[^>]*><img src="\.\.\/public\/icons\/icon-mark\.png"/);
  // Kullanıcı seçimi oturumdan önce açılır; simgeler güvenlik geçidine takılmamalı.
  const server = read('server/server.js').toString('utf8');
  const route = server.indexOf("app.get(['/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-mark.png']");
  assert.ok(route > 0 && route < server.indexOf('createStaticGzip('), 'simge rotası statik katmandan önce olmalı');
});

test('sağ üst kullanıcı avatarı uygulama simgesiyle aynı malzemede (çelik plaka), adın baş harfleriyle', () => {
  const index = read('public/index.html').toString('utf8');
  assert.match(index, /<span id="currentUserInitials" class="blSteelInitials">/);
  const ui = read('public/user-access-ui.js').toString('utf8');
  assert.match(ui, /avatar\.textContent = initials\(profile\.displayName\)/);
  assert.match(ui, /<span class="userMenuAvatar"><span class="blSteelInitials">\$\{esc\(initials\(profile\.displayName\)\)\}<\/span><\/span>/);
  const css = read('public/experience.css').toString('utf8');
  assert.match(css, /\.userAvatarBtn,\[data-theme\] \.userAvatarBtn,\.userMenuAvatar,\[data-theme\] \.userMenuAvatar\{\s*background:#c8cdd2 url\("icons\/avatar-patch\.png"\)/);
  assert.match(css, /\.blSteelInitials\{[^}]*background-clip:text;color:transparent;/);
});

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-shortcut-'));
  const desktop = path.join(base, 'Desktop');
  const appData = path.join(base, 'AppData');
  const programs = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const taskbar = path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar');
  for (const dir of [desktop, path.join(programs, 'Buyer Log'), taskbar]) fs.mkdirSync(dir, { recursive: true });
  const exePath = path.join(base, 'Portable', 'BuyerLog.exe');
  const sourceIcon = path.join(base, 'core', 'buyerlog.ico');
  fs.mkdirSync(path.dirname(sourceIcon), { recursive: true });
  fs.writeFileSync(sourceIcon, Buffer.from('ICON-V2'));
  const links = new Map();
  const addLink = (file, link) => { fs.writeFileSync(file, ''); links.set(file, { ...link }); };
  const writes = [];
  const shell = {
    readShortcutLink(file) { if (!links.has(file)) throw new Error('bozuk kısayol'); return { ...links.get(file) }; },
    writeShortcutLink(file, operation, options) {
      writes.push({ file, operation, options });
      links.set(file, { ...links.get(file), ...options });
      return true;
    },
  };
  const getPath = name => ({ desktop, appData })[name];
  return { base, desktop, programs, taskbar, exePath, sourceIcon, links, addLink, writes, shell, getPath, iconDir: path.join(base, 'Portable', 'data', 'local', 'branding') };
}

test('yalnız BuyerLog.exe kısayollarının simgesi sabit kopyaya yönlenir', () => {
  const f = fixture();
  try {
    const desktopLink = path.join(f.desktop, 'Buyer Log.lnk');
    const startLink = path.join(f.programs, 'Buyer Log', 'Buyer Log.lnk');
    const pinnedLink = path.join(f.taskbar, 'Buyer Log.lnk');
    const otherLink = path.join(f.desktop, 'Excel.lnk');
    f.addLink(desktopLink, { target: f.exePath.toUpperCase(), icon: '' });
    f.addLink(startLink, { target: f.exePath, icon: f.exePath, iconIndex: 0 });
    f.addLink(pinnedLink, { target: f.exePath, icon: '' });
    f.addLink(otherLink, { target: path.join(f.base, 'excel.exe'), icon: '' });
    fs.writeFileSync(path.join(f.desktop, 'Bozuk.lnk'), '');

    const result = syncShortcutIcons({ shell: f.shell, getPath: f.getPath, exePath: f.exePath, sourceIcon: f.sourceIcon, iconDir: f.iconDir });

    assert.ok(result.icon.startsWith(f.iconDir + path.sep));
    assert.equal(fs.readFileSync(result.icon, 'utf8'), 'ICON-V2');
    assert.deepEqual(result.updated.sort(), [desktopLink, pinnedLink, startLink].sort());
    assert.ok(f.writes.every(w => w.operation === 'update' && w.options.icon === result.icon && w.options.iconIndex === 0));
    assert.equal(f.links.get(otherLink).icon, '');

    // İkinci açılışta aynı simge için kısayollar yeniden yazılmaz.
    f.writes.length = 0;
    const again = syncShortcutIcons({ shell: f.shell, getPath: f.getPath, exePath: f.exePath, sourceIcon: f.sourceIcon, iconDir: f.iconDir });
    assert.equal(again.updated.length, 0);
    assert.equal(again.skipped, 3);
    assert.equal(f.writes.length, 0);
  } finally {
    fs.rmSync(f.base, { recursive: true, force: true });
  }
});

test('simge değişince yeni içerik yeni yol alır ve eski kopya temizlenir', () => {
  const f = fixture();
  try {
    const desktopLink = path.join(f.desktop, 'Buyer Log.lnk');
    f.addLink(desktopLink, { target: f.exePath, icon: '' });
    const first = syncShortcutIcons({ shell: f.shell, getPath: f.getPath, exePath: f.exePath, sourceIcon: f.sourceIcon, iconDir: f.iconDir });
    fs.writeFileSync(f.sourceIcon, Buffer.from('ICON-V3'));
    const second = syncShortcutIcons({ shell: f.shell, getPath: f.getPath, exePath: f.exePath, sourceIcon: f.sourceIcon, iconDir: f.iconDir });
    assert.notEqual(first.icon, second.icon);
    assert.equal(f.links.get(desktopLink).icon, second.icon);
    assert.equal(fs.existsSync(first.icon), false);
    assert.deepEqual(fs.readdirSync(f.iconDir), [path.basename(second.icon)]);
  } finally {
    fs.rmSync(f.base, { recursive: true, force: true });
  }
});

test('shell API veya kaynak simge yoksa hiçbir şey yazılmaz', () => {
  const f = fixture();
  try {
    assert.deepEqual(syncShortcutIcons({ shell: {}, getPath: f.getPath, exePath: f.exePath, sourceIcon: f.sourceIcon, iconDir: f.iconDir }).updated, []);
    assert.deepEqual(syncShortcutIcons({ shell: f.shell, getPath: f.getPath, exePath: f.exePath, sourceIcon: path.join(f.base, 'yok.ico'), iconDir: f.iconDir }).updated, []);
    assert.equal(fs.existsSync(f.iconDir), false);
  } finally {
    fs.rmSync(f.base, { recursive: true, force: true });
  }
});
