'use strict';
// Source-contract tests inspect the final owners together after the migration.
// Normalize only the root scope and formatting, never values or declarations.
const fs=require('node:fs'),path=require('node:path');
const PUBLIC=path.join(__dirname,'../../public');
module.exports=function manifestCss(files=['ui-tokens.css','app.css','design.css','experience.css','ui-components.css']){
 return files.map(f=>fs.readFileSync(path.join(PUBLIC,f),'utf8')).join('\n')
  .replace(/html\[data-ui-system="manifest"\] /g,'').replace(/:root\[data-ui-system="manifest"\]/g,':root')
  .replace(/\s*\{\s*/g,'{').replace(/\s*\}/g,'}');
};
module.exports.rules=function rules(pattern){return (module.exports().match(/[^{}]+\{[^{}]*\}/g)||[]).filter(rule=>pattern.test(rule.slice(0,rule.indexOf('{')))).join('\n');};
// Shared replacements for retired per-component chrome. Assert real global rules;
// never manufacture declarations or normalize values to make a test pass.
module.exports.assertReset=function(){require('node:assert/strict').match(module.exports(),/:where\(body,body \*\)\{border:0;border-radius:var\(--ui-radius\);box-shadow:none;text-shadow:none;/);};
module.exports.assertFocus=function(){require('node:assert/strict').match(module.exports(),/:focus-visible\{outline:2px solid var\(--ui-accent\)/);};
module.exports.assertStaticMotion=function(){require('node:assert/strict').match(module.exports(),/:where\(body,body \*,body \*::before,body \*::after\)\{animation:none!important;transition:none!important/);};
