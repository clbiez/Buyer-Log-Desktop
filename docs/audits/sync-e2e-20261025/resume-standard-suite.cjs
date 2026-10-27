'use strict';
// Resume only files not reached by a stopped standard run. Preserve old evidence.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const repo=path.resolve(__dirname,'../../..'),app=path.join(repo,'resources/app');
const options=Object.fromEntries(process.argv.slice(2).map(arg=>arg.replace(/^--/,'').split('=')));
const logfile=path.resolve(__dirname,options.log||'full-suite.log'),prefix=options.prefix||'full-suite-resume';
if(!/^[a-z0-9-]+$/.test(prefix))throw Error('Invalid evidence prefix');
const oldIsolated=new Set((options.isolated||'sync-simulation-v20261009.test.js').split(','));
const readFiles=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?readFiles(path.join(dir,entry.name)):entry.isFile()&&entry.name.endsWith('.test.js')?[path.join(dir,entry.name)]:[]);
const all=readFiles(path.join(app,'tests')).sort((a,b)=>a.localeCompare(b));
const oldParallel=all.filter(file=>!oldIsolated.has(path.basename(file))),oldSeparate=all.filter(file=>oldIsolated.has(path.basename(file)));
const log=fs.readFileSync(logfile,'utf8'),reached=[...log.matchAll(/Batch \d+\/\d+ \((\d+) dosya\)/g)].reduce((sum,match)=>sum+Number(match[1]),0);
if(reached!==Number(options.reached||600))throw Error('Unexpected reached batch boundary: '+reached);
const remaining=[...oldParallel.slice(reached),...oldSeparate],rel=file=>path.relative(app,file).split(path.sep).join('/');
const manifest={source:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),originalLog:path.basename(logfile),originalIsolatedNames:[...oldIsolated],totalFiles:all.length,priorReachedFiles:oldParallel.slice(0,reached).map(rel),remainingFiles:remaining.map(rel),runner:'tests/run-tests.js',concurrency:2,note:'A reached failing file is not certified by this resume; its separate targeted result remains required.'};
const target=path.join(__dirname,prefix+'-manifest.json');if(fs.existsSync(target))throw Error('Preserve existing evidence; use a new prefix');fs.writeFileSync(target,JSON.stringify(manifest,null,2)+'\n');
console.log('RESUME',remaining.length,'files through the standard runner; prior reached',reached);
const result=cp.spawnSync(process.execPath,['tests/run-tests.js',...remaining.map(rel)],{cwd:app,env:{...process.env,BUYER_LOG_TEST_CONCURRENCY:'2'},stdio:'inherit'});if(result.error)throw result.error;process.exitCode=result.status||0;
