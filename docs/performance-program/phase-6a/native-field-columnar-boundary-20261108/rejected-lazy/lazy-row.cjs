'use strict';
// Tiny isolated native experiment. NOT a Buyer Log transport/production codec.
const {types}=require('node:util');
function validate(value,stack=new WeakSet()){
 if(value===null||typeof value==='string'||typeof value==='boolean')return;
 if(typeof value==='number'){if(!Number.isFinite(value))throw Error('NON_JSON_NUMBER');return;}
 if(!value||typeof value!=='object'||types.isProxy(value))throw Error('UNSUPPORTED_VALUE_OR_PROXY');
 if(stack.has(value))throw Error('CYCLIC_INPUT');
 const proto=Object.getPrototypeOf(value);
 if(proto===Date.prototype){if(Reflect.ownKeys(value).length||!Number.isFinite(value.getTime()))throw Error('UNSUPPORTED_DATE');return;}
 if(proto!==Object.prototype&&proto!==null&&!(Array.isArray(value)&&proto===Array.prototype))throw Error('UNSUPPORTED_PROTOTYPE');
 stack.add(value);
 const keys=Reflect.ownKeys(value);
 if(Array.isArray(value)&&(keys.length!==value.length+1||keys.some(key=>key!=='length'&&(typeof key!=='string'||!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=value.length))))throw Error('SPARSE_OR_EXTRA_ARRAY');
 for(const key of keys){
  if(Array.isArray(value)&&key==='length')continue;
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(typeof key!=='string'||!Object.hasOwn(descriptor,'value')||!descriptor.enumerable||!descriptor.writable||!descriptor.configurable)throw Error('UNSUPPORTED_DESCRIPTOR');
  if(key==='toJSON'&&typeof descriptor.value==='function')throw Error('CUSTOM_TO_JSON');
  validate(descriptor.value,stack);
 }
 stack.delete(value);
}
const arrayIndex=key=>typeof key==='string'&&/^(0|[1-9]\d*)$/.test(key)&&Number(key)<4294967295;
function fromRecord(record,ordinal=0){
 // Native isProxy runs before ownKeys/descriptors: Proxy traps are not invoked.
 validate(record);
 if(!record||typeof record!=='object'||Array.isArray(record)||Object.getPrototypeOf(record)===Date.prototype)throw Error('ROW_OBJECT_REQUIRED');
 const keys=Reflect.ownKeys(record),cells=keys.map(key=>Object.getOwnPropertyDescriptor(record,key).value),slots=new Map(keys.map((key,index)=>[key,index])),present=new Set(keys),order=keys.slice(),target=Object.create(Object.getPrototypeOf(record));
 function put(key,value){if(!slots.has(key)){slots.set(key,cells.length);keys.push(key);cells.push(value);}else cells[slots.get(key)]=value;if(!present.has(key)){present.add(key);order.push(key);}return true;}
 const row=new Proxy(target,{
  ownKeys(){const current=order.filter(key=>present.has(key));return current.filter(arrayIndex).sort((a,b)=>Number(a)-Number(b)).concat(current.filter(key=>typeof key==='string'&&!arrayIndex(key)),current.filter(key=>typeof key==='symbol'));},
  get(_target,key,receiver){return present.has(key)?cells[slots.get(key)]:Reflect.get(target,key,receiver);},
  has(_target,key){return present.has(key)||Reflect.has(target,key);},
  getOwnPropertyDescriptor(_target,key){return present.has(key)?{value:cells[slots.get(key)],writable:true,enumerable:true,configurable:true}:undefined;},
  set(_target,key,value,receiver){if(present.has(key))return put(key,value);return Reflect.has(target,key)?Reflect.set(target,key,value,receiver):put(key,value);},
  deleteProperty(_target,key){if(present.delete(key)){const index=order.indexOf(key);if(index>=0)order.splice(index,1);}return true;},
  defineProperty(_target,key,descriptor){const exists=present.has(key);if(!Object.hasOwn(descriptor,'value')||descriptor.get||descriptor.set||(descriptor.enumerable??exists)!==true||(descriptor.writable??exists)!==true||(descriptor.configurable??exists)!==true)throw Error('UNSUPPORTED_DEFINE_PROPERTY');return put(key,descriptor.value);},
  setPrototypeOf(_target,prototype){return Reflect.setPrototypeOf(target,prototype);},
  preventExtensions(){throw Error('UNSUPPORTED_PREVENT_EXTENSIONS');},
 });
 return {row,ordinal,packed:{keys,cells}};
}
module.exports={fromRecord,validate};
