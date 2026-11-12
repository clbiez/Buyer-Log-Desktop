'use strict';
// Compile exact pinned Git content with its original relative dependencies.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),{execFileSync}=require('node:child_process');
const root=execFileSync('git',['rev-parse','--show-toplevel'],{cwd:__dirname,encoding:'utf8'}).trim();
const filename=path.join(root,'scripts/prototypes/sqlite-decision-20261109/r2-pinned.cjs');
const source=execFileSync('git',['show','4ac2ed4847ce4c3af32bc82d13681b101d749d20:scripts/prototypes/sqlite-decision-20261109/sqlite-compat.cjs'],{cwd:root,encoding:'utf8'});
const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));m._compile(source,filename);module.exports=m.exports;
