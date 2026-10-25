'use strict';
// Reuse verified interaction recipes, replacing only their capture seam with
// the complete 3 × 4 × 2 matrix. No generated production or synthetic UI markup.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const recipes={operations:'capture-operations.cjs',operationStates:'capture-operations-states.cjs',commercialStates:'capture-commercial-states.cjs',remaining:'capture-remaining.cjs',remainingStates:'remaining-states.cjs',output:'final-remaining.cjs',planStates:'capture-group1-states.cjs'};
const key=process.argv[2],file=recipes[key];if(!file)throw Error('Unknown recipe');
const out=path.resolve(process.env.BL_MATRIX_OUT||'docs/ai/ui-rebuild/phase-3/matrix/'+key);fs.mkdirSync(out,{recursive:true});
let s=fs.readFileSync(path.join(__dirname,file),'utf8');
s=s.replace(/process\.argv\[2\]\|\|/g,'').replace(/'docs\/ai\/ui-rebuild\/phase-2-[^']+'/g,JSON.stringify(out));
s=s.replace(/\['light','grey','dark'\]/g,"['light']");
s=s.replace(/const shot=async name=>\{[^\n]+\};/,'const shot=require(\'./matrix-shot.cjs\')({page,out,report});');
const a=s.indexOf('const report='),b=s.indexOf(';page.on',a);if(a<0||b<0)throw Error('Report seam not found');
s=s.slice(0,a)+"const report=fs.existsSync(path.join(out,'capture.json'))?JSON.parse(fs.readFileSync(path.join(out,'capture.json'))):{screens:[],keyboard:[],checks:[],errors:[]}"+s.slice(b);
s=s.replace("const {browser,page}=await require('./browser.cjs')();","const {browser,context,page}=await require('./operations-fixture.cjs')();");
if(!s.includes('await context.close()'))s=s.replace('await browser.close();','await context.close();await browser.close();');
// For the commercial state recipe, use the same canonical demo projection but
// anonymize profile labels through the common operations fixture.
s=s.replace("require('./commercial-fixture.cjs')()","require('./matrix-commercial-fixture.cjs')()");
const generated=new Module(path.join(__dirname,'matrix-generated-'+key+'.cjs'),module);generated.filename=path.join(__dirname,'matrix-generated-'+key+'.cjs');generated.paths=module.paths;generated._compile(s,generated.filename);
