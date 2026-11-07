'use strict';
// Full-suite preload for this cloud task. Give each test process private demo
// data roots. Leave the platform temp/write policy at its normal defaults;
// tests also create their own temp fixtures outside these data roots.
if(process.argv.some(arg=>arg.endsWith('.test.js'))){
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-phase7-suite-'));
 // LOCAL_DATA_ROOT normally follows DATA_ROOT on Linux. Do not force an
 // override into child fixtures which deliberately test the default policy.
 for(const name of ['SERVER_DATA','DATA'])process.env[`BUYER_LOG_${name}_ROOT`]=path.join(root,name);
 process.env.BUYER_LOG_CONFIG_PATH=path.join(root,'config.json');
 process.on('exit',()=>fs.rmSync(root,{recursive:true,force:true}));
}
