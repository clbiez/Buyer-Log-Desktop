'use strict';
const object=properties=>({type:'object',properties,additionalProperties:false});
const string=maxLength=>({type:'string',maxLength});
const array=(items,maxItems=1000)=>({type:'array',items,maxItems});
const field={...string(160),minLength:1,pattern:'^(?!(__proto__|prototype|constructor)$)[^\\x00-\\x1f]+$'},values=array(string(500),200),freeze={...object({left:{type:'integer',minimum:0,maximum:500},right:{type:'integer',minimum:0,maximum:500}}),required:['left','right']};
const viewSettings=object({order:array(field,500),hidden:array(field,500),widths:array({...object({field,pixels:{type:'number',minimum:16,maximum:4000}}),required:['field','pixels']},500),freeze:{...freeze,type:['object','null']},sort:{...object({field:{...field,type:['string','null']},direction:{enum:[-1,1]}}),type:['object','null'],required:['field','direction']},pictureHidden:{type:'boolean'},imgSize:{type:'number',minimum:16,maximum:600}});
const numericRule={...object({op:{enum:['eq','neq','gt','gte','lt','lte','between','aboveAvg','belowAvg']},a:{type:'number'},b:{type:'number'},avg:{type:'number'}}),required:['op'],type:['object','null']};
const filterSettings=object({search:string(500),columns:array({...object({field,values,granularity:{enum:['year','month','week','day',null]},numericRule,quickPriority:{type:'boolean'},quickExf:{type:'boolean'}}),required:['field','values']},100),selects:array({...object({id:field,value:string(500)}),required:['id','value']},20),dimensions:array({...object({id:field,values}),required:['id','values']},20),checkFilter:{enum:['','checked','unchecked']},quickExf:string(160),quickActive:array({enum:['Active','Inactive']},2)});
module.exports={viewSettings,filterSettings,field};
