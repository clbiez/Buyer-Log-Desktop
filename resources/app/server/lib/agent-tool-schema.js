'use strict';

// The migrated catalog uses this deliberately small, fail-closed JSON Schema
// subset. Legacy descriptive schemas are not advertised as validated contracts.
function validate(schema,value,path='$') {
  const bad=()=>{throw Object.assign(new Error(`Invalid tool contract: ${path}`),{code:'OFFICE_TOOL_SCHEMA',statusCode:422});};
  if(schema.enum&&!schema.enum.includes(value))bad();
  if(schema.type==='object') {
    if(!value||typeof value!=='object'||Array.isArray(value))bad();
    for(const key of schema.required||[])if(!Object.prototype.hasOwnProperty.call(value,key))bad();
    for(const [key,item]of Object.entries(value)){
      if(['__proto__','prototype','constructor'].includes(key))bad();
      if(schema.properties?.[key])validate(schema.properties[key],item,`${path}.${key}`);
      else if(schema.additionalProperties===false)bad();
      else if(schema.additionalProperties&&typeof schema.additionalProperties==='object')validate(schema.additionalProperties,item,`${path}.${key}`);
    }
  } else if(schema.type==='array') {
    if(!Array.isArray(value)||schema.maxItems!=null&&value.length>schema.maxItems||schema.minItems!=null&&value.length<schema.minItems)bad();
    if(schema.items)value.forEach((item,i)=>validate(schema.items,item,`${path}[${i}]`));
  } else if(schema.type==='string') {
    if(typeof value!=='string'||schema.maxLength!=null&&value.length>schema.maxLength||schema.minLength!=null&&value.length<schema.minLength||schema.pattern&&!new RegExp(schema.pattern).test(value))bad();
  } else if(schema.type==='boolean'&&typeof value!=='boolean')bad();
  else if(['number','integer'].includes(schema.type)&&(!Number.isFinite(value)||schema.type==='integer'&&!Number.isSafeInteger(value)||schema.minimum!=null&&value<schema.minimum||schema.maximum!=null&&value>schema.maximum))bad();
  return value;
}
module.exports={validate};
