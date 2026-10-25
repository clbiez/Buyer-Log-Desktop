'use strict';
/*
 * Buyer Log — YENİ KULLANICI KURULUM PAKETİ (7.0.178)
 *
 * SORUN. Yeni kullanıcıya verilecek çalıştırılabilir bir paket yoktu. GitHub
 * kaynak ZIP'i node_modules taşımaz, release'teki BuyerLog.exe ise yalnız
 * Electron çalışma zamanıdır; ikisi elle birleştirilince sunucu açılamıyordu.
 * Çare olarak çalışan bir kurulum klasörü (data\ dâhil) kopyalandı; bu da
 * cihaz kimliğini ve eski sürüm işaretçilerini yeni kullanıcılara taşıdı.
 *
 * ÇÖZÜM. Tek ZIP, üç parçadan deterministik olarak birleştirilir:
 *   1) Uygulama çekirdeği = STABLE güncelleme artifact'inin BİREBİR aynısı
 *      (node_modules dâhil). Yeni kurulan ile güncellenen kullanıcı aynı
 *      baytları çalıştırır; ayrı bir derleme yapılmaz.
 *   2) Electron çalışma zamanı dosyaları (repo kökündeki dll/pak/locales).
 *   3) BuyerLog.exe (SHA-256 ile sabitlenmiş).
 * Pakette kullanıcı verisi, config.json, cihaz kimliği, eski sürüm klasörü
 * (.buyerlog-versions) veya geliştirici dosyası BULUNAMAZ; bulunursa derleme
 * durur.
 *
 * Kullanım (CI):
 *   node scripts/build-installer.js --app-zip BuyerLog-7.0.178.zip \
 *     --exe BuyerLog.exe --exe-sha256 <sha> --runtime-root ../.. --out dist-installer
 */
const fs=require('fs');
const path=require('path');
const childProcess=require('child_process');
const { createZipFromDirectory, extractZipSafe }=require('../electron/update/zip');
const { sha256File }=require('../electron/update/crypto');
const { parseSemver }=require('../electron/update/semver');
const { missingRuntimeDependencies }=require('../electron/backend');
const { buildManifest }=require('./portable-manifest');

const INSTALL_FOLDER='BuyerLog';
/* Kök dizinde pakete GİRMEYECEK izlenen yollar: kaynak/CI/ajan dosyaları,
   eski sürüm klasörleri ve kaynak ağacındaki app çekirdeği (çekirdek yalnız
   STABLE artifact'ten gelir). */
const RUNTIME_DENY=[/^\.git/,/^\.github\//,/^\.buyerlog-versions\//,/^resources\//,/^docs\//,/^data\//,/^CLAUDE\.md$/,/^AGENTS\.md$/,/^manifest\.json$/,/^config\.json$/,/^BuyerLog\.exe$/i,/(^|\/)node_modules\//,/\.md$/i];
const REQUIRED_RUNTIME=['version','icudtl.dat','resources.pak','v8_context_snapshot.bin','snapshot_blob.bin','ffmpeg.dll','locales/tr.pak','locales/en-US.pak'];
/* Paket içinde asla bulunmaması gereken, kullanıcıya/cihaza ait yollar. */
const FORBIDDEN=[/^data(\/|$)/,/^config\.json$/,/^\.buyerlog-versions(\/|$)/,/^resources\/app\/server\/data(\/|$)/,/^resources\/app\/(dist-updates|tests|\.desktop-dev)(\/|$)/,/^resources\/app\/\.release-pending\.json$/,/(^|\/)BuyerLogLocal\.db/i,/\.blgbackup$/i];

function fail(message,code='INSTALLER_BUILD_FAILED'){throw Object.assign(new Error(message),{code});}
function args(argv){const out={};for(let i=0;i<argv.length;i+=1){const key=argv[i];if(!key.startsWith('--'))continue;const next=argv[i+1];if(next==null||next.startsWith('--'))out[key.slice(2)]=true;else{out[key.slice(2)]=next;i+=1;}}return out;}
function rel(root,full){return path.relative(root,full).split(path.sep).join('/');}
function walk(root){const out=[];(function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())visit(full);else if(entry.isFile())out.push(rel(root,full));}})(root);return out.sort();}

function runtimeFiles(runtimeRoot){
  let tracked;
  try{tracked=childProcess.execFileSync('git',['ls-files','-z'],{cwd:runtimeRoot,encoding:'utf8',maxBuffer:64*1024*1024}).split('\0').filter(Boolean);}
  catch(_){fail('Çalışma zamanı kökü bir git çalışma ağacı değil: '+runtimeRoot,'INSTALLER_RUNTIME_ROOT');}
  const files=tracked.filter(file=>!RUNTIME_DENY.some(rule=>rule.test(file)));
  for(const required of REQUIRED_RUNTIME)if(!files.includes(required))fail('Electron çalışma zamanı dosyası eksik: '+required,'INSTALLER_RUNTIME_INCOMPLETE');
  return files;
}

function assertPackage(stage,version){
  const files=walk(stage);
  const leaked=files.filter(file=>FORBIDDEN.some(rule=>rule.test(file)));
  if(leaked.length)fail('Kurulum paketine kullanıcı/cihaz verisi sızdı: '+leaked.slice(0,10).join(', '),'INSTALLER_DATA_LEAK');
  for(const required of ['BuyerLog.exe','manifest.json','resources/app/package.json','resources/app/electron/launcher.js','resources/app/electron/launcher-core.js','resources/app/electron/update/launcher-version.json','resources/app/electron/main.js','resources/app/server/server.js','resources/app/public/index.html'])
    if(!fs.existsSync(path.join(stage,...required.split('/'))))fail('Kurulum paketi eksik: '+required,'INSTALLER_INCOMPLETE');
  const appRoot=path.join(stage,'resources','app');
  const pkg=JSON.parse(fs.readFileSync(path.join(appRoot,'package.json'),'utf8'));
  if(pkg.version!==version)fail('Paket sürümü beklenenden farklı: '+pkg.version,'INSTALLER_VERSION_MISMATCH');
  const missing=missingRuntimeDependencies(appRoot);
  if(missing.length)fail('Uygulama çekirdeğinde bağımlılık eksik: '+missing.join(', '),'INSTALLER_DEPENDENCIES_MISSING');
  const manifest=JSON.parse(fs.readFileSync(path.join(stage,'manifest.json'),'utf8'));
  if(manifest.appVersion!==version)fail('manifest.json sürümü paketle uyuşmuyor.','INSTALLER_MANIFEST_MISMATCH');
  return files.length;
}

function readme(version,electronVersion){
  return [
    `Buyer Log ${version} — Yeni kullanıcı kurulumu`,
    '',
    '1. Bu ZIP dosyasını kendi bilgisayarınızda YAZILABİLİR bir klasöre çıkarın',
    '   (örnek: C:\\BuyerLog). Program Files ve salt okunur ağ klasörleri kullanmayın.',
    '2. Klasördeki BuyerLog.exe dosyasını çalıştırın. Yönetici hakkı gerekmez.',
    '3. İlk açılışta Shared Hub / senkron klasörünü seçin ve KENDİ kullanıcı',
    '   hesabınızla giriş yapın.',
    '',
    'ÖNEMLİ',
    '- Başka bir kullanıcının Buyer Log klasörünü (özellikle data klasörünü)',
    '  kopyalamayın. Her kurulum kendi cihaz kimliğini ilk açılışta üretir.',
    '- GitHub "Code > Download ZIP" kaynak kodu çalıştırılabilir paket değildir.',
    '- Sonraki sürümler STABLE kanalından otomatik gelir; yeniden kurulum gerekmez.',
    '',
    `Uygulama sürümü: ${version} · Çalışma zamanı: Electron ${electronVersion}`,
    '',
  ].join('\r\n');
}

async function buildInstaller(options={}){
  const appZip=path.resolve(String(options.appZip||''));
  const exe=path.resolve(String(options.exe||''));
  const runtimeRoot=path.resolve(String(options.runtimeRoot||path.join(__dirname,'..','..','..')));
  const outDir=path.resolve(String(options.out||path.join(__dirname,'..','dist-installer')));
  if(!fs.existsSync(appZip))fail('STABLE uygulama artifact\'i bulunamadı: '+appZip,'INSTALLER_APP_ZIP');
  if(!fs.existsSync(exe))fail('BuyerLog.exe bulunamadı: '+exe,'INSTALLER_EXE');
  const expectedExe=String(options.exeSha256||'').trim().toLowerCase();
  if(!/^[0-9a-f]{64}$/.test(expectedExe))fail('BuyerLog.exe için beklenen SHA-256 verilmeli.','INSTALLER_EXE_SHA_REQUIRED');
  const actualExe=await sha256File(exe);
  if(actualExe!==expectedExe)fail(`BuyerLog.exe SHA-256 uyuşmuyor: ${actualExe}`,'INSTALLER_EXE_SHA');

  const work=path.join(outDir,`.stage-${process.pid}-${Date.now()}`),stage=path.join(work,INSTALL_FOLDER);
  fs.mkdirSync(stage,{recursive:true});
  try{
    const extracted=path.join(work,'artifact');
    extractZipSafe(appZip,extracted,{maxFiles:30000,maxBytes:1024*1024*1024});
    const appDir=path.join(extracted,'app');
    const pkg=JSON.parse(fs.readFileSync(path.join(appDir,'package.json'),'utf8'));
    const version=String(pkg.version||'');
    if(!parseSemver(version))fail('Artifact sürümü geçersiz.','INSTALLER_VERSION_INVALID');
    if(options.version&&options.version!==version)fail(`Artifact sürümü ${version}, beklenen ${options.version}.`,'INSTALLER_VERSION_MISMATCH');

    for(const file of runtimeFiles(runtimeRoot)){
      const target=path.join(stage,...file.split('/'));
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.copyFileSync(path.join(runtimeRoot,...file.split('/')),target);
    }
    fs.copyFileSync(exe,path.join(stage,'BuyerLog.exe'));
    fs.mkdirSync(path.join(stage,'resources'),{recursive:true});
    fs.renameSync(appDir,path.join(stage,'resources','app'));
    const manifest=buildManifest(path.join(stage,'resources','app'),stage);
    // Aynı artifact'ten aynı paket çıksın: zaman damgası yayım zamanından gelir.
    if(options.createdAt&&!Number.isNaN(Date.parse(options.createdAt)))manifest.createdAt=new Date(options.createdAt).toISOString();
    fs.writeFileSync(path.join(stage,'manifest.json'),JSON.stringify(manifest,null,2)+'\n','utf8');
    fs.writeFileSync(path.join(stage,'KURULUM-OKU.txt'),readme(version,manifest.electronVersion),'utf8');
    const fileCount=assertPackage(stage,version);

    const name=`BuyerLog-Kurulum-${version}.zip`,output=path.join(outDir,name);
    fs.rmSync(output,{force:true});
    createZipFromDirectory(stage,output,{rootPrefix:INSTALL_FOLDER});
    const sha256=await sha256File(output),size=fs.statSync(output).size;
    fs.writeFileSync(output+'.sha256',`${sha256}  ${name}\n`,'utf8');
    return {name,file:output,sha256,size,version,files:fileCount,electronVersion:manifest.electronVersion};
  }finally{try{fs.rmSync(work,{recursive:true,force:true});}catch(_){}}
}

if(require.main===module){
  const a=args(process.argv.slice(2));
  buildInstaller({appZip:a['app-zip'],exe:a.exe,exeSha256:a['exe-sha256'],runtimeRoot:a['runtime-root'],out:a.out,version:a.version,createdAt:a['created-at']})
    .then(result=>{console.log(JSON.stringify(result,null,2));})
    .catch(error=>{console.error(`[${error.code||'INSTALLER_BUILD_FAILED'}] ${error.message}`);process.exitCode=1;});
}
module.exports={buildInstaller,runtimeFiles,assertPackage,RUNTIME_DENY,FORBIDDEN};
