'use strict';
// Only OS integration side effects are suppressed. Production main, watchdog,
// backend, workspace manager, preload and renderer are loaded unchanged.
const path=require('node:path'),fs=require('node:fs'),{app}=require('electron'),core=path.resolve(__dirname,'../../../resources/app'),root=process.env.BUYER_LOG_PORTABLE_ROOT;
process.env.BL_SERVER_FILE=path.join(__dirname,'server-entry.cjs');process.env.BL_TEST_SEED='1';process.env.BUYER_LOG_CENTRAL_IAM_ENABLED='0';
app.setPath('downloads',path.join(root,'downloads'));fs.mkdirSync(path.join(root,'downloads'),{recursive:true});
const icons=require(path.join(core,'electron/shortcut-icon'));icons.syncShortcutIcons=()=>({updated:[]});icons.refreshShellIcons=()=>{};require(path.join(core,'electron/exe-icon')).runExeIconPatch=async()=>({applied:false,reason:'isolated-acceptance'});
require(path.join(core,'electron/main.js'));
